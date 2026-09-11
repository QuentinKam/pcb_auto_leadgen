/**
 * 维度：Company Fit（满分 10，属于 Buyer Fit 子维度）
 *
 * 公司规模 / 融资阶段作为「弱信号」（prompt §10）：规模主要用于 Contact Ranking（找谁），
 * 而不是决定「是不是客户」。因此这里只给较低的分数，不再把 50-500 员工当作强 Buyer Fit。
 */

import { makeEvidence, type Evidence } from './evidence.ts';

const MAX_SCORE = 10;

export interface CompanyFitResult {
  score: number;
  reason: string;
  evidence: Evidence[];
}

export function scoreCompanyFit(company: {
  sizeBucket?: string | null;
  employeeCount?: number | null;
  fundingStage?: string | null;
}): CompanyFitResult {
  const { sizeBucket, employeeCount, fundingStage } = company;

  let score = 0;
  const reasons: string[] = [];
  const evidence: Evidence[] = [];

  // 有规模数据 → 基础分（弱），避免把规模当成强信号
  if (sizeBucket || (employeeCount && employeeCount > 0)) {
    score += 5;
    reasons.push(`Size ${sizeBucket ?? employeeCount} provides moderate company quality`);
  }

  // 融资/成熟度作为弱加分（近 12 个月融资或已上市）
  if (fundingStage && ['seed', 'a', 'b', 'c', 'd', 'ipo', 'acquired'].includes(fundingStage)) {
    score += 5;
    reasons.push(`Funding stage ${fundingStage} indicates active growth`);
    evidence.push(
      makeEvidence({
        signalType: 'company_fit',
        description: `Funding stage "${fundingStage}" indicates an active hardware company`,
        confidence: 0.6,
      })
    );
  }

  const reason =
    reasons.length > 0 ? reasons.join('; ') : 'No size or funding data available';

  return { score, reason, evidence };
}
