/** 采集链路上的公司候选（未落库前的中间态） */
export interface LeadCandidate {
  name: string;
  domain: string;
  website: string;
  description: string | null;
  industry: string | null;
  country: string | null;
  employeeCount: number | null;
  sizeBucket: string | null;
  fundingStage: string | null;
  about: string | null;
  products: string[];
  services: string[];
  industrySignals: string[];
  emails: string[];
  /** EDGAR 专用：10-K accession number（带横线），供年报 enrich 拼路径 */
  accessionDir: string | null;
  /** 官网正文汇总，用于规则推断（不落库） */
  text: string;
  sources: string[];
  /** 字段 → 来源 URL 列表（Signal-level Evidence 来源） */
  fieldSources: Record<string, string[]>;
}
