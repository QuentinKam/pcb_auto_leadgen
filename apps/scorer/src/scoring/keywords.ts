/**
 * 维度：PCB Relevance（满分 15，属于 Buyer Fit 子维度）
 *
 * 不要只用简单词频（prompt §9 / pcb-alignment.md §9）：必须考虑上下文。
 * 例："We manufacture PCBs" 表示这家公司是 PCB 制造商（买家反面），不应因此加分。
 *
 * 命中 PCB 买家关键词按词频给分；命中「制造商语境」则归零并标记 manufacturerContext，
 * 由 scoring/negative.ts 进一步判断是否 hard negative（excluded）。
 */

import { collectCompanyText } from './context.ts';
import { makeEvidence, type Evidence } from './evidence.ts';

const PCB_BUYER_KEYWORDS = [
  'pcb',
  'pcba',
  'pcb assembly',
  'printed circuit board',
  'circuit board',
  'smt',
  'through-hole',
  'through hole',
  'bom',
  'gerber',
  'pick and place',
  'reflow',
  'aoi',
];

/**
 * 制造商/服务商语境：命中则说明这家公司是 PCB 供应商，而非最终买家。
 * 注意不含 'contract manufacturer' —— 该短语在年报中绝大多数是买家描述自己的供应链
 * （"hardware is produced by contract manufacturers"、"our primary contract manufacturers
 * include Foxconn"），自称必须用 SELF_DESCRIBED_CM_RE 判定。
 */
const MANUFACTURER_PATTERNS = [
  'we manufacture pcb',
  'we fabricate pcb',
  'we produce pcb',
  'pcb manufacturer',
  'pcb fabrication',
  'pcb fabrication service',
  'pcb assembly provider',
  'pcba provider',
  'ems provider',
  'electronics manufacturing service',
];

/**
 * 合同制造商的「自称」结构，如 "we are a leading contract manufacturer"。
 * 排除被动/供应链写法（"products are made by contract manufacturers"）。
 */
const SELF_DESCRIBED_CM_RE =
  /\b(?:we(?: are|'re| remain)|the company is|as a|is|are)\s+(?:a|an|one of the)\b(?:(?!\b(?:by|our|their|customer|supplier|third[- ]party)\b)[^.]){0,40}contract manufacturers?\b/i;

const MAX_SCORE = 15;

export interface KeywordScoreResult {
  score: number;
  hitCount: number;
  matchedKeywords: string[];
  manufacturerContext: boolean;
  reason: string;
  evidence: Evidence[];
}

/**
 * 外包语境信号：公司把制造「委托给」合同制造商/EMS —— 它本身是买家，不是供应商。
 * 例："we outsource our manufacturing to contract manufacturers in Taiwan"
 */
const OUTSOURCING_CONTEXT_RE =
  /\b(outsource[ds]?|outsourcing|third[- ]party|3rd[- ]party|external)\b/;
/** 判定外包语境时，向前检查的字符窗口 */
const OUTSOURCING_WINDOW = 80;

/**
 * pattern 是否以「公司自称供应商」出现。
 * 同一短语在年报里可能出现多次（如既外包又自称），只要有一次不在外包窗口内即算自称。
 */
export function isSelfDescribedMatch(haystack: string, pattern: string): boolean {
  let pos = haystack.indexOf(pattern);
  while (pos !== -1) {
    const before = haystack.slice(Math.max(0, pos - OUTSOURCING_WINDOW), pos);
    if (!OUTSOURCING_CONTEXT_RE.test(before)) return true;
    pos = haystack.indexOf(pattern, pos + pattern.length);
  }
  return false;
}

export function detectPcbManufacturerContext(haystack: string): boolean {
  return (
    MANUFACTURER_PATTERNS.some((pattern) => isSelfDescribedMatch(haystack, pattern)) ||
    SELF_DESCRIBED_CM_RE.test(haystack)
  );
}

export function scoreKeywords(company: {
  description?: string | null;
  rawPayload?: unknown;
}): KeywordScoreResult {
  const { fields, haystack } = collectCompanyText(company);

  if (!haystack) {
    return {
      score: 0,
      hitCount: 0,
      matchedKeywords: [],
      manufacturerContext: false,
      reason: 'No description or raw payload to scan',
      evidence: [],
    };
  }

  const manufacturerContext = detectPcbManufacturerContext(haystack);

  const matched: string[] = [];
  let totalHits = 0;
  for (const kw of PCB_BUYER_KEYWORDS) {
    const lower = kw.toLowerCase();
    let idx = haystack.indexOf(lower);
    let count = 0;
    while (idx !== -1 && count < 3) {
      count += 1;
      idx = haystack.indexOf(lower, idx + lower.length);
    }
    if (count > 0) {
      matched.push(kw);
      totalHits += count;
    }
  }

  // 制造商语境下不计 PCB Relevance（这家公司本身是供应商，不是买家）
  if (manufacturerContext) {
    return {
      score: 0,
      hitCount: totalHits,
      matchedKeywords: matched,
      manufacturerContext: true,
      reason: 'Company appears to be a PCB manufacturer/provider, not an end buyer',
      evidence: [
        makeEvidence({
          signalType: 'pcb_relevance',
          description: 'PCB manufacturing context detected; not counted as buyer relevance',
          snippet: firstSnippetContaining(fields, MANUFACTURER_PATTERNS),
          confidence: 0.75,
        }),
      ],
    };
  }

  let score = 0;
  if (totalHits === 0) score = 0;
  else if (totalHits <= 2) score = 7;
  else if (totalHits <= 5) score = 11;
  else score = MAX_SCORE;

  const reason =
    totalHits === 0
      ? 'No PCB-related keywords found in description or raw payload'
      : `Found ${totalHits} PCB keyword hits: ${matched.join(', ')}`;

  const evidence =
    totalHits > 0
      ? [
          makeEvidence({
            signalType: 'pcb_relevance',
            description: `Found ${totalHits} PCB keyword hits: ${matched.join(', ')}`,
            snippet: firstSnippetContaining(fields, PCB_BUYER_KEYWORDS),
            confidence: 0.7,
          }),
        ]
      : [];

  return { score, hitCount: totalHits, matchedKeywords: matched, manufacturerContext, reason, evidence };
}

function firstSnippetContaining(fields: Array<{ value: string }>, needles: string[]): string | undefined {
  for (const field of fields) {
    const hay = field.value.toLowerCase();
    for (const needle of needles) {
      const idx = hay.indexOf(needle.toLowerCase());
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(field.value.length, idx + needle.length + 80);
        return `${start > 0 ? '…' : ''}${field.value.slice(start, end).trim()}${end < field.value.length ? '…' : ''}`;
      }
    }
  }
  return undefined;
}
