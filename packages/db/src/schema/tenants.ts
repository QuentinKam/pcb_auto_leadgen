import { pgTable, uuid, varchar, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * 多租户隔离根表
 * 每个客户公司一个 tenant，所有业务表通过 tenant_id 关联回此表
 * 生产环境配合 PostgreSQL row-level security 实现物理逻辑隔离
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  plan: varchar('plan', { length: 20 }).notNull().default('free'), // free / pro / enterprise
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
