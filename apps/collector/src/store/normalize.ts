/** 非目标企业域名（社媒 / 聚合站 / 招聘 / 百科），命中则丢弃该搜索命中 */
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
];

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
