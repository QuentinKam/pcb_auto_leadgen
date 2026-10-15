import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';

export const emailCampaigns = pgTable(
  'email_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    format: varchar('format', { length: 30 }).notNull().default('cold_email'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    targetScoreMin: integer('target_score_min'),
    targetScoreMax: integer('target_score_max'),
    totalTargets: integer('total_targets').notNull().default(0),
    totalSent: integer('total_sent').notNull().default(0),
    totalDelivered: integer('total_delivered').notNull().default(0),
    totalOpened: integer('total_opened').notNull().default(0),
    totalClicked: integer('total_clicked').notNull().default(0),
    totalReplied: integer('total_replied').notNull().default(0),
    totalBounced: integer('total_bounced').notNull().default(0),
    totalComplained: integer('total_complained').notNull().default(0),
    isWarmup: boolean('is_warmup').notNull().default(false),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'email_campaigns_tenant_id_fk',
    }).onDelete('cascade'),
    tenantStatusIdx: index('email_campaigns_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt
    ),
    tenantWarmupIdx: index('email_campaigns_tenant_warmup_idx').on(table.tenantId, table.isWarmup),
  })
);

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type NewEmailCampaign = typeof emailCampaigns.$inferInsert;
