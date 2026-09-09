import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  foreignKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';
import { companies } from './companies.ts';

/**
 * 联系人
 * 来源：Apollo / Hunter.io / LinkedIn Sales Navigator（人工导入 CSV）
 * emailVerified: Hunter.io 验证状态
 * linkedinUrl: 仅记录公开 URL，不做自动化抓取（合规）
 */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    email: varchar('email', { length: 255 }),
    name: varchar('name', { length: 255 }),
    title: varchar('title', { length: 255 }), // 采购经理 / 硬件工程师 / 项目经理
    linkedinUrl: varchar('linkedin_url', { length: 500 }),
    emailVerified: varchar('email_verified', { length: 20 }).default('unknown'), // valid / invalid / unknown
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'contacts_tenant_id_fk',
    }).onDelete('cascade'),
    companyFk: foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: 'contacts_company_id_fk',
    }).onDelete('cascade'),
    emailUnique: unique('contacts_tenant_email_unique').on(table.tenantId, table.email),
    tenantCompanyIdx: index('contacts_tenant_company_idx').on(table.tenantId, table.companyId),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
