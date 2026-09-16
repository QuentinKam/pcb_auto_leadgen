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
  /** 归一化行业 slug（与 scorer industry 词表对齐），无法判定时为 null / 省略 */
  industry?: string | null;
  /** EDGAR 专用：10-K accession number（带横线，如 0000897723-20-000034），供年报 enrich 拼路径 */
  accessionDir?: string | null;
}

export interface SearchClient {
  readonly provider: string;
  search(query: SearchQuery): Promise<SearchHit[]>;
}
