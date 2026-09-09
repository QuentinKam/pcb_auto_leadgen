import { z } from 'zod';

/**
 * 业务员账号相关 zod schemas
 * 对应 packages/db/src/schema/users.ts
 */

export const userRoleEnum = z.enum(['admin', 'sales', 'viewer']);

export const userCreateSchema = z.object({
  tenantId: z.uuid(),
  email: z.email().max(255),
  name: z.string().min(1).max(255),
  role: userRoleEnum.default('viewer'),
});

export const userUpdateSchema = z.object({
  email: z.email().max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  role: userRoleEnum.optional(),
  active: z.boolean().optional(),
});

export const userResponseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: userRoleEnum,
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
