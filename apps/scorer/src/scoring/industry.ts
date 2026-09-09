/**
 * 维度 1: 行业匹配度（满分 30）
 *
 * 规则 v1:
 * - 在目标行业列表中（按 PCB 采购意向排序）：满分 30
 * - 在相关行业列表中：15 分
 * - 不在任一列表中：0 分
 *
 * 目标行业（PCB 采购高频）：
 *   硬件、工业设备、医疗器械、汽车电子、消费电子、航空航天、IoT
 * 相关行业（可能采购 PCB）：
 *   通讯设备、能源、安防、测试测量、机器人
 */

const TARGET_INDUSTRIES = new Set([
  'hardware',
  'industrial_equipment',
  'medical_devices',
  'automotive',
  'consumer_electronics',
  'aerospace',
  'iot',
  'electronics_manufacturing',
]);

const RELATED_INDUSTRIES = new Set([
  'telecom',
  'energy',
  'security',
  'test_measurement',
  'robotics',
  'semiconductor',
]);

const MAX_SCORE = 30;

export interface IndustryScoreResult {
  score: number;
  matched: 'target' | 'related' | 'none';
  reason: string;
}

export function scoreIndustry(company: { industry?: string | null }): IndustryScoreResult {
  const industry = company.industry?.toLowerCase().trim();

  if (!industry) {
    return {
      score: 0,
      matched: 'none',
      reason: 'Industry field is empty',
    };
  }

  if (TARGET_INDUSTRIES.has(industry)) {
    return {
      score: MAX_SCORE,
      matched: 'target',
      reason: `Industry "${industry}" is a high-frequency PCB buyer`,
    };
  }

  if (RELATED_INDUSTRIES.has(industry)) {
    return {
      score: 15,
      matched: 'related',
      reason: `Industry "${industry}" may purchase PCBs (related sector)`,
    };
  }

  return {
    score: 0,
    matched: 'none',
    reason: `Industry "${industry}" is not in PCB buyer list`,
  };
}
