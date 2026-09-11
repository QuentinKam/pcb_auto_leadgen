import { CheerioCrawler, Configuration, ProxyConfiguration } from 'crawlee';
import { type SiteSignals, emptySignals, extractSignals, mergeSignals } from './extract.ts';

export interface CrawlTarget {
  domain: string;
  url: string;
}

export interface CrawlOutcome {
  domain: string;
  signals: SiteSignals;
  pages: string[];
  errors: string[];
}

export interface CrawlOptions {
  /** 同域名请求最小间隔（毫秒），合规下限 2000 */
  minIntervalMs: number;
  proxyUrl?: string | null;
  maxPagesPerSite?: number;
  onWarn?: (message: string) => void;
}

const COMMON_PATHS = [
  '',
  '/about',
  '/about-us',
  '/company',
  '/products',
  '/solutions',
  '/services',
];

/**
 * 用 Crawlee CheerioCrawler 抓取企业官网关键页。
 * 框架层已覆盖：robots.txt 遵守、同域名串行、限速、重试退避、代理池。
 */
export async function crawlWebsites(
  targets: CrawlTarget[],
  options: CrawlOptions
): Promise<Map<string, CrawlOutcome>> {
  const outcomes = new Map<string, CrawlOutcome>();
  const domainByUrl = new Map<string, string>();
  const requests: string[] = [];

  for (const target of targets) {
    const paths = COMMON_PATHS.slice(0, options.maxPagesPerSite ?? COMMON_PATHS.length);
    for (const path of paths) {
      const url = joinUrl(target.url, path);
      if (domainByUrl.has(url)) continue;
      domainByUrl.set(url, target.domain);
      requests.push(url);
      if (!outcomes.has(target.domain)) {
        outcomes.set(target.domain, {
          domain: target.domain,
          signals: emptySignals(),
          pages: [],
          errors: [],
        });
      }
    }
  }

  if (requests.length === 0) return outcomes;

  const maxRequestsPerMinute = Math.max(1, Math.floor(60_000 / options.minIntervalMs));
  // 一次性任务不落盘（persistStorage 是 Configuration 选项，不是 crawler 选项）
  const crawlerConfig = new Configuration({ persistStorage: false });
  const crawler = new CheerioCrawler(
    {
      respectRobotsTxtFile: true,
      maxRequestsPerMinute,
      sameDomainDelaySecs: options.minIntervalMs / 1000,
      minConcurrency: 1,
      maxConcurrency: 1,
      maxRequestRetries: 2,
      proxyConfiguration: options.proxyUrl
        ? new ProxyConfiguration({ proxyUrls: [options.proxyUrl] })
        : undefined,
      async requestHandler({ request, body }) {
        const domain = domainByUrl.get(request.url);
        const outcome = domain ? outcomes.get(domain) : undefined;
        if (!outcome) return;
        const html = typeof body === 'string' ? body : body.toString('utf8');
        outcome.signals = mergeSignals(outcome.signals, extractSignals(html, request.url));
        outcome.pages.push(request.url);
      },
      failedRequestHandler({ request, error }, retryCount) {
        const domain = domainByUrl.get(request.url);
        const outcome = domain ? outcomes.get(domain) : undefined;
        if (!outcome) return;
        const reason = error instanceof Error ? error.message : String(error);
        outcome.errors.push(`${request.url} (${retryCount}): ${reason}`);
        options.onWarn?.(`crawl failed ${request.url}: ${reason}`);
      },
    },
    crawlerConfig
  );

  await crawler.run(requests);
  return outcomes;
}

function joinUrl(base: string, path: string): string {
  try {
    return new URL(path, base).toString();
  } catch {
    return base;
  }
}
