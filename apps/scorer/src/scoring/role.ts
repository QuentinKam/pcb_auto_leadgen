/**
 * 维度 3: 岗位决策权（满分 20）
 *
 * 规则 v1:
 * - 高决策权（采购经理/硬件工程师/项目经理/CTO/创始人）：20 分
 * - 中决策权（工程师/产品经理/运营）：10 分
 * - 无关岗位（销售/市场/HR/招聘）：0 分
 * - 没有联系人或职位为空：0 分
 */

const HIGH_AUTHORITY_TITLES = [
  'procurement manager',
  'purchasing manager',
  'buyer',
  'hardware engineer',
  'electrical engineer',
  'project manager',
  'program manager',
  'cto',
  'chief technology officer',
  'founder',
  'co-founder',
  'vp engineering',
  'head of hardware',
  'head of engineering',
  'head of procurement',
];

const MEDIUM_AUTHORITY_TITLES = [
  'engineer',
  'product manager',
  'operations',
  'supply chain',
  'sourcing',
  'procurement',
  'purchasing',
];

const NO_AUTHORITY_TITLES = [
  'recruiter',
  'recruiting',
  'talent',
  'hr',
  'human resources',
  'marketing',
  'sales',
  'intern',
  'student',
];

const MAX_SCORE = 20;

export interface RoleScoreResult {
  score: number;
  authority: 'high' | 'medium' | 'none';
  matchedTitle: string | null;
  reason: string;
}

export function scoreRole(contact: { title?: string | null } | null): RoleScoreResult {
  if (!contact?.title) {
    return {
      score: 0,
      authority: 'none',
      matchedTitle: null,
      reason: 'No contact or title provided',
    };
  }

  const title = contact.title.toLowerCase();

  // 优先匹配 NO_AUTHORITY（避免 "sales engineer" 错判为 medium）
  for (const bad of NO_AUTHORITY_TITLES) {
    if (title.includes(bad)) {
      return {
        score: 0,
        authority: 'none',
        matchedTitle: contact.title,
        reason: `Title contains "${bad}" - not a PCB purchasing decision-maker`,
      };
    }
  }

  for (const high of HIGH_AUTHORITY_TITLES) {
    if (title.includes(high)) {
      return {
        score: MAX_SCORE,
        authority: 'high',
        matchedTitle: contact.title,
        reason: `Title "${contact.title}" is a high-authority PCB buyer`,
      };
    }
  }

  for (const medium of MEDIUM_AUTHORITY_TITLES) {
    if (title.includes(medium)) {
      return {
        score: 10,
        authority: 'medium',
        matchedTitle: contact.title,
        reason: `Title "${contact.title}" may influence PCB purchasing`,
      };
    }
  }

  return {
    score: 0,
    authority: 'none',
    matchedTitle: contact.title,
    reason: `Title "${contact.title}" not recognized as decision-maker`,
  };
}
