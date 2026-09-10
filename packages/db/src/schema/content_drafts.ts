import { pgTable, uuid, varchar, timestamp, text, foreignKey, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';
import { companies } from './companies.ts';
import { contacts } from './contacts.ts';
import { profiles } from './profiles.ts';

/**
 * 内容草稿（P2 个性化触达内容）
 * format: cold_email / linkedin_dm / industry_blog
 * variant: A / B（A/B 测试版本）
 * status: generated / approved / rejected / sent
 * used_facts: 引用的行业事实 ID（预留对接 ContentForge facts.json）
 * gaps: 数据缺口标记（LLM 无法从知识库获取的数据）
 */
export const contentDrafts = pgTable(
  'content_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    contactId: uuid('contact_id'),
    profileId: uuid('profile_id'),
    format: varchar('format', { length: 30 }).notNull(), // cold_email / linkedin_dm / industry_blog
    variant: varchar('variant', { length: 1 }).notNull().default('A'), // A / B
    subject: text('subject'), // 邮件主题（私信可为空）
    body: text('body').notNull(), // 正文
    status: varchar('status', { length: 20 }).notNull().default('generated'), // generated / approved / rejected / sent
    usedFacts: text('used_facts').array(), // 引用的行业事实 ID
    gaps: text('gaps').array(), // 数据缺口标记
    model: varchar('model', { length: 100 }), // LLM 模型
    approvedBy: uuid('approved_by'), // 审批人 user_id
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'content_drafts_tenant_id_fk',
    }).onDelete('cascade'),
    companyFk: foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: 'content_drafts_company_id_fk',
    }).onDelete('cascade'),
    contactFk: foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
      name: 'content_drafts_contact_id_fk',
    }).onDelete('set null'),
    profileFk: foreignKey({
      columns: [table.profileId],
      foreignColumns: [profiles.id],
      name: 'content_drafts_profile_id_fk',
    }).onDelete('set null'),
    tenantCompanyIdx: index('content_drafts_tenant_company_idx').on(
      table.tenantId,
      table.companyId
    ),
    tenantStatusIdx: index('content_drafts_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
  })
);

export type ContentDraft = typeof contentDrafts.$inferSelect;
export type NewContentDraft = typeof contentDrafts.$inferInsert;
