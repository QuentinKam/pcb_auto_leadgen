import { z } from 'zod';

/**
 * 多租户相关 zod schemas
 * 对应 packages/db/src/schema/tenants.ts
 */

export const tenantPlanEnum = z.enum(['free', 'pro', 'enterprise']);

export const tenantCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab'),
  plan: tenantPlanEnum.default('free'),
});

export const tenantUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  plan: tenantPlanEnum.optional(),
  active: z.boolean().optional(),
});

export const tenantResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  plan: tenantPlanEnum,
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type TenantCreateInput = z.infer<typeof tenantCreateSchema>;
export type TenantUpdateInput = z.infer<typeof tenantUpdateSchema>;
export type TenantResponse = z.infer<typeof tenantResponseSchema>;
