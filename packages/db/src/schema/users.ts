import { pgTable, uuid, varchar, timestamp, boolean, foreignKey } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

/**
 * 业务员账号
 * role: admin（租户管理员）/ sales（业务员，可编辑线索）/ viewer（只读）
 * 多租户：每个 user 必须挂在 tenant 下
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    role: varchar('role', { length: 20 }).notNull().default('viewer'), // admin / sales / viewer
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'users_tenant_id_fk',
    }).onDelete('cascade'),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
