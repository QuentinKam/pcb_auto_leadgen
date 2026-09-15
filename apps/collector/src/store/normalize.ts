/** 非目标企业域名（社媒 / 聚合站 / 招聘 / 百科 / SEC），命中则丢弃该搜索命中 */
const EXCLUDED_DOMAINS = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'crunchbase.com',
  'wikipedia.org',
  'glassdoor.com',
  'indeed.com',
  'bloomberg.com',
  'github.com',
  'medium.com',
  'reddit.com',
  'pinterest.com',
  'tiktok.com',
  'amazon.com',
  'alibaba.com',
  'g2.com',
  'zoominfo.com',
  'dnb.com',
  // SEC EDGAR 直接返回的 sec.gov URL 不是公司官网；但 EDGAR 客户生成的
  // cik-*.edgar.sec.gov 虚拟域名会以 *.edgar.sec.gov 形式通过下面 SPECIAL_ACCEPT
  // 规则被接受（见 normalizeDomain），所以不能把 sec.gov 简单移出 EXCLUDED，
  // 需要用 SPECIAL_ACCEPT 白名单精确放行 *.edgar.sec.gov 而非整个 sec.gov。
  // 故此处仍保留 sec.gov（覆盖 browse-edgar 返回的真实 sec.gov 链接）。
  'sec.gov',
];

/** 特例域名：形如 *.edgar.sec.gov，由 EDGAR 客户端构造，用于在 SEC 数据集中做公司去重。
 *  以 .edgar.sec.gov 结尾的域名通过 normalizeDomain 转换后被加入此列表，
 *  在 isLikelyCompanyDomain 中被接受（而非被 EXCLUDED_DOMAINS 误杀）。 */
const SPECIAL_ACCEPT_DOMAINS = ['edgar.sec.gov'];

const SIZE_BUCKETS: Array<{ max: number; bucket: string }> = [
  { max: 10, bucket: '1-10' },
  { max: 50, bucket: '11-50' },
  { max: 200, bucket: '51-200' },
  { max: 500, bucket: '201-500' },
  { max: 1000, bucket: '501-1000' },
  { max: 5000, bucket: '1001-5000' },
  { max: Number.POSITIVE_INFINITY, bucket: '5000+' },
];

export function domainFromUrl(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return normalizeDomain(url);
  }
}

/** 归一化域名：去协议 / www / 路径 / 查询串，转小写 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = value.split('#')[0] ?? '';
  value = value.split('@').pop() ?? '';
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^www\./, '');
  if (!value || !value.includes('.')) return null;
  return value;
}

export function buildWebsiteUrl(domain: string): string {
  return `https://${domain}`;
}

export function isLikelyCompanyDomain(domain: string): boolean {
  if (SPECIAL_ACCEPT_DOMAINS.some((ok) => domain === ok || domain.endsWith(`.${ok}`))) {
    return true;
  }
  return !EXCLUDED_DOMAINS.some(
    (excluded) => domain === excluded || domain.endsWith(`.${excluded}`)
  );
}

export function employeeCountToSizeBucket(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  for (const { max, bucket } of SIZE_BUCKETS) {
    if (count <= max) return bucket;
  }
  return null;
}

/** 搜索结果标题清理：去掉 " - Home" / " | Official Site" 之类后缀 */
export function cleanCompanyName(title: string): string {
  const primary =
    title
      .split(/\s[|–—]\s/)[0]
      ?.split(' - ')[0]
      ?.trim() ?? '';
  return primary || title.trim();
}
