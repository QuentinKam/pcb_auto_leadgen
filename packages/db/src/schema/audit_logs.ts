import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  jsonb,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';
import { users } from './users.ts';

/**
 * 审计日志
 * 记录人工改级、线索编辑、CSV 导出等关键操作
 * 用于合规追溯（GDPR）+ 模型迭代训练样本
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id'), // 操作者（可空：system 自动操作）
    action: varchar('action', { length: 50 }).notNull(), // score.override / lead.edit / lead.export
    entityType: varchar('entity_type', { length: 50 }).notNull(), // company / contact / lead_score
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'), // 变更前快照
    after: jsonb('after'), // 变更后快照
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'audit_logs_tenant_id_fk',
    }).onDelete('cascade'),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'audit_logs_user_id_fk',
    }).onDelete('set null'),
    tenantEntityIdx: index('audit_logs_tenant_entity_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
