import { z } from 'zod';

/**
 * 联系人 zod schemas
 * 对应 packages/db/src/schema/contacts.ts
 */

export const emailVerifiedEnum = z.enum(['valid', 'invalid', 'unknown']);

export const contactCreateSchema = z.object({
  tenantId: z.uuid(),
  companyId: z.uuid(),
  email: z.email().max(255).optional(),
  name: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  linkedinUrl: z.url().max(500).optional(),
  emailVerified: emailVerifiedEnum.default('unknown'),
});

export const contactUpdateSchema = z.object({
  email: z.email().max(255).optional(),
  name: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  linkedinUrl: z.url().max(500).optional(),
  emailVerified: emailVerifiedEnum.optional(),
  active: z.boolean().optional(),
});

export const contactResponseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  companyId: z.uuid(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  emailVerified: emailVerifiedEnum.nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
