import type { DimensionBreakdown } from '@pcb/types';
import { scoreBuyerFit } from './buyer-fit.ts';
import { scoreDemand } from './demand.ts';
import type { Evidence } from './evidence.ts';
import { scoreNegative } from './negative.ts';

export * from './industry.ts';
export * from './keywords.ts';
export * from './hardware-fit.ts';
export * from './company-fit.ts';
export * from './demand.ts';
export * from './negative.ts';
export * from './evidence.ts';
export * from './context.ts';
// 保留旧的联系人/规模打分维度导出，供 P1 Contact Ranking 复用
export * from './role.ts';
export * from './size.ts';
export * from './reachability.ts';

export const SCORING_MODEL_VERSION = 'v2';

export interface ScoreCompanyInput {
  industry?: string | null;
  description?: string | null;
  rawPayload?: unknown;
  sizeBucket?: string | null;
  employeeCount?: number | null;
  fundingStage?: string | null;
}

export interface LeadScoreResult {
  score: number;
  grade: 'A' | 'B' | 'C';
  buyerFit: number;
  demandSignal: number;
  negativePenalty: number;
  excluded: boolean;
  reason: string;
  dimensionBreakdown: DimensionBreakdown;
  evidence: Evidence[];
  modelVersion: string;
}

/**
 * 打分主入口（v2 领域对齐模型）
 *
 * Final Score = clamp(Buyer Fit + Demand Signal - Negative Penalty, 0, 100)
 * - Buyer Fit (0-60) = Industry(15) + Hardware/Product(20) + PCB Relevance(15) + Company(10)
 * - Demand Signal (0-30)
 * - Negative Penalty (0-10)
 *
 * 分级阈值（spec.md §12）：A ≥ 75 / B 50-74 / C < 50
 * hard negative（如 PCB 制造商自身）→ excluded=true，仍计算分数但 Lead 不进主要销售池。
 */
export function scoreLead(company: ScoreCompanyInput): LeadScoreResult {
  const buyerFit = scoreBuyerFit(company);
  const demand = scoreDemand(company);
  const negative = scoreNegative(company);

  const finalScore = clamp(buyerFit.score + demand.score - negative.penalty, 0, 100);

  const grade: 'A' | 'B' | 'C' = finalScore >= 75 ? 'A' : finalScore >= 50 ? 'B' : 'C';

  const dimensionBreakdown: DimensionBreakdown = {
    ...buyerFit.dimensionBreakdown,
    demandSignal: demand.score,
    negativePenalty: negative.penalty,
  };

  const evidence: Evidence[] = [
    ...buyerFit.evidence,
    ...demand.signals.map((s) => s.evidence),
    ...negative.signals,
  ];

  const reason = [
    buyerFit.reason,
    `[Demand ${demand.score}/30] ${demand.reason}`,
    `[Negative -${negative.penalty}/10] ${negative.reason}${negative.excluded ? ' (EXCLUDED)' : ''}`,
  ].join('\n');

  return {
    score: finalScore,
    grade,
    buyerFit: buyerFit.score,
    demandSignal: demand.score,
    negativePenalty: negative.penalty,
    excluded: negative.excluded,
    reason,
    dimensionBreakdown,
    evidence,
    modelVersion: SCORING_MODEL_VERSION,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
