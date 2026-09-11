/**
 * 维度：Industry Fit（满分 15，属于 Buyer Fit 子维度）
 *
 * 覆盖 docs/pcb-alignment.md §3 Target Buyer 与 prompt §7 的行业列表。
 * 保持可维护，不做几百个行业的机械枚举。
 *
 * 分值：
 * - target：15（高频 PCB 买家）
 * - related：8（可能采购 PCB 的相关行业）
 * - none：0
 *
 * 注意：electronics_manufacturing / EMS / contract manufacturer 属于 Negative Signal，
 * 不在 target 列表内（见 scoring/negative.ts），避免把「PCB 制造商自身」误判为买家。
 */

import { makeEvidence, type Evidence } from './evidence.ts';

const TARGET_INDUSTRIES = new Set([
  'hardware',
  'embedded_systems',
  'robotics',
  'industrial_automation',
  'industrial_equipment',
  'iot',
  'consumer_electronics',
  'medical_devices',
  'medical_electronics',
  'automotive',
  'automotive_electronics',
  'drones',
  'uav',
  'smart_home',
  'electronic_instruments',
  'energy',
  'battery',
  'power_electronics',
  'telecom',
  'telecommunications',
  'aerospace',
  'aerospace_electronics',
  'defense_electronics',
  'wearables',
  'sensors',
  'control_systems',
]);

const RELATED_INDUSTRIES = new Set([
  'semiconductor',
  'test_measurement',
  'security',
  'energy_storage',
]);

const MAX_SCORE = 15;
const RELATED_SCORE = 8;

export interface IndustryScoreResult {
  score: number;
  matched: 'target' | 'related' | 'none';
  reason: string;
  evidence: Evidence[];
}

export function scoreIndustry(company: { industry?: string | null }): IndustryScoreResult {
  const industry = company.industry?.toLowerCase().trim();

  if (!industry) {
    return {
      score: 0,
      matched: 'none',
      reason: 'Industry field is empty',
      evidence: [],
    };
  }

  if (TARGET_INDUSTRIES.has(industry)) {
    return {
      score: MAX_SCORE,
      matched: 'target',
      reason: `Industry "${industry}" is a high-frequency PCB buyer`,
      evidence: [
        makeEvidence({
          signalType: 'industry_fit',
          description: `Industry "${industry}" matches a Tier-1 PCB buyer sector`,
          confidence: 0.85,
        }),
      ],
    };
  }

  if (RELATED_INDUSTRIES.has(industry)) {
    return {
      score: RELATED_SCORE,
      matched: 'related',
      reason: `Industry "${industry}" may purchase PCBs (related sector)`,
      evidence: [
        makeEvidence({
          signalType: 'industry_fit',
          description: `Industry "${industry}" matches a related PCB buyer sector`,
          confidence: 0.6,
        }),
      ],
    };
  }

  return {
    score: 0,
    matched: 'none',
    reason: `Industry "${industry}" is not in PCB buyer list`,
    evidence: [],
  };
}
