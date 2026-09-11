import * as cheerio from 'cheerio';
import type { HttpClient } from '../../net/http.ts';
import type { SearchClient, SearchHit, SearchQuery } from './types.ts';

/**
 * DuckDuckGo 搜索客户端（免费、无需 API Key）
 *
 * 直接抓取 DDG 的 HTML 端点（html.duckduckgo.com/html），用 cheerio 解析结果。
 * 走统一的 HttpClient（限流 / 熔断 / 重试 / 代理）。
 *
 * 注意：DDG 无官方 API，本实现属非官方抓取，可能因 DDG 改版或风控而失效；
 * 国内直连不稳时请配 BRIGHTDATA_* 代理。
 */

export interface DuckDuckGoSearchClientOptions {
  http: HttpClient;
  endpoint?: string;
  searchLang?: string;
}

export class DuckDuckGoSearchClient implements SearchClient {
  readonly provider = 'duckduckgo';

  private readonly http: HttpClient;
  private readonly endpoint: string;
  private readonly searchLang: string;

  constructor(options: DuckDuckGoSearchClientOptions) {
    this.http = options.http;
    this.endpoint = options.endpoint ?? 'https://html.duckduckgo.com/html/';
    this.searchLang = options.searchLang ?? 'en';
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const params = new URLSearchParams({
      q: query.keyword,
      kl: `${(query.country ?? 'us').toLowerCase()}-${this.searchLang}`,
    });
    // DDG html 用 s 表示结果起始下标（每页约 30 条）
    if (query.offset && query.offset > 0) {
      params.set('s', String(query.offset * 30));
    }

    const response = await this.http.text(`${this.endpoint}?${params}`, {
      headers: { accept: 'text/html' },
      throttleKey: 'html.duckduckgo.com',
    });

    return parseDuckDuckGoHtml(response.data, clamp(query.count ?? 10, 1, 20));
  }
}

function parseDuckDuckGoHtml(html: string, limit: number): SearchHit[] {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];

  $('.result').each((_, el) => {
    if (hits.length >= limit) return;

    const anchor = $(el).find('a.result__a').first();
    const title = anchor.text().trim();
    const url = decodeResultUrl(anchor.attr('href') ?? '');
    if (!url) return;

    const snippet = $(el).find('.result__snippet').first().text().trim() || null;
    hits.push({ title: title || url, url, snippet, provider: 'duckduckgo' });
  });

  return hits;
}

function decodeResultUrl(href: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    // DDG 结果链接形如 //duckduckgo.com/l/?uddg=<目标URL>，uddg 已由 URLSearchParams 解码
    const uddg = u.searchParams.get('uddg');
    if (uddg && /^https?:\/\//i.test(uddg)) return uddg;
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
