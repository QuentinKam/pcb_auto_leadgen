import type { CollectorConfig } from '../../config.ts';
import type { HttpClient } from '../../net/http.ts';
import { BraveSearchClient } from './brave.ts';
import { CompaniesHouseClient } from './companies-house.ts';
import { DuckDuckGoSearchClient } from './duckduckgo.ts';
import { EdgarSearchClient } from './edgar.ts';
import { OpenCorporatesClient } from './opencorporates.ts';
import type { SearchClient } from './types.ts';

/** 搜索数据源未正确配置（缺 Key 或 provider 未实现） */
export class SearchProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderConfigError';
  }
}

/**
 * 搜索客户端工厂：通过 SEARCH_PROVIDER 切换供应商。
 *
 * | Provider          | 免费 | API Key | 说明                              |
 * |-------------------|------|---------|-----------------------------------|
 * | brave             | 否   | 需注册  | 免费档 2000 次/月                 |
 * | duckduckgo        | 是   | 不需要  | 抓 html.duckduckgo.com，需 VPN    |
 * | edgar             | 是   | 不需要  | SEC EDGAR 美国上市公司，需 UA 标识 |
 * | companies-house   | 是   | 需注册  | UK 公司注册局，免费档 500 次/天    |
 * | opencorporates    | 是   | 需注册  | 全球公开企业，免费档 100 次/天     |
 * | tavily / serpapi  | —    | —       | 保留契约，未实现                   |
 */
export function getSearchClient(config: CollectorConfig, http: HttpClient): SearchClient {
  switch (config.SEARCH_PROVIDER) {
    case 'brave': {
      if (!config.BRAVE_API_KEY) {
        throw new SearchProviderConfigError('BRAVE_API_KEY is required when SEARCH_PROVIDER=brave');
      }
      return new BraveSearchClient({ apiKey: config.BRAVE_API_KEY, http });
    }
    case 'duckduckgo':
      return new DuckDuckGoSearchClient({ http });
    case 'edgar':
      return new EdgarSearchClient({ userAgent: config.SEC_UA, http });
    case 'companies-house': {
      if (!config.COMPANIES_HOUSE_API_KEY) {
        throw new SearchProviderConfigError(
          'COMPANIES_HOUSE_API_KEY is required. Get one free at https://developer.companyhouse.gov.uk/ (500 req/day).'
        );
      }
      return new CompaniesHouseClient({ apiKey: config.COMPANIES_HOUSE_API_KEY, http });
    }
    case 'opencorporates': {
      if (!config.OPENCORPORATES_TOKEN) {
        throw new SearchProviderConfigError(
          'OPENCORPORATES_TOKEN is required. Get one free at https://opencorporates.com/api/keys (100 req/day).'
        );
      }
      return new OpenCorporatesClient({ apiToken: config.OPENCORPORATES_TOKEN, http });
    }
    case 'tavily':
    case 'serpapi':
      throw new SearchProviderConfigError(
        `${config.SEARCH_PROVIDER} search client is not implemented yet`
      );
    default:
      throw new SearchProviderConfigError(
        `Unsupported SEARCH_PROVIDER: ${String(config.SEARCH_PROVIDER)}`
      );
  }
}
