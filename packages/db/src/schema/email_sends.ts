import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  foreignKey,
  index,
  smallint,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.ts';
import { companies } from './companies.ts';
import { contacts } from './contacts.ts';
import { contentDrafts } from './content_drafts.ts';
import { emailCampaigns } from './email_campaigns.ts';

export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    campaignId: uuid('campaign_id'),
    companyId: uuid('company_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    contentDraftId: uuid('content_draft_id'),
    resendMessageId: varchar('resend_message_id', { length: 255 }),
    fromEmail: varchar('from_email', { length: 255 }).notNull(),
    fromName: varchar('from_name', { length: 255 }),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    toName: varchar('to_name', { length: 255 }),
    sendingDomain: varchar('sending_domain', { length: 255 }).notNull(),
    subject: text('subject'),
    bodySnapshot: text('body_snapshot').notNull(),
    variant: varchar('variant', { length: 1 }).default('A'),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    retryCount: smallint('retry_count').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    firstOpenedAt: timestamp('first_opened_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    openCount: integer('open_count').notNull().default(0),
    firstClickedAt: timestamp('first_clicked_at', { withTimezone: true }),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    bounceType: varchar('bounce_type', { length: 20 }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'email_sends_tenant_id_fk',
    }).onDelete('cascade'),
    campaignFk: foreignKey({
      columns: [table.campaignId],
      foreignColumns: [emailCampaigns.id],
      name: 'email_sends_campaign_id_fk',
    }).onDelete('set null'),
    companyFk: foreignKey({
      columns: [table.companyId],
      foreignColumns: [companies.id],
      name: 'email_sends_company_id_fk',
    }).onDelete('cascade'),
    contactFk: foreignKey({
      columns: [table.contactId],
      foreignColumns: [contacts.id],
      name: 'email_sends_contact_id_fk',
    }).onDelete('cascade'),
    contentDraftFk: foreignKey({
      columns: [table.contentDraftId],
      foreignColumns: [contentDrafts.id],
      name: 'email_sends_content_draft_id_fk',
    }).onDelete('set null'),
    tenantStatusIdx: index('email_sends_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    tenantDomainIdx: index('email_sends_tenant_domain_idx').on(
      table.tenantId,
      table.sendingDomain,
      table.createdAt,
    ),
    tenantFromEmailIdx: index('email_sends_tenant_from_email_idx').on(
      table.tenantId,
      table.fromEmail,
      table.createdAt,
    ),
    resendMessageIdIdx: index('email_sends_resend_message_id_idx').on(
      table.resendMessageId,
    ),
  }),
);

export type EmailSend = typeof emailSends.$inferSelect;
export type NewEmailSend = typeof emailSends.$inferInsert;
