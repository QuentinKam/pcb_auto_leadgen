import type { CollectorConfig } from '../../config.ts';
import type { HttpClient } from '../../net/http.ts';
import { BraveSearchClient } from './brave.ts';
import { DuckDuckGoSearchClient } from './duckduckgo.ts';
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
 * 目前实现 brave（付费额度）与 duckduckgo（免费抓取）；tavily / serpapi 仅保留契约未实现。
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
