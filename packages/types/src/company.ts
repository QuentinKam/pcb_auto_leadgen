import { z } from 'zod';

/**
 * 企业库 zod schemas
 * 对应 packages/db/src/schema/companies.ts
 */

export const companySizeBucketEnum = z.enum([
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5000+',
]);

export const fundingStageEnum = z.enum([
  'seed',
  'a',
  'b',
  'c',
  'd',
  'ipo',
  'acquired',
  'bootstrapped',
]);

export const companyCreateSchema = z.object({
  tenantId: z.uuid(),
  name: z.string().min(1).max(255),
  website: z.url().max(500).optional(),
  industry: z.string().max(100).optional(),
  sizeBucket: companySizeBucketEnum.optional(),
  employeeCount: z.number().int().positive().optional(),
  fundingStage: fundingStageEnum.optional(),
  country: z.string().max(80).optional(),
  description: z.string().optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});

export const companyUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  website: z.url().max(500).optional(),
  industry: z.string().max(100).optional(),
  sizeBucket: companySizeBucketEnum.optional(),
  employeeCount: z.number().int().positive().optional(),
  fundingStage: fundingStageEnum.optional(),
  country: z.string().max(80).optional(),
  description: z.string().optional(),
});

export const companyResponseSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  sizeBucket: z.string().nullable(),
  employeeCount: z.number().nullable(),
  fundingStage: z.string().nullable(),
  country: z.string().nullable(),
  description: z.string().nullable(),
  rawPayload: z.unknown().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
export type CompanyResponse = z.infer<typeof companyResponseSchema>;
