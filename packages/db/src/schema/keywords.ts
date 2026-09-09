import { pgTable, uuid, varchar, timestamp, integer, boolean, foreignKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

/**
 * 关键词与行业过滤配置
 * 用于打分模型 v1 的"PCB 关键词密度"维度
 * type: keyword（PCB/PCBA/assembly/fabrication 等正负权重词）
 *      industry（硬件/工业设备/医疗器械等目标行业标签）
 * weight: 正数=加分词，负数=排除词（如 "recruiting" 表示招聘不采购）
 */
export const keywords = pgTable(
  'keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    type: varchar('type', { length: 20 }).notNull(), // keyword / industry
    value: varchar('value', { length: 100 }).notNull(),
    weight: integer('weight').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'keywords_tenant_id_fk',
    }).onDelete('cascade'),
  }),
);

export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;
