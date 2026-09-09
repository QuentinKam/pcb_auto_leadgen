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
import { emailSends } from './email_sends.ts';

export const emailEvents = pgTable(
  'email_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    sendId: uuid('send_id'),
    resendMessageId: varchar('resend_message_id', { length: 255 }),
    resendEventId: varchar('resend_event_id', { length: 255 }),
    eventType: varchar('event_type', { length: 30 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    url: text('url'),
    linkTag: varchar('link_tag', { length: 100 }),
    bounceType: varchar('bounce_type', { length: 20 }),
    bounceSubtype: varchar('bounce_subtype', { length: 50 }),
    diagnosticCode: text('diagnostic_code'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantFk: foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'email_events_tenant_id_fk',
    }).onDelete('cascade'),
    sendFk: foreignKey({
      columns: [table.sendId],
      foreignColumns: [emailSends.id],
      name: 'email_events_send_id_fk',
    }).onDelete('set null'),
    tenantEventTypeIdx: index('email_events_tenant_event_type_idx').on(
      table.tenantId,
      table.eventType,
      table.createdAt,
    ),
    tenantSendIdx: index('email_events_tenant_send_idx').on(
      table.tenantId,
      table.sendId,
      table.createdAt,
    ),
    resendEventIdIdx: index('email_events_resend_event_id_idx').on(
      table.resendEventId,
    ),
  }),
);

export type EmailEvent = typeof emailEvents.$inferSelect;
export type NewEmailEvent = typeof emailEvents.$inferInsert;
