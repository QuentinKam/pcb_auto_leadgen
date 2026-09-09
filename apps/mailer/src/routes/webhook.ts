import { emailCampaigns, emailEvents, emailSends } from '@pcb/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../lib/db.ts';
import { verifyResendWebhookSignature } from '../lib/resend-client.ts';

const app = new Hono();

type MatchedSend = {
  id: string;
  tenantId: string;
  campaignId: string | null;
  status: string | null;
  openCount: number;
  clickCount: number;
  firstOpenedAt: Date | null;
  firstClickedAt: Date | null;
};

app.post('/resend', async (c) => {
  const rawBody = await c.req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  const headerRecord: Record<string, string | string[] | undefined> = {};
  c.req.raw.headers.forEach((v, k) => {
    headerRecord[k.toLowerCase()] = v;
  });

  if (!secret || secret.startsWith('whsec_xx') || secret.length < 10) {
    console.warn(
      '[mailer][webhook] RESEND_WEBHOOK_SECRET not configured or placeholder, SKIPPING SIGNATURE VERIFICATION'
    );
  } else {
    const ok = verifyResendWebhookSignature(secret, headerRecord, rawBody);
    if (!ok) {
      console.warn('[mailer][webhook] Invalid webhook signature, rejecting');
      return c.json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (err) {
    return c.json({ error: 'Invalid JSON body', code: 'BAD_BODY' }, 400);
  }

  const eventType = String(payload.type ?? 'unknown');
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const resendMessageId = String(data.email_id ?? data.message_id ?? payload.created_at ?? '');
  const resendEventId = String(
    payload.id ?? data.event_id ?? `${resendMessageId}:${eventType}:${Date.now()}`
  );

  const fallbackTenantId = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000000';

  const matchedSends: MatchedSend[] = resendMessageId
    ? ((await db
        .select({
          id: emailSends.id,
          tenantId: emailSends.tenantId,
          campaignId: emailSends.campaignId,
          status: emailSends.status,
          openCount: emailSends.openCount,
          clickCount: emailSends.clickCount,
          firstOpenedAt: emailSends.firstOpenedAt,
          firstClickedAt: emailSends.firstClickedAt,
        })
        .from(emailSends)
        .where(eq(emailSends.resendMessageId, resendMessageId))
        .limit(1)) as unknown as MatchedSend[])
    : [];
  const matched = matchedSends[0];
  const actualTenantId = matched?.tenantId ?? fallbackTenantId;

  const click = (data.click ?? {}) as Record<string, unknown>;
  const bounce = (data.bounce ?? {}) as Record<string, unknown>;
  const bounceTypeRaw = bounce.type ? String(bounce.type) : '';
  const bounceSubtype = bounce.sub_type ? String(bounce.sub_type) : '';
  const diagnosticCode = data.diagnostic_code ? String(data.diagnostic_code) : null;

  await db.insert(emailEvents).values({
    tenantId: actualTenantId,
    sendId: matched?.id ?? null,
    resendMessageId: resendMessageId || null,
    resendEventId,
    eventType,
    ipAddress: data.ip ? String(data.ip) : null,
    userAgent: data.user_agent ? String(data.user_agent) : null,
    url: click.url ? String(click.url) : null,
    linkTag: click.link_tag ? String(click.link_tag) : null,
    bounceType: bounceTypeRaw || null,
    bounceSubtype: bounceSubtype || null,
    diagnosticCode,
    payload: payload as never,
  });

  if (matched) {
    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };
    switch (eventType) {
      case 'email.sent':
        update.status = 'sent';
        update.sentAt = now;
        break;
      case 'email.delivered':
        update.status = 'delivered';
        update.deliveredAt = now;
        if (!matched.status?.includes('sent')) update.sentAt = now;
        break;
      case 'email.opened':
        update.status = 'opened';
        update.openCount = sql`${emailSends.openCount} + 1`;
        if (!matched.firstOpenedAt) update.firstOpenedAt = now;
        update.lastOpenedAt = now;
        break;
      case 'email.clicked':
        update.status = 'clicked';
        update.clickCount = sql`${emailSends.clickCount} + 1`;
        if (!matched.firstClickedAt) update.firstClickedAt = now;
        update.lastClickedAt = now;
        break;
      case 'email.bounced': {
        update.status = 'bounced';
        update.bouncedAt = now;
        const isHard =
          typeof bounceTypeRaw === 'string' && bounceTypeRaw.toLowerCase().startsWith('hard');
        update.bounceType = isHard ? 'hard' : 'soft';
        break;
      }
      case 'email.complained':
      case 'email.spam':
        update.status = 'complained';
        update.complainedAt = now;
        break;
      case 'email.delivery_delayed':
        update.status = 'delayed';
        update.lastError = diagnosticCode ?? 'delivery delayed';
        break;
      default:
        break;
    }

    await db
      .update(emailSends)
      .set(update as never)
      .where(eq(emailSends.id, matched.id));

    if (matched.campaignId) {
      await bumpCampaignCounters(matched.campaignId, eventType);
    }

    if (
      eventType === 'email.bounced' &&
      typeof bounceTypeRaw === 'string' &&
      bounceTypeRaw.toLowerCase().startsWith('hard')
    ) {
      console.warn(
        `[mailer][compliance] HARD_BOUNCE contact via send ${matched.id}, recommend blacklisting contact`
      );
    }

    if (eventType === 'email.complained' || eventType === 'email.spam') {
      await handleComplaintThreshold(actualTenantId, matched.id);
    }
  }

  return c.json({ received: true, eventType, resendEventId });
});

async function bumpCampaignCounters(campaignId: string, eventType: string): Promise<void> {
  const inc: Record<string, unknown> = {};
  switch (eventType) {
    case 'email.sent':
      inc.totalSent = sql`${emailCampaigns.totalSent} + 1`;
      break;
    case 'email.delivered':
      inc.totalDelivered = sql`${emailCampaigns.totalDelivered} + 1`;
      break;
    case 'email.opened':
      inc.totalOpened = sql`${emailCampaigns.totalOpened} + 1`;
      break;
    case 'email.clicked':
      inc.totalClicked = sql`${emailCampaigns.totalClicked} + 1`;
      break;
    case 'email.replied':
      inc.totalReplied = sql`${emailCampaigns.totalReplied} + 1`;
      break;
    case 'email.bounced':
      inc.totalBounced = sql`${emailCampaigns.totalBounced} + 1`;
      break;
    case 'email.complained':
    case 'email.spam':
      inc.totalComplained = sql`${emailCampaigns.totalComplained} + 1`;
      break;
    default:
      return;
  }
  await db
    .update(emailCampaigns)
    .set(inc as never)
    .where(eq(emailCampaigns.id, campaignId));
}

async function handleComplaintThreshold(tenantId: string, _sendId: string): Promise<void> {
  const threshold = Number(process.env.COMPLAINT_RATE_THRESHOLD ?? 0.001);
  const rows = (await db
    .select({
      sent: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} IN ('sent','delivered','opened','clicked','complained','bounced'))`,
      complained: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'complained')`,
    })
    .from(emailSends)
    .where(eq(emailSends.tenantId, tenantId))) as unknown as Array<{
    sent: number;
    complained: number;
  }>;
  const row = rows[0];
  const totalSent = Number(row?.sent ?? 0);
  const totalComplained = Number(row?.complained ?? 0);
  if (totalSent <= 0) return;
  const rate = totalComplained / totalSent;
  if (rate >= threshold) {
    console.error(
      `[mailer][ALERT] Complaint rate ${(rate * 100).toFixed(3)}% >= threshold ${(threshold * 100).toFixed(3)}% for tenant ${tenantId}. PAUSING outbound sends — manual intervention required.`
    );
  }
}

export const webhookRoutes = app;
