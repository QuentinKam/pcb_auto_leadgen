import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  foreignKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';
import { companies } from './companies.ts';

/**
 * 客户画像（P2 内容生成的输入基础）
 * 由客户画像 Agent 从公司官网/产品描述中提取，作为个性化内容生成的依据
 * customer_type: startup_hardware / industrial_equipment / consumer_electronics /
 *               medical_device / automotive / aerospace / other
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    businessSummary: text('business_summary'), // 业务摘要
    productTypes: text('product_types').array(), // 产品类型标签
    customerType: varchar('customer_type', { length: 50 }), // 客户类型分类
    painPoints: text('pain_points').array(), // 潜在痛点
    buyingSignals: text('buying_signals').array(), // 采购信号
    modelVersion: varchar('model_version', { length: 20 }).notNull().default('v1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'profiles_tenant_id_fk',
    }).onDelete('cascade'),
    companyFk: foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: 'profiles_company_id_fk',
    }).onDelete('cascade'),
    tenantCompanyUnique: unique('profiles_tenant_company_unique').on(
      table.tenantId,
      table.companyId
    ),
    tenantCustomerTypeIdx: index('profiles_tenant_customer_type_idx').on(
      table.tenantId,
      table.customerType
    ),
  })
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
