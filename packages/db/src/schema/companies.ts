import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  jsonb,
  foreignKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

/**
 * 企业库
 * 来源：Apollo / Crunchbase API + 官网爬虫解析
 * industry 细分到子类，便于打分模型"行业匹配度"维度使用
 * size_bucket: 1-10 / 11-50 / 51-200 / 201-500 / 501-1000 / 1001-5000 / 5000+
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    website: varchar('website', { length: 500 }),
    industry: varchar('industry', { length: 100 }),
    sizeBucket: varchar('size_bucket', { length: 20 }),
    employeeCount: integer('employee_count'),
    fundingStage: varchar('funding_stage', { length: 50 }), // seed / a / b / c / ipo / acquired
    country: varchar('country', { length: 80 }),
    description: text('description'),
    rawPayload: jsonb('raw_payload'), // 第三方 API 原始返回
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'companies_tenant_id_fk',
    }).onDelete('cascade'),
    websiteUnique: unique('companies_tenant_website_unique').on(table.tenantId, table.website),
    tenantNameIdx: index('companies_tenant_name_idx').on(table.tenantId, table.name),
    tenantIndustryIdx: index('companies_tenant_industry_idx').on(table.tenantId, table.industry),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
