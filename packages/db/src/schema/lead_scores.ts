import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  jsonb,
  boolean,
  foreignKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants.ts';
import { companies } from './companies.ts';
import { contacts } from './contacts.ts';

/**
 * 打分记录
 * 每次打分都生成一条新记录（不 in-place 更新），方便追溯模型版本演化
 * score: 0-100 = clamp(buyerFit + demandSignal - negativePenalty, 0, 100)
 * grade: A (>=75) / B (50-74) / C (<50)
 * modelVersion: v1 规则加权 / v2 PCB 领域对齐 / v3 LLM 打分
 * dimensionBreakdown: { industryFit, hardwareProductFit, pcbRelevance, companyFit, demandSignal, negativePenalty }
 * evidence: Signal-level 证据数组（docs/pcb-alignment.md §9）
 * excluded: hard negative（如 PCB 制造商自身）时置 true，Lead 不进入主要销售池
 */
export const leadScores = pgTable(
  'lead_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    contactId: uuid('contact_id'), // 可空：公司级评分 vs 联系人级评分
    score: integer('score').notNull(), // 0-100
    grade: varchar('grade', { length: 1 }).notNull(), // A / B / C
    reason: text('reason').notNull(),
    dimensionBreakdown: jsonb('dimension_breakdown').notNull(),
    evidence: jsonb('evidence'),
    excluded: boolean('excluded').notNull().default(false),
    modelVersion: varchar('model_version', { length: 20 }).notNull().default('v2'),
    overriddenBy: uuid('overridden_by'), // 人工覆盖的 user_id（指向 users 表）
    overrideReason: text('override_reason'),
    finalGrade: varchar('final_grade', { length: 1 }).notNull(), // 可能与 grade 不同（人工覆盖后）
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'lead_scores_tenant_id_fk',
    }).onDelete('cascade'),
    companyFk: foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: 'lead_scores_company_id_fk',
    }).onDelete('cascade'),
    contactFk: foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
      name: 'lead_scores_contact_id_fk',
    }).onDelete('set null'),
    tenantCompanyIdx: index('lead_scores_tenant_company_idx').on(table.tenantId, table.companyId),
    tenantGradeIdx: index('lead_scores_tenant_grade_idx').on(
      table.tenantId,
      table.finalGrade,
      table.createdAt
    ),
    latestPerCompanyIdx: uniqueIndex('lead_scores_latest_per_company_idx')
      .on(table.tenantId, table.companyId)
      .where(sql`${table.overriddenBy} IS NULL`), // 简化：实际 latest 用窗口函数查
  })
);

export type LeadScore = typeof leadScores.$inferSelect;
export type NewLeadScore = typeof leadScores.$inferInsert;
