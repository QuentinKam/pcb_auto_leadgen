/**
 * robots.txt 解析与放行判定（RFC 9309 简化实现）。
 * 支持 User-agent 分组、Allow/Disallow 前缀、`*` 通配、`$` 结尾锚定。
 * 匹配优先级：最长匹配获胜；长度相同时 Allow 优先（RFC 9309）。
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelayMs: number | null;
}

export const EMPTY_ROBOTS: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null };

interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelayMs: number | null;
}

export function parseRobotsTxt(text: string, userAgent = '*'): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup = { agents: [], allow: [], disallow: [], crawlDelayMs: null };
  let hasDirectives = false;

  const flush = (): void => {
    if (current.agents.length > 0) groups.push(current);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;

    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === 'user-agent') {
      // 已收集过规则的组在此闭合，开启新组
      if (hasDirectives) {
        flush();
        current = { agents: [], allow: [], disallow: [], crawlDelayMs: null };
        hasDirectives = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (current.agents.length === 0) continue; // 规则先于 User-agent 出现，忽略
    hasDirectives = true;

    if (key === 'disallow') {
      if (value) current.disallow.push(value);
    } else if (key === 'allow') {
      if (value) current.allow.push(value);
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelayMs = Math.round(seconds * 1000);
      }
    }
  }
  flush();

  const agent = userAgent.toLowerCase();
  const exact = groups.filter((g) => g.agents.includes(agent));
  const selected = exact.length > 0 ? exact : groups.filter((g) => g.agents.includes('*'));

  const rules: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null };
  for (const group of selected) {
    rules.allow.push(...group.allow);
    rules.disallow.push(...group.disallow);
    if (group.crawlDelayMs !== null) {
      rules.crawlDelayMs =
        rules.crawlDelayMs === null
          ? group.crawlDelayMs
          : Math.max(rules.crawlDelayMs, group.crawlDelayMs);
    }
  }
  return rules;
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const target = path || '/';
  let bestLength = -1;
  let bestAllow = true;

  // 先处理 Allow：长度相同时 Allow 优先，因此 Disallow 只在严格更长时覆盖
  for (const pattern of rules.allow) {
    if (matchesPath(pattern, target) && pattern.length > bestLength) {
      bestLength = pattern.length;
      bestAllow = true;
    }
  }
  for (const pattern of rules.disallow) {
    if (matchesPath(pattern, target) && pattern.length > bestLength) {
      bestLength = pattern.length;
      bestAllow = false;
    }
  }

  return bestLength === -1 ? true : bestAllow;
}

function matchesPath(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const core = anchored ? pattern.slice(0, -1) : pattern;
  const regexSource = core.split('*').map(escapeRegExp).join('.*');
  const regex = new RegExp(`^${regexSource}${anchored ? '$' : ''}`);
  return regex.test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
