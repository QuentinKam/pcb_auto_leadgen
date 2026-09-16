/**
 * 维度：Demand Signal（满分 30）
 *
 * 回答「为什么现在值得联系」（pcb-alignment.md §2/§8，prompt §11-§12）。
 *
 * 不是简单字符串匹配：至少考虑 keyword + context + company identity + 上下文句 + confidence。
 * 本实现为 Rule-based detection（可后续叠加 LLM 上下文分类），
 * 区分「买家自述需求」与「服务商替他人找供应商」。
 */

import { collectCompanyText } from './context.ts';
import { clamp01, makeEvidence, type Evidence } from './evidence.ts';

export type DemandTier = 1 | 2 | 3;

export interface DemandSignal {
  tier: DemandTier;
  signalType: string;
  description: string;
  snippet?: string;
  sourceUrl?: string;
  confidence: number;
  evidence: Evidence;
}

export interface DemandResult {
  score: number;
  tier: DemandTier | null;
  signals: DemandSignal[];
  reason: string;
}

const TIER_SCORE: Record<DemandTier, number> = { 1: 30, 2: 18, 3: 8 };
const TIER_BASE_CONFIDENCE: Record<DemandTier, number> = { 1: 0.85, 2: 0.7, 3: 0.5 };

const DEMAND_PATTERNS: Array<{ tier: DemandTier; type: string; pattern: string }> = [
  // Tier 1 — Strong Demand
  { tier: 1, type: 'rfq', pattern: 'rfq' },
  { tier: 1, type: 'rfq', pattern: 'request for quote' },
  { tier: 1, type: 'rfq', pattern: 'request for quotation' },
  { tier: 1, type: 'supplier_search', pattern: 'looking for a pcb supplier' },
  { tier: 1, type: 'supplier_search', pattern: 'looking for pcb supplier' },
  { tier: 1, type: 'supplier_search', pattern: 'looking for pcba supplier' },
  { tier: 1, type: 'sourcing', pattern: 'pcb sourcing' },
  { tier: 1, type: 'sourcing', pattern: 'pcba sourcing' },
  { tier: 1, type: 'sourcing', pattern: 'sourcing pcb' },
  { tier: 1, type: 'sourcing', pattern: 'sourcing pcba' },
  { tier: 1, type: 'new_product', pattern: 'new hardware product' },
  { tier: 1, type: 'new_project', pattern: 'new hardware project' },
  { tier: 1, type: 'product_launch', pattern: 'product launch' },
  { tier: 1, type: 'expansion', pattern: 'production expansion' },
  { tier: 1, type: 'expansion', pattern: 'manufacturing expansion' },
  { tier: 1, type: 'expansion', pattern: 'new factory' },
  // Tier 1 — Outsourcing signals（10-K Item 1 叙述体中的强采购信号）
  // 公司自述把制造外包给合同制造商 = 明确买家。patterns 含第一人称 "our/the" 或被动语态，
  // 避免匹配供应商 "outsourced manufacturing partner used by our customers"（Fabrinet）。
  { tier: 1, type: 'outsourcing', pattern: 'outsource our manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'outsource the manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'outsource all manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'outsource our hardware manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'outsourcing our manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'outsourced our manufacturing' },
  { tier: 1, type: 'outsourcing', pattern: 'manufactured by contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'produced by contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'assembled by contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'rely on contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'depend on contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'relied on contract manufacturers' },
  { tier: 1, type: 'outsourcing', pattern: 'products are manufactured by' },
  { tier: 1, type: 'outsourcing', pattern: 'products are assembled by' },

  // Tier 2 — Medium Demand
  { tier: 2, type: 'hiring', pattern: 'hiring hardware engineer' },
  { tier: 2, type: 'hiring', pattern: 'hiring electronics engineer' },
  { tier: 2, type: 'hiring', pattern: 'hiring pcb design engineer' },
  { tier: 2, type: 'hiring', pattern: 'hiring pcb engineer' },
  { tier: 2, type: 'hiring', pattern: 'hardware engineer' },
  { tier: 2, type: 'hiring', pattern: 'electronics engineer' },
  { tier: 2, type: 'expansion', pattern: 'engineering team expansion' },
  { tier: 2, type: 'expansion', pattern: 'electronics engineering expansion' },
  { tier: 2, type: 'project', pattern: 'new project' },
  { tier: 2, type: 'funding', pattern: 'series a' },
  { tier: 2, type: 'funding', pattern: 'series b' },
  { tier: 2, type: 'funding', pattern: 'seed funding' },
  { tier: 2, type: 'funding', pattern: 'hardware funding' },
  // Tier 2 — geographic CM mention（"contract manufacturers in Asia/Taiwan/Mexico"）
  { tier: 2, type: 'outsourcing', pattern: 'contract manufacturers in' },

  // Tier 3 — Weak Demand（显式措辞，避免与 Buyer Fit 重复）
  { tier: 3, type: 'existing_product', pattern: 'existing hardware product' },
  { tier: 3, type: 'electronics_team', pattern: 'electronics team' },
  { tier: 3, type: 'capability', pattern: 'electronics development capability' },
  { tier: 3, type: 'product_line', pattern: 'hardware product line' },
];

/** 买家自述需求的口吻 */
const BUYER_MARKERS = [
  'we are looking for',
  'we are seeking',
  'we need',
  'we are hiring',
  'we are launching',
  'we are expanding',
  'we are building',
  'we are developing',
  'we require',
  'seeking a pcb',
  // 10-K 叙述体中第一人称外包 = 买家
  'we outsource',
  'we currently outsource',
  'we rely on',
  'we depend on',
  'our products are',
  'our manufacturing is',
];

/** 服务商替他人找供应商的口吻 → 不是买家需求 */
const PROVIDER_MARKERS = [
  'we help',
  'we provide',
  'we offer',
  'our clients',
  'for our customers',
  'we serve',
  'helping companies',
  'we assist',
];

export function scoreDemand(company: {
  description?: string | null;
  rawPayload?: unknown;
}): DemandResult {
  const { fields } = collectCompanyText(company);
  if (fields.length === 0) {
    return { score: 0, tier: null, signals: [], reason: 'No text to scan for demand signals' };
  }

  const signals: DemandSignal[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    for (const sentence of splitSentences(field.value)) {
      const lower = sentence.toLowerCase();

      // 服务商口吻 → 不是买家需求，直接跳过
      if (PROVIDER_MARKERS.some((m) => lower.includes(m))) continue;

      for (const rule of DEMAND_PATTERNS) {
        if (!lower.includes(rule.pattern)) continue;
        const key = `${rule.type}:${rule.pattern}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const buyerTone = BUYER_MARKERS.some((m) => lower.includes(m));
        const confidence = clamp01(TIER_BASE_CONFIDENCE[rule.tier] + (buyerTone ? 0.1 : 0));

        signals.push({
          tier: rule.tier,
          signalType: rule.type,
          description: `Detected ${describeTier(rule.tier)} demand: "${rule.pattern}"`,
          snippet: sentence.trim(),
          sourceUrl: field.sourceUrl,
          confidence,
          evidence: makeEvidence({
            signalType: 'demand',
            description: `Detected ${describeTier(rule.tier)} demand: "${rule.pattern}"`,
            snippet: sentence.trim(),
            sourceUrl: field.sourceUrl,
            confidence,
          }),
        });
        break; // 一句只记最高优先级命中即可
      }
    }
  }

  if (signals.length === 0) {
    return { score: 0, tier: null, signals: [], reason: 'No demand signal detected' };
  }

  // 取最高 Tier 的信号作为需求分；同 Tier 取 confidence 最高
  const best = signals.reduce((acc, s) =>
    s.tier < acc.tier || (s.tier === acc.tier && s.confidence > acc.confidence) ? s : acc
  );
  const score = Math.min(30, Math.round(TIER_SCORE[best.tier] * best.confidence));

  return {
    score,
    tier: best.tier,
    signals,
    reason: `Strongest demand: ${describeTier(best.tier)} (${best.signalType}, confidence ${best.confidence.toFixed(2)})`,
  };
}

function describeTier(tier: DemandTier): string {
  return tier === 1 ? 'Tier 1 (strong)' : tier === 2 ? 'Tier 2 (medium)' : 'Tier 3 (weak)';
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
