import type { HttpClient } from '../../net/http.ts';
import type { SearchClient, SearchHit, SearchQuery } from './types.ts';

/**
 * SEC EDGAR 搜索客户端（免费，无需 API Key）
 *
 * 文档：https://efts.sec.gov/LATEST/search-index?q=...
 * 要求：User-Agent 必须包含联系信息（格式：<公司名> <邮箱>）
 * 覆盖：美国上市公司（主板/OTC）
 *
 * 搜索逻辑：按关键词搜 10-K/10-K405 年报（年报里提 PCB/electronics 的公司）
 * SIC 3672 = 印刷电路板（PCB），是核心筛选维度
 */

interface EdgarHit {
  display_names: string[];
  ciks: string[];
  sics: string[];
  biz_locations: string[];
  file_date: string;
  form: string;
}

interface EdgarSearchResponse {
  hits: {
    total: { value: number };
    hits: Array<{ _id: string; _source: EdgarHit }>;
  };
}

/**
 * SIC 码 → 行业 slug（scorer industry 词表）+ 可读名称。
 * 只收录 PCB 买家密集的电子/电气/仪器/医疗/汽车类，未收录码不做行业判定。
 * SIC 名称来源：SEC 官方 SIC 列表（https://www.sec.gov/corpfin/division-of-corporation-finance-standard-industrial-classification-sic-code-list）
 */
const SIC_INDUSTRY: Record<string, { slug: string; label: string }> = {
  '3571': { slug: 'hardware', label: 'Electronic Computers' },
  '3575': { slug: 'hardware', label: 'Computer Terminals' },
  '3577': { slug: 'hardware', label: 'Computer Peripheral Equipment' },
  '3620': { slug: 'industrial_equipment', label: 'Electrical Industrial Apparatus' },
  '3621': { slug: 'industrial_equipment', label: 'Motors and Generators' },
  '3647': { slug: 'automotive', label: 'Vehicular Lighting Equipment' },
  '3661': { slug: 'telecommunications', label: 'Telephone and Telegraph Apparatus, Communication Equipment' },
  '3663': { slug: 'telecommunications', label: 'Radio, TV and Communication Equipment' },
  '3670': { slug: 'hardware', label: 'Electronic Components' },
  '3674': { slug: 'semiconductor', label: 'Semiconductors and Related Devices' },
  '3678': { slug: 'hardware', label: 'Electronic Connectors' },
  '3679': { slug: 'hardware', label: 'Electronic Components' },
  '3690': { slug: 'hardware', label: 'Miscellaneous Electrical Equipment and Supplies' },
  '3714': { slug: 'automotive', label: 'Motor Vehicle Parts and Accessories' },
  '3812': { slug: 'aerospace_electronics', label: 'Search, Detection, Navigation, Aeronautical Systems' },
  '3825': { slug: 'electronic_instruments', label: 'Instruments to Measure Electricity' },
  '3826': { slug: 'test_measurement', label: 'Laboratory Analytical Instruments' },
  '3829': { slug: 'electronic_instruments', label: 'Measuring and Controlling Instruments' },
  '3841': { slug: 'medical_devices', label: 'Surgical and Medical Devices, Instruments' },
  '3845': { slug: 'medical_electronics', label: 'Electromedical and Electrotherapeutic Apparatus' },
};

export interface EdgarSearchClientOptions {
  /** SEC 强制要求的 UA 标识，格式：<公司名> <邮箱> */
  userAgent: string;
  http: HttpClient;
  /** 最早文件日期，默认 2020-01-01 */
  startDate?: string;
  /** 最晚文件日期，默认为今天 */
  endDate?: string;
}

export class EdgarSearchClient implements SearchClient {
  readonly provider = 'edgar';

  private readonly http: HttpClient;
  private readonly userAgent: string;
  private readonly startDate: string;
  private readonly endDate: string;

  constructor(options: EdgarSearchClientOptions) {
    this.http = options.http;
    this.userAgent = options.userAgent;
    const now = new Date().toISOString().slice(0, 10);
    this.startDate = options.startDate ?? '2020-01-01';
    this.endDate = options.endDate ?? now;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const count = Math.min(query.count ?? 10, 20);
    const offset = (query.offset ?? 0) * count;

    const params = new URLSearchParams({
      q: query.keyword,
      forms: '10-K,10-K405', // 年报信息量最大，最容易搜到业务描述
      dateRange: 'custom',
      startdt: this.startDate,
      enddt: this.endDate,
      from: String(offset),
      size: String(count),
    });

    const url = `https://efts.sec.gov/LATEST/search-index?${params}`;

    let data: EdgarSearchResponse;
    try {
      const response = await this.http.request<unknown>(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        throttleKey: 'efts.sec.gov',
      });
      data = response.data as EdgarSearchResponse;
    } catch {
      // EDGAR 返回 200 但无 hits 字段时返回空
      return [];
    }

    const hits = data?.hits?.hits ?? [];

    // EDGAR 会返回同一公司多个年度的年报，按 CIK 去重（保留首次出现）
    const seenCiks = new Set<string>();
    const mapped: SearchHit[] = [];

    for (const hit of hits) {
      const src = hit._source;
      const cik = src.ciks?.[0] ?? '';
      if (cik) {
        if (seenCiks.has(cik)) continue;
        seenCiks.add(cik);
      }

      // _id 形如 "0000897723-20-000034:sanm-20201003.htm"（accession:命中文件名）。
      // 文件名常指向附件（EX-21/EX-10），只取 accession，主文档由年报 enrich 重新定位
      const accessionDir = hit._id.split(':')[0] ?? '';

      const displayName = src.display_names?.[0] ?? '';
      // display_names 形如 "SANMINA CORP  (SANM)  (CIK 0000897723)"，
      // 也可能只有 "OMPHALOS, CORP  (CIK 0001103640)"
      const companyName = displayName
        .replace(/\s*\([^)]*\)\s*\([^)]*\)\s*$/, '')
        .replace(/\s*\(CIK\s+\d+\)\s*$/i, '')
        .trim();
      const sic = src.sics?.[0] ?? '';
      const sicInfo = sic ? SIC_INDUSTRY[sic] : undefined;
      const location = src.biz_locations?.[0] ?? '';
      const fileDate = src.file_date ?? '';
      // 用 CIK 构造虚拟域名，形如 cik-0000897723.edgar.sec.gov：
      // normalize 的 SPECIAL_ACCEPT 白名单放行 *.edgar.sec.gov，pipeline 据此跳过官网 enrich
      const edgarDomain = cik ? `cik-${cik.padStart(10, '0')}.edgar.sec.gov` : '';

      mapped.push({
        title: companyName || displayName,
        url: edgarDomain
          ? `https://${edgarDomain}`
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
        snippet:
          [
            sic ? `SIC: ${sic}${sicInfo ? ` ${sicInfo.label}` : ''}` : null,
            location ? `Location: ${location}` : null,
            fileDate ? `Filed: ${fileDate}` : null,
            sic === '3672' ? '[PCB Manufacturer]' : null,
          ]
            .filter(Boolean)
            .join(' | ') || null,
        provider: this.provider,
        // SIC 3672 是同行（PCB 制造商），slug 置空；交给 scorer negative 维度排除
        industry: sic === '3672' ? null : (sicInfo?.slug ?? null),
        accessionDir: accessionDir || null,
      });
    }

    // EDGAR 忽略 size 参数（固定最多返回 100 条），在客户端截断到请求数量
    return mapped.slice(0, count);
  }
}
