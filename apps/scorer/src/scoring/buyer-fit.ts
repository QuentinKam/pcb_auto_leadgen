/**
 * Buyer Fit（满分 60）
 *
 * 回答「这家公司是不是适合 PCB/PCBA 销售开发的潜在客户」。
 * = Industry Fit(15) + Hardware/Product Fit(20) + PCB Relevance(15) + Company Fit(10)
 *
 * 不把 Demand 混入 Buyer Fit（Demand 单独维度），也不把规模当成强信号（prompt §6/§10）。
 */

import { scoreCompanyFit } from './company-fit.ts';
import type { Evidence } from './evidence.ts';
import { scoreHardwareFit } from './hardware-fit.ts';
import { scoreIndustry } from './industry.ts';
import { scoreKeywords } from './keywords.ts';

export interface BuyerFitResult {
  score: number;
  dimensionBreakdown: {
    industryFit: number;
    hardwareProductFit: number;
    pcbRelevance: number;
    companyFit: number;
  };
  evidence: Evidence[];
  reason: string;
}

export function scoreBuyerFit(company: {
  industry?: string | null;
  description?: string | null;
  rawPayload?: unknown;
  sizeBucket?: string | null;
  employeeCount?: number | null;
  fundingStage?: string | null;
}): BuyerFitResult {
  const industry = scoreIndustry(company);
  const hardware = scoreHardwareFit(company);
  const pcb = scoreKeywords(company);
  const companyFit = scoreCompanyFit(company);

  const dimensionBreakdown = {
    industryFit: industry.score,
    hardwareProductFit: hardware.score,
    pcbRelevance: pcb.score,
    companyFit: companyFit.score,
  };

  const score = industry.score + hardware.score + pcb.score + companyFit.score;
  const evidence: Evidence[] = [
    ...industry.evidence,
    ...hardware.evidence,
    ...pcb.evidence,
    ...companyFit.evidence,
  ];

  const reason = [
    `[Industry ${industry.score}/15] ${industry.reason}`,
    `[Hardware ${hardware.score}/20] ${hardware.reason}`,
    `[PCB ${pcb.score}/15] ${pcb.reason}`,
    `[Company ${companyFit.score}/10] ${companyFit.reason}`,
  ].join('\n');

  return { score, dimensionBreakdown, evidence, reason };
}
