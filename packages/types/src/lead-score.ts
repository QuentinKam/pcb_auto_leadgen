import { z } from 'zod';

/**
 * 打分记录 zod schemas
 * 对应 packages/db/src/schema/lead_scores.ts
 * 核心实体：采集完成后入队打分，打分结果写入此表
 */

export const gradeEnum = z.enum(['A', 'B', 'C']);

export const modelVersionEnum = z.enum(['v1', 'v2', 'v3']);

/**
 * 打分维度明细
 * 对应 packages/db/src/schema/lead_scores.ts 的 dimension_breakdown jsonb
 * 权重总和 = 100：industry 30 + pcb_keywords 25 + role 20 + size 15 + reachability 10
 */
export const dimensionBreakdownSchema = z.object({
  industry: z.number().min(0).max(30),
  pcb_keywords: z.number().min(0).max(25),
  role: z.number().min(0).max(20),
  size: z.number().min(0).max(15),
  reachability: z.number().min(0).max(10),
});

/**
 * 内部创建：scorer 微服务调用
 * score 0-100，必须 grade 与 score 一致（A≥75, B 50-74, C<50）
 */
export const leadScoreCreateSchema = z.object({
  tenantId: z.uuid(),
  companyId: z.uuid(),
  contactId: z.uuid().optional(),
  score: z.number().int().min(0).max(100),
  grade: gradeEnum,
  reason: z.string().min(1),
  dimensionBreakdown: dimensionBreakdownSchema,
  modelVersion: modelVersionEnum.default('v1'),
});

/**
 * 业务员人工覆盖
 * - finalGrade: 必填，业务员指定的最终等级
 * - overrideReason: 必填，覆盖原因（用于模型迭代训练）
 */
export const leadScoreOverrideSchema = z.object({
  finalGrade: gradeEnum,
  overrideReason: z.string().min(1).max(500),
});

/**
 * API 响应
 * 包含模型原始 grade + 最终生效的 finalGrade（可能被人工覆盖）
 */
export const leadScoreResponseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  companyId: z.uuid(),
  contactId: z.uuid().nullable(),
  score: z.number().int().min(0).max(100),
  grade: gradeEnum,
  reason: z.string(),
  dimensionBreakdown: dimensionBreakdownSchema,
  modelVersion: modelVersionEnum,
  overriddenBy: z.uuid().nullable(),
  overrideReason: z.string().nullable(),
  finalGrade: gradeEnum,
  createdAt: z.iso.datetime(),
});

/**
 * 列表查询参数
 * 用于看板线索列表页：按 grade 筛选 + 分页
 */
export const leadScoreListQuerySchema = z.object({
  grade: gradeEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type LeadScoreCreateInput = z.infer<typeof leadScoreCreateSchema>;
export type LeadScoreOverrideInput = z.infer<typeof leadScoreOverrideSchema>;
export type LeadScoreResponse = z.infer<typeof leadScoreResponseSchema>;
export type LeadScoreListQuery = z.infer<typeof leadScoreListQuerySchema>;
export type DimensionBreakdown = z.infer<typeof dimensionBreakdownSchema>;
