/** EDGAR 年报 enrich 的纯函数：主文档定位 / 官网域名选择 / 邮箱提取。无 IO，便于单测。 */

export const CONTACT_PATHS = ['contact-us', 'contact'] as const;

export interface IndexEntry {
  name: string;
  size: string | number;
}

/** 服务商 / 聚合 / 技术域：年报中出现但不是公司官网 */
const NON_COMPANY_DOMAINS =
  /xbrl|w3\.org|sec\.gov|otcmarkets|edgar-online|newsfile|prnewswire|businesswire|globenewswire|accesswire|securities\.law|bb-law|moodys|standardandpoors|spglobal|marketwatch|investorroom|issuerdirect|financialreports|annualreports/i;

/** 法律后缀/通用词：从公司名取特征 token 时剔除 */
const NAME_STOP_WORDS =
  /^(corp|corporation|inc|incorporated|ltd|limited|llc|co|company|group|holdings|holding|plc|the|and|of|international|technologies|technology|systems|system)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DOMAIN_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*\.(?:com|net|io|co))/g;

/** 无效邮箱：占位/技术/图片误匹配 */
const BAD_EMAIL =
  /example|@sec\.gov|noreply|no-reply|@w3\.org|@xbrl|sentry|u00|@2x|\.png|\.jpg|\.gif|\.webp/i;

function isLikelyBadEmail(email: string): boolean {
  if (BAD_EMAIL.test(email)) return true;
  const local = email.split('@')[0] ?? '';
  // 图片/样式名误匹配（如 2x@2x.io）：local 部分过短或无字母
  return !/[a-z]{2}/i.test(local);
}

/**
 * 从 accession index.json 的条目里选 10-K 主文档。
 * 规则：htm 文件 → 排除 index/R*（封面/报表渲染页）/ EX 附件 → 取体积最大者。
 */
export function pickMainDoc(items: IndexEntry[]): string | null {
  const docs = items
    .filter((i) => /\.htm/i.test(i.name))
    .filter((i) => !/-index/i.test(i.name))
    .filter((i) => !/^R\d+\.htm/i.test(i.name))
    .filter((i) => !/ex[-_x]?\d/i.test(i.name))
    .map((i) => ({ name: i.name, size: Number(i.size) || 0 }))
    .sort((a, b) => b.size - a.size);
  return docs[0]?.name ?? null;
}

/** 公司名 → 特征 token（小写，长度 ≥3），用于官网归属判定 */
export function companyNameTokens(companyName: string): string[] {
  return companyName
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !NAME_STOP_WORDS.test(t));
}

/**
 * 从年报中出现的候选域名里选公司官网。
 * @param domains     年报正文/HTML 中出现的域
 * @param emailDomains 年报邮箱所在域（通常就是公司主域，加权）
 * @param companyName 公司显示名
 */
export function selectWebsite(
  domains: string[],
  emailDomains: string[],
  companyName: string
): string | null {
  const tokens = companyNameTokens(companyName);
  const emailSet = new Set(emailDomains);

  let best: { domain: string; score: number } | null = null;
  for (const raw of domains) {
    const domain = raw.toLowerCase().replace(/^www\./, '');
    if (NON_COMPANY_DOMAINS.test(domain)) continue;
    // my 开头多为产品站（myomnipod/mydario），不是企业站
    if (domain.startsWith('my')) continue;

    const base = domain.split('.')[0] ?? '';
    let score = 0;
    for (const token of tokens) {
      if (base.includes(token)) score += token.length;
    }
    if (emailSet.has(domain)) score += 5;
    if (score > 0 && (!best || score > best.score)) best = { domain, score };
  }
  return best?.domain ?? null;
}

/** 从 HTML 中收集候选域名（去重，保序） */
export function extractDomains(html: string): string[] {
  const out: string[] = [];
  for (const m of html.toLowerCase().matchAll(DOMAIN_RE)) {
    const d = m[1];
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * 从页面纯文本 + mailto 链接里提取有效企业邮箱（小写去重）。
 * @param text  cheerio 解析后的 body 文本
 * @param mailto 页面中的 mailto: 地址
 */
export function extractEmails(text: string, mailto: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of text.match(EMAIL_RE) ?? []) {
    const email = raw.toLowerCase();
    if (!isLikelyBadEmail(email)) out.add(email);
  }
  for (const raw of mailto) {
    const email = raw.trim().toLowerCase();
    if (email && !isLikelyBadEmail(email)) out.add(email);
  }
  return [...out];
}
