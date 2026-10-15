import type { HttpClient } from '../../net/http.ts';
import type { SearchClient, SearchHit, SearchQuery } from './types.ts';

/**
 * UK Companies House 搜索客户端（免费，需注册获取 API Key）
 *
 * 免费档：25 req/min，500 req/day，OCR + search + filing-number
 * 注册地址：https://developer.companyhouse.gov.uk/
 *
 * 注意：uk-region 参数仅影响搜索权重，不做硬过滤；如需限定英国公司，
 * 响应中的 address_snippet 已包含 UK 地址，自然区分
 */

interface CompaniesHouseItem {
  title: string;
  description?: string;
  company_number?: string;
  company_type?: string;
  address?: {
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  date_of_creation?: string;
  company_status?: string;
}

interface CompaniesHouseResponse {
  total_results?: number;
  items?: CompaniesHouseItem[];
}

export interface CompaniesHouseClientOptions {
  apiKey: string;
  http: HttpClient;
}

export class CompaniesHouseClient implements SearchClient {
  readonly provider = 'companies-house';

  private readonly apiKey: string;
  private readonly http: HttpClient;
  private readonly endpoint = 'https://api.companyhouse.gov.uk';

  constructor(options: CompaniesHouseClientOptions) {
    this.apiKey = options.apiKey;
    this.http = options.http;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    if (!this.apiKey) {
      throw new Error(
        'Companies House API key required. Get one free at https://developer.companyhouse.gov.uk/ (500 req/day free tier).'
      );
    }

    const count = Math.min(query.count ?? 10, 20);
    const params = new URLSearchParams({
      q: query.keyword,
      items_per_page: String(count),
      start_index: String((query.offset ?? 0) * count),
    });

    const response = await this.http.request<CompaniesHouseResponse>(
      `${this.endpoint}/search/companies?${params}`,
      {
        headers: {
          Authorization: `Basic ${btoa(`${this.apiKey}:`)}`,
          Accept: 'application/json',
        },
        throttleKey: 'api.companyhouse.gov.uk',
      }
    );

    const items = response.data?.items ?? [];
    return items.map((item) => {
      const addressParts = [
        item.address?.locality,
        item.address?.postal_code,
        item.address?.country,
      ]
        .filter(Boolean)
        .join(', ');
      return {
        title: item.title ?? 'Unknown',
        url: item.company_number
          ? `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}`
          : '',
        snippet:
          [
            item.company_type ? `Type: ${item.company_type}` : null,
            addressParts ? `Address: ${addressParts}` : null,
            item.date_of_creation ? `Incorporated: ${item.date_of_creation}` : null,
            item.company_status ? `Status: ${item.company_status}` : null,
            item.description ? item.description.slice(0, 200) : null,
          ]
            .filter(Boolean)
            .join(' | ') || null,
        provider: this.provider,
      };
    });
  }
}
