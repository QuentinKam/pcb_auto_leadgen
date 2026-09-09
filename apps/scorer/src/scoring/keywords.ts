/**
 * 维度 2: PCB 关键词密度（满分 25）
 *
 * 规则 v1:
 * - 扫描 company.description + 官网爬取的 raw_payload
 * - 统计 PCB 相关关键词命中次数
 * - 0 次：0 分
 * - 1-2 次：10 分
 * - 3-5 次：18 分
 * - 6+ 次：25 分（满分）
 *
 * 关键词列表（不分大小写）：
 *   PCB, PCBA, PCB assembly, PCB fabrication, circuit board,
 *   printed circuit board, SMT, through-hole, BOM, Gerber
 */

const PCB_KEYWORDS = [
  'pcb',
  'pcba',
  'pcb assembly',
  'pcb fabrication',
  'circuit board',
  'printed circuit board',
  'smt',
  'through-hole',
  'through hole',
  'bom',
  'gerber',
  'pick and place',
  'reflow',
  'aoi',
];

const MAX_SCORE = 25;

export interface KeywordScoreResult {
  score: number;
  hitCount: number;
  matchedKeywords: string[];
  reason: string;
}

export function scoreKeywords(
  company: { description?: string | null; rawPayload?: unknown },
): KeywordScoreResult {
  // 拼接所有可扫描文本
  const texts: string[] = [];
  if (company.description) texts.push(company.description);
  if (company.rawPayload && typeof company.rawPayload === 'object') {
    const payload = company.rawPayload as Record<string, unknown>;
    // 常见字段：about / bio / summary / products / services
    for (const key of ['about', 'bio', 'summary', 'products', 'services', 'description']) {
      const v = payload[key];
      if (typeof v === 'string') texts.push(v);
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string') texts.push(item);
        }
      }
    }
  }
  const haystack = texts.join(' ').toLowerCase();

  if (!haystack) {
    return {
      score: 0,
      hitCount: 0,
      matchedKeywords: [],
      reason: 'No description or raw payload to scan',
    };
  }

  // 统计每个关键词命中次数（不区分大小写）
  const matched: string[] = [];
  let totalHits = 0;
  for (const kw of PCB_KEYWORDS) {
    // 用 indexOf 循环统计出现次数（避免正则特殊字符问题）
    const lower = kw.toLowerCase();
    let idx = haystack.indexOf(lower);
    let count = 0;
    while (idx !== -1 && count < 3) { // 单个词最多计 3 次
      count++;
      idx = haystack.indexOf(lower, idx + lower.length);
    }
    if (count > 0) {
      matched.push(kw);
      totalHits += count;
    }
  }

  let score: number;
  if (totalHits === 0) score = 0;
  else if (totalHits <= 2) score = 10;
  else if (totalHits <= 5) score = 18;
  else score = MAX_SCORE;

  const reason =
    totalHits === 0
      ? 'No PCB-related keywords found in description or raw payload'
      : `Found ${totalHits} PCB keyword hits: ${matched.join(', ')}`;

  return {
    score,
    hitCount: totalHits,
    matchedKeywords: matched,
    reason,
  };
}
