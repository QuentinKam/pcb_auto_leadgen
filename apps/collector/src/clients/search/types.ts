export interface SearchQuery {
  keyword: string;
  /** ISO-2 国家码，如 us / de / jp */
  country?: string | null;
  count?: number;
  offset?: number;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string | null;
  provider: string;
}

export interface SearchClient {
  readonly provider: string;
  search(query: SearchQuery): Promise<SearchHit[]>;
}
