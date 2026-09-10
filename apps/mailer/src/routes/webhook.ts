import { contacts, emailCampaigns, emailEvents, emailSends } from '@pcb/db/schema';
import { and, countDistinct, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../lib/db.ts';
import { redis } from '../lib/redis.ts';
import { suspendDomain } from '../lib/quota.ts';
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

    if (eventType === 'email.bounced') {
      const isHard =
        typeof bounceTypeRaw === 'string' && bounceTypeRaw.toLowerCase().startsWith('hard');
      await handleBounceBlacklist(actualTenantId, matched.id, matched.campaignId, isHard);
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

async function handleComplaintThreshold(tenantId: string, sendId: string): Promise<void> {
  const threshold = Number(process.env.COMPLAINT_RATE_THRESHOLD ?? 0.001);
  const sendRows = (await db
    .select({
      sendingDomain: emailSends.sendingDomain,
      sent: sql<number>`COUNT(*) OVER ()`,
      complained: sql<number>`SUM(CASE WHEN ${emailSends.status} = 'complained' THEN 1 ELSE 0 END) OVER ()`,
    })
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, sendId)))
    .limit(1)) as unknown as Array<{
    sendingDomain: string;
    sent: number;
    complained: number;
  }>;
  const perDomainRows = (await db
    .select({
      domainSent: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} IN ('sent','delivered','opened','clicked','complained','bounced'))`,
      domainComplained: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'complained')`,
    })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.tenantId, tenantId),
        eq(emailSends.sendingDomain, sendRows[0]?.sendingDomain ?? '')
      )
    )) as unknown as Array<{
    domainSent: number;
    domainComplained: number;
  }>;

  const domain = sendRows[0]?.sendingDomain;
  const globalSent = Number(sendRows[0]?.sent ?? 0);
  const globalComplained = Number(sendRows[0]?.complained ?? 0);
  const domainSent = Number(perDomainRows[0]?.domainSent ?? 0);
  const domainComplained = Number(perDomainRows[0]?.domainComplained ?? 0);

  const globalRate = globalSent > 0 ? globalComplained / globalSent : 0;
  const domainRate = domainSent > 0 ? domainComplained / domainSent : 0;

  if (globalRate >= threshold || domainRate >= threshold) {
    const rate = Math.max(globalRate, domainRate);
    const reason = `Complaint rate ${(rate * 100).toFixed(3)}% >= threshold ${(threshold * 100).toFixed(3)}% (tenant=${tenantId}, domain=${domain ?? 'unknown'})`;
    console.error(
      `[mailer][ALERT] ${reason}. SUSPENDING OUTBOUND DOMAIN — manual intervention required.`
    );
    if (domain) {
      await suspendDomain(domain, reason);
    }
  }
}

async function handleBounceBlacklist(
  tenantId: string,
  sendId: string,
  campaignId: string | null,
  isHard: boolean
): Promise<void> {
  void campaignId;
  const sendRows = (await db
    .select({
      contactId: emailSends.contactId,
      toEmail: emailSends.toEmail,
    })
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, sendId)))
    .limit(1)) as unknown as Array<{ contactId: string; toEmail: string }>;
  const send = sendRows[0];
  if (!send) return;

  if (isHard) {
    console.warn(
      `[mailer][compliance] HARD_BOUNCE → blacklist contact ${send.contactId} (email=${send.toEmail})`
    );
    await db
      .update(contacts)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, send.contactId)));
    return;
  }

  const softBounceCountRows = (await db
    .select({
      cnt: countDistinct(emailSends.id),
    })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.tenantId, tenantId),
        eq(emailSends.contactId, send.contactId),
        eq(emailSends.status, 'bounced'),
        eq(emailSends.bounceType, 'soft')
      )
    )) as unknown as Array<{ cnt: number }>;
  const softCount = Number(softBounceCountRows[0]?.cnt ?? 0) + 1;
  const threshold = Number(process.env.SOFT_BOUNCE_BLACKLIST_THRESHOLD ?? 3);
  if (softCount >= threshold) {
    console.warn(
      `[mailer][compliance] SOFT_BOUNCE count=${softCount} >= ${threshold} → blacklist contact ${send.contactId} (email=${send.toEmail})`
    );
    await db
      .update(contacts)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, send.contactId)));
  }
}

export const webhookRoutes = app;
