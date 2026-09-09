/**
 * 维度 4: 公司规模信号（满分 15）
 *
 * 规则 v1:
 * - 员工数 50-500（PCB 采购黄金区间）：15 分
 * - 员工数 11-49 或 501-1000：10 分
 * - 员工数 1-10 或 1001-5000：5 分
 * - 员工数 5000+ 或无数据：0 分
 *
 * 理由：太小不需要 PCB 代工，太大有自建产线或已锁定供应商
 */

const MAX_SCORE = 15;

export interface SizeScoreResult {
  score: number;
  bucket: string | null;
  employeeCount: number | null;
  reason: string;
}

export function scoreSize(
  company: { sizeBucket?: string | null; employeeCount?: number | null },
): SizeScoreResult {
  const { sizeBucket, employeeCount } = company;

  // 优先用 sizeBucket（采集时已分类）
  if (sizeBucket) {
    const bucket = sizeBucket.toLowerCase();
    if (bucket === '51-200' || bucket === '201-500') {
      return {
        score: MAX_SCORE,
        bucket: sizeBucket,
        employeeCount: employeeCount ?? null,
        reason: `Size ${sizeBucket} is PCB sourcing sweet spot`,
      };
    }
    if (bucket === '11-50' || bucket === '501-1000') {
      return {
        score: 10,
        bucket: sizeBucket,
        employeeCount: employeeCount ?? null,
        reason: `Size ${sizeBucket} is moderately likely to source PCBs`,
      };
    }
    if (bucket === '1-10' || bucket === '1001-5000') {
      return {
        score: 5,
        bucket: sizeBucket,
        employeeCount: employeeCount ?? null,
        reason: `Size ${sizeBucket} is outside the typical PCB sourcing range`,
      };
    }
    if (bucket === '5000+') {
      return {
        score: 0,
        bucket: sizeBucket,
        employeeCount: employeeCount ?? null,
        reason: 'Very large company - likely has in-house PCB assembly',
      };
    }
  }

  // fallback：用 employeeCount 推断
  if (employeeCount && employeeCount > 0) {
    if (employeeCount >= 50 && employeeCount <= 500) {
      return {
        score: MAX_SCORE,
        bucket: '50-500',
        employeeCount,
        reason: `Employee count ${employeeCount} is PCB sourcing sweet spot`,
      };
    }
    if (employeeCount >= 11 && employeeCount <= 1000) {
      return {
        score: 10,
        bucket: '11-1000',
        employeeCount,
        reason: `Employee count ${employeeCount} is moderately likely`,
      };
    }
    if (employeeCount >= 1 && employeeCount <= 5000) {
      return {
        score: 5,
        bucket: 'edge',
        employeeCount,
        reason: `Employee count ${employeeCount} is outside typical range`,
      };
    }
    return {
      score: 0,
      bucket: '5000+',
      employeeCount,
      reason: 'Very large company - likely has in-house PCB assembly',
    };
  }

  return {
    score: 0,
    bucket: null,
    employeeCount: null,
    reason: 'No size data available',
  };
}
