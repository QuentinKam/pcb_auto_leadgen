import type { HttpClient } from '../../net/http.ts';
import type { SearchClient, SearchHit, SearchQuery } from './types.ts';

/**
 * OpenCorporates 搜索客户端（免费，需注册获取 API Token）
 *
 * 免费档：50 req/s, 100 req/day（需要注册）
 * 注册地址：https://opencorporates.com/api/keys
 *
 * 支持按国家/地区过滤（jurisdiction_code），keyword 跨公司名+描述搜索
 */

interface OpenCorpCompany {
  name?: string;
  company_number?: string;
  jurisdiction_code?: string;
  incorporation_date?: string;
  company_type?: string;
  registry_url?: string;
  current_status?: string;
  branch?: string;
  dead?: boolean;
}

interface OpenCorpResult {
  company?: OpenCorpCompany;
  opencorporates_url?: string;
}

interface OpenCorpResponse {
  results?: {
    companies?: {
      total?: number;
      company?: OpenCorpResult[];
    };
  };
}

export interface OpenCorporatesClientOptions {
  apiToken: string;
  http: HttpClient;
}

export class OpenCorporatesClient implements SearchClient {
  readonly provider = 'opencorporates';

  private readonly apiToken: string;
  private readonly http: HttpClient;
  private readonly endpoint = 'https://api.opencorporates.com';

  constructor(options: OpenCorporatesClientOptions) {
    this.apiToken = options.apiToken;
    this.http = options.http;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    if (!this.apiToken) {
      throw new Error(
        'OpenCorporates API token required. Get one free at https://opencorporates.com/api/keys (100 req/day free tier).'
      );
    }

    const count = Math.min(query.count ?? 10, 20);
    const params = new URLSearchParams({
      q: query.keyword,
      token: this.apiToken,
      per_page: String(count),
      page: String((query.offset ?? 0) + 1),
    });

    // 如果指定了国家码，按国家过滤（country 如 "us", "gb", "de"）
    if (query.country) {
      params.set('jurisdiction_code', query.country.toLowerCase());
    }

    const response = await this.http.request<OpenCorpResponse>(
      `${this.endpoint}/companies/search?${params}`,
      {
        throttleKey: 'api.opencorporates.com',
      }
    );

    const companies = response.data?.results?.companies?.company ?? [];
    return companies.map((result) => {
      const company = result.company ?? {};
      return {
        title: company.name ?? 'Unknown',
        url: result.opencorporates_url ?? '',
        snippet:
          [
            company.jurisdiction_code
              ? `Country: ${company.jurisdiction_code.toUpperCase()}`
              : null,
            company.company_number ? `Reg #: ${company.company_number}` : null,
            company.company_type ? `Type: ${company.company_type}` : null,
            company.incorporation_date ? `Incorporated: ${company.incorporation_date}` : null,
            company.current_status ? `Status: ${company.current_status}` : null,
            company.branch ? `Branch: ${company.branch}` : null,
            company.dead ? '[DISSOLVED]' : null,
          ]
            .filter(Boolean)
            .join(' | ') || null,
        provider: this.provider,
      };
    });
  }
}
