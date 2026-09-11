import type { HttpClient } from '../../net/http.ts';
import type { SearchClient, SearchHit, SearchQuery } from './types.ts';

/**
 * Brave Search API 客户端
 * GET https://api.search.brave.com/res/v1/web/search
 * 认证：X-Subscription-Token
 * 免费额度约 1 req/s，限流由 HttpClient 的按域名节流兜底
 */
interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveWebResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

export interface BraveSearchClientOptions {
  apiKey: string;
  http: HttpClient;
  endpoint?: string;
  searchLang?: string;
}

export class BraveSearchClient implements SearchClient {
  readonly provider = 'brave';

  private readonly apiKey: string;
  private readonly http: HttpClient;
  private readonly endpoint: string;
  private readonly searchLang: string;
  private rateLimitRemaining: number | null = null;

  constructor(options: BraveSearchClientOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
    this.endpoint = options.endpoint ?? 'https://api.search.brave.com/res/v1/web/search';
    this.searchLang = options.searchLang ?? 'en';
  }

  /** 最近一次响应回读的剩余额度（X-RateLimit-Remaining），未知时为 null */
  get remainingQuota(): number | null {
    return this.rateLimitRemaining;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const params = new URLSearchParams({
      q: query.keyword,
      country: (query.country ?? 'us').toLowerCase(),
      search_lang: this.searchLang,
      count: String(clamp(query.count ?? 10, 1, 20)),
      offset: String(clamp(query.offset ?? 0, 0, 9)),
    });

    const response = await this.http.request<BraveWebResponse>(`${this.endpoint}?${params}`, {
      headers: { 'x-subscription-token': this.apiKey },
      throttleKey: 'api.search.brave.com',
    });

    const remaining = response.headers.get('x-ratelimit-remaining');
    this.rateLimitRemaining = remaining === null ? null : Number(remaining);

    return (response.data?.web?.results ?? []).flatMap((result) => {
      if (!result.url) return [];
      return [
        {
          title: result.title ?? result.url,
          url: result.url,
          snippet: result.description ?? null,
          provider: this.provider,
        },
      ];
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
