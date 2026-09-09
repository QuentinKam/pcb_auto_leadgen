import type { Company, Contact } from '@pcb/db';
import type { DimensionBreakdown } from '@pcb/types';
import { scoreIndustry } from './industry.ts';
import { scoreKeywords } from './keywords.ts';
import { scoreRole } from './role.ts';
import { scoreSize } from './size.ts';
import { scoreReachability } from './reachability.ts';

export * from './industry.ts';
export * from './keywords.ts';
export * from './role.ts';
export * from './size.ts';
export * from './reachability.ts';

export const SCORING_MODEL_VERSION = 'v1';

export interface LeadScoreResult {
  score: number;
  grade: 'A' | 'B' | 'C';
  reason: string;
  dimensionBreakdown: DimensionBreakdown;
  modelVersion: string;
}

/**
 * 打分主入口：聚合 5 个维度，输出 0-100 分 + A/B/C 分级 + 打分理由
 *
 * 分级阈值（spec.md 第 12 节）：
 * - A: 75-100（高意向）
 * - B: 50-74（中等意向）
 * - C: 0-49（低意向）
 *
 * 各维度满分总和 = 100：
 *   industry 30 + pcb_keywords 25 + role 20 + size 15 + reachability 10
 */
export function scoreLead(
  company: Pick<Company, 'industry' | 'description' | 'rawPayload' | 'sizeBucket' | 'employeeCount'>,
  contact: Pick<Contact, 'title' | 'emailVerified' | 'linkedinUrl'> | null,
): LeadScoreResult {
  const industry = scoreIndustry(company);
  const keywords = scoreKeywords(company);
  const role = scoreRole(contact);
  const size = scoreSize(company);
  const reachability = scoreReachability(contact);

  const dimensionBreakdown: DimensionBreakdown = {
    industry: industry.score,
    pcb_keywords: keywords.score,
    role: role.score,
    size: size.score,
    reachability: reachability.score,
  };

  const totalScore =
    industry.score + keywords.score + role.score + size.score + reachability.score;

  const grade: 'A' | 'B' | 'C' = totalScore >= 75 ? 'A' : totalScore >= 50 ? 'B' : 'C';

  const reason = [
    `[Industry ${industry.score}/30] ${industry.reason}`,
    `[Keywords ${keywords.score}/25] ${keywords.reason}`,
    `[Role ${role.score}/20] ${role.reason}`,
    `[Size ${size.score}/15] ${size.reason}`,
    `[Reachability ${reachability.score}/10] ${reachability.reason}`,
  ].join('\n');

  return {
    score: totalScore,
    grade,
    reason,
    dimensionBreakdown,
    modelVersion: SCORING_MODEL_VERSION,
  };
}
