import { z } from 'zod';

/**
 * 关键词与行业过滤 zod schemas
 * 对应 packages/db/src/schema/keywords.ts
 */

export const keywordTypeEnum = z.enum(['keyword', 'industry']);

export const keywordCreateSchema = z.object({
  tenantId: z.uuid(),
  type: keywordTypeEnum,
  value: z.string().min(1).max(100),
  weight: z.number().int().min(-10).max(10).default(1),
});

export const keywordUpdateSchema = z.object({
  type: keywordTypeEnum.optional(),
  value: z.string().min(1).max(100).optional(),
  weight: z.number().int().min(-10).max(10).optional(),
  active: z.boolean().optional(),
});

export const keywordResponseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  type: keywordTypeEnum,
  value: z.string(),
  weight: z.number(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type KeywordCreateInput = z.infer<typeof keywordCreateSchema>;
export type KeywordUpdateInput = z.infer<typeof keywordUpdateSchema>;
export type KeywordResponse = z.infer<typeof keywordResponseSchema>;
