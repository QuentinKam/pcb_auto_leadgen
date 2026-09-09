import { z } from 'zod';

export * from './tenant.ts';
export * from './user.ts';
export * from './keyword.ts';
export * from './company.ts';
export * from './contact.ts';
export * from './lead-score.ts';

/**
 * 通用 API 响应 schema
 * 成功：{ data: T }
 * 失败：{ error: string, code: string }
 * 列表：{ data: T[], total: number, page: number, pageSize: number }
 */

export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
});

export const paginationMetaSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

/**
 * 构造列表响应 schema（泛型）
 * 使用方式：
 *   const leadListResponseSchema = listResponseSchema(leadScoreResponseSchema)
 */
export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
