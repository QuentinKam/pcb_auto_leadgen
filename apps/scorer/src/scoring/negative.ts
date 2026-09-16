/**
 * 维度：Negative Signal（0-10 penalty）
 *
 * 区分两类（prompt §13-§14）：
 * - Hard Negative（excluded=true）：PCB 制造商 / EMS / 代工厂 / 分销商 —— 当目标是「终端 PCB 买家」时，
 *   这类公司是供应商而非买家，Final Score 仍可计算，但 Lead 不进入主要销售池。
 * - Soft Negative（penalty）：纯软件 / SaaS / 招聘 / 代理 / 咨询等低相关公司，只做扣分。
 *
 * Hard Negative 的判断不写死「永远排除」：HARD_NEGATIVE_PATTERNS 是明确的配置点，
 * 未来可迁移到 env / DB 租户级业务配置。
 */

import { collectCompanyText } from './context.ts';
import { makeEvidence, type Evidence } from './evidence.ts';
import { detectPcbManufacturerContext, isSelfDescribedMatch } from './keywords.ts';

/** Hard Negative（配置点）：目标为终端买家时，这些是供应商/服务商，直接 excluded */
// 'contract manufacturer' 不在此列：供应链写法（"made by contract manufacturers"）
// 是买家语境，只有自称结构才排除（见 keywords.ts SELF_DESCRIBED_CM_RE → detector）
const HARD_NEGATIVE_PATTERNS = [
  'ems provider',
  'electronics manufacturing service',
  'pcb distributor',
  'pcb manufacturer',
  'pcb fabrication',
  'pcb assembly provider',
  'pcba provider',
];

/** Soft Negative：低相关，只扣分不排除 */
const SOFT_NEGATIVE_PATTERNS = [
  'software company',
  'saas',
  'recruitment',
  'recruiting agency',
  'staffing agency',
  'marketing agency',
  'digital agency',
  'consulting',
  'it services',
];

const HARD_PENALTY = 10;
const SOFT_PENALTY = 4;

export interface NegativeResult {
  penalty: number;
  excluded: boolean;
  signals: Evidence[];
  reason: string;
}

export function scoreNegative(company: {
  description?: string | null;
  rawPayload?: unknown;
}): NegativeResult {
  const { fields, haystack } = collectCompanyText(company);

  if (!haystack) {
    return { penalty: 0, excluded: false, signals: [], reason: 'No text to scan for negative signals' };
  }

  // 外包语境（"we outsource to contract manufacturers"）下公司是买家，不算 hard negative
  const hardHits = HARD_NEGATIVE_PATTERNS.filter((p) => isSelfDescribedMatch(haystack, p));
  const isPcbManufacturer = detectPcbManufacturerContext(haystack) || hardHits.length > 0;

  if (isPcbManufacturer) {
    const patterns = hardHits.length > 0 ? hardHits : ['pcb manufacturer/provider context'];
    return {
      penalty: HARD_PENALTY,
      excluded: true,
      signals: patterns.map((p) =>
        makeEvidence({
          signalType: 'negative',
          description: `Hard negative: company is a PCB manufacturer/EMS/provider ("${p}"), not an end buyer`,
          snippet: snippetContaining(fields, [p]),
          confidence: 0.8,
        })
      ),
      reason: 'PCB manufacturer/EMS/provider — excluded from end-buyer lead pool',
    };
  }

  const softHits = SOFT_NEGATIVE_PATTERNS.filter((p) => haystack.includes(p));
  if (softHits.length > 0) {
    return {
      penalty: SOFT_PENALTY,
      excluded: false,
      signals: softHits.map((p) =>
        makeEvidence({
          signalType: 'negative',
          description: `Soft negative: low PCB relevance ("${p}")`,
          snippet: snippetContaining(fields, [p]),
          confidence: 0.6,
        })
      ),
      reason: `Low relevance signals: ${softHits.join(', ')}`,
    };
  }

  return { penalty: 0, excluded: false, signals: [], reason: 'No negative signal detected' };
}

function snippetContaining(fields: Array<{ value: string }>, needles: string[]): string | undefined {
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
