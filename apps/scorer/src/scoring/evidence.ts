/**
 * Signal-level Evidence（docs/pcb-alignment.md §9、§15-§18）
 *
 * 每个重要信号在产生时就尽量绑定：signal + source + snippet + confidence。
 * 这是「为什么是这个公司 / 为什么现在」可解释性的根基，贯穿采集 → 检测 → 打分 → 解释。
 *
 * 证据不是价值，而是对某个 Signal 的可信程度；不单独作为加分项，
 * 而是作为 signal 的 confidence 乘数作用到对应维度分数上。
 */

export type EvidenceSignalType =
  | 'industry_fit'
  | 'hardware_product'
  | 'pcb_relevance'
  | 'demand'
  | 'negative'
  | 'company_fit';

export interface Evidence {
  signalType: EvidenceSignalType;
  description: string;
  snippet?: string;
  sourceUrl?: string;
  sourceType?: string;
  detectedAt?: string;
  confidence: number;
}

export interface EvidenceInput {
  signalType: EvidenceSignalType;
  description: string;
  snippet?: string;
  sourceUrl?: string;
  sourceType?: string;
  confidence?: number;
}

/** 归一化 confidence 到 [0,1]，并补默认 sourceType / detectedAt */
export function makeEvidence(input: EvidenceInput): Evidence {
  const confidence = clamp01(input.confidence ?? 1);
  return {
    signalType: input.signalType,
    description: input.description,
    snippet: input.snippet,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType ?? 'website',
    detectedAt: new Date().toISOString(),
    confidence,
  };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
