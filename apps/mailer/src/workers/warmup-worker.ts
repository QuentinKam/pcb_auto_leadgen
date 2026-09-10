import 'dotenv/config';
import { emailCampaigns, emailSends } from '@pcb/db/schema';
import { type Job, Queue, Worker } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import type { SendJobPayload } from '../lib/queue.ts';
import {
  checkAndConsumeDomainQuota,
  checkAndConsumeFromEmailQuota,
  rollbackQuota,
} from '../lib/quota.ts';
import { ensureRedisConnected, redis } from '../lib/redis.ts';
import { type ResendSendResult, resendClient } from '../lib/resend-client.ts';
import { senderPool } from '../lib/sender-pool.ts';
import { warmupConfig } from '../lib/warmup-config.ts';

export const WARMUP_QUEUE_NAME = 'pcb-mailer-warmup';
export const WARMUP_DAILY_CRON = process.env.WARMUP_DAILY_CRON ?? '0 2 * * *';
export const WARMUP_SEND_INTERVAL_MS = Number(process.env.WARMUP_SEND_INTERVAL_MS ?? 3000);
const WARMUP_OPEN_RATE = Number(process.env.WARMUP_SIM_OPEN_RATE ?? 0.75);
const WARMUP_CLICK_RATE = Number(process.env.WARMUP_SIM_CLICK_RATE ?? 0.35);
const WARMUP_INTERACTION_DELAY_MIN_MS = Number(process.env.WARMUP_SIM_DELAY_MIN_MS ?? 60_000);
const WARMUP_INTERACTION_DELAY_MAX_MS = Number(process.env.WARMUP_SIM_DELAY_MAX_MS ?? 15 * 60_000);

type WarmupDailyJobPayload = {
  tenantId: string;
  triggeredBy?: 'cron' | 'manual';
};

type WarmupSingleSendPayload = {
  tenantId: string;
  seedEmail: string;
  fromEmail: string;
  fromName: string | null;
  domain: string;
  bodyVariant: number;
};

export const warmupQueue = new Queue(WARMUP_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export async function ensureDailyWarmupJobScheduled(): Promise<void> {
  const enabled = process.env.WARMUP_ENABLED !== 'false';
  if (!enabled) {
    console.warn('[warmup] WARMUP_ENABLED=false, skipping daily job scheduling');
    return;
  }
  const tenantId = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000000';
  try {
    await warmupQueue.upsertJobScheduler(
      'warmup-daily',
      {
        every: undefined,
        pattern: WARMUP_DAILY_CRON,
      },
      {
        name: 'warmup-daily',
        data: { tenantId, triggeredBy: 'cron' } as WarmupDailyJobPayload,
        opts: {
          jobId: 'warmup-daily',
          repeat: { pattern: WARMUP_DAILY_CRON },
        },
      }
    );
    console.log(
      `[warmup] Daily warmup scheduled with cron="${WARMUP_DAILY_CRON}", seed_pool=${warmupConfig.getPlan().seedEmails.length}, domains=${warmupConfig.getDomainCandidates().join(',')}`
    );
  } catch (err) {
    console.warn(
      '[warmup] Failed to schedule daily warmup (BullMQ Pro scheduler not available). Trigger manually via POST /warmup/trigger:',
      err
    );
  }
}

async function ensureWarmupCampaign(tenantId: string): Promise<string> {
  const rows = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(
      and(
        eq(emailCampaigns.tenantId, tenantId),
        eq(emailCampaigns.isWarmup, true),
        eq(emailCampaigns.status, 'active')
      )
    )
    .limit(1);
  if (rows.length > 0) return (rows[0] as { id: string }).id;

  const inserted = await db
    .insert(emailCampaigns)
    .values({
      tenantId,
      name: `Domain Warmup ${new Date().toISOString().slice(0, 10)}`,
      status: 'active',
      format: 'cold_email',
      isWarmup: true,
      targetAudience: 'seed_warmup',
      totalSent: 0,
      totalDelivered: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalReplied: 0,
      totalBounced: 0,
      totalComplained: 0,
      scheduledAt: new Date(),
      startedAt: new Date(),
    })
    .returning({ id: emailCampaigns.id });
  return (inserted[0] as { id: string }).id;
}

const WARMUP_BODY_VARIANTS = [
  {
    subject: 'Quick check — domain reputation warmup',
    text: 'Hi there,\n\nThis is a standard warmup message sent as part of our gradual domain reputation ramp-up program. No action is required on your end. These messages help mailbox providers recognize legitimate sending patterns before we reach real prospects.\n\nIf you received this in error or would prefer to opt out, please reply UNSUBSCRIBE and we will remove you from all future warmup cycles.\n\nThanks for your help!\n',
  },
  {
    subject: 'Warmup cycle — scheduled domain ramp',
    text: 'Hi,\n\nAnother routine warmup delivery. Our system slowly increases daily send volume over an 8-week schedule to build a stable sending reputation with Gmail, Outlook, and other major providers.\n\nNo action needed — simply leaving this message in your inbox helps our domain score. If you have a moment, marking it as "Not Spam" or moving it to the Primary tab is also helpful.\n\nReply with REMOVE to exit the warmup recipient list at any time.\n\nBest regards,\n',
  },
  {
    subject: 'Gradual sender warmup — cycle update',
    text: "Hello,\n\nAs part of our warmup strategy, this message was delivered through one of our verified sending domains at today's scheduled cadence. Consistent inbox placement is how mailbox providers learn to trust new senders.\n\nThis message, plus the simulated open/click signals our seed network automatically generates after delivery, helps accumulate positive engagement history.\n\nIf you no longer want to receive these, reply STOP and we'll take you off the list immediately.\n\nWarm regards,\n",
  },
];

async function buildWarmupBody(variantIdx: number): { subject: string; text: string } {
  const idx = variantIdx % WARMUP_BODY_VARIANTS.length;
  const v = WARMUP_BODY_VARIANTS[idx] ?? WARMUP_BODY_VARIANTS[0];
  return { subject: `${v.subject} [warmup #${variantIdx + 1}]`, text: v.text };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function processDailyWarmup(job: Job<WarmupDailyJobPayload>): Promise<{
  planned: number;
  dispatched: number;
  seedPool: number;
  domains: string[];
}> {
  const { tenantId, triggeredBy } = job.data;
  const target = warmupConfig.getTodaysTargetCount();
  const domains = warmupConfig.getDomainCandidates();
  const seeds = warmupConfig.plan.seedEmails;
  const seedPool = seeds.length;

  if (target <= 0) {
    console.log(
      `[warmup][daily] No scheduled warmup sends today (weekend or past plan), target=${target}`
    );
    return { planned: 0, dispatched: 0, seedPool, domains };
  }
  if (seedPool === 0) {
    console.warn(
      `[warmup][daily] WARMUP_SEED_EMAILS is empty, cannot dispatch ${target} sends. Configure seed emails in env or accept via POST /warmup/trigger {seedEmails:[...]} override.`
    );
    return { planned: target, dispatched: 0, seedPool, domains };
  }
  if (domains.length === 0) {
    console.warn(
      '[warmup][daily] No sending domain configured. Set DEFAULT_FROM_ADDRESSES or DEFAULT_SENDING_DOMAIN.'
    );
    return { planned: target, dispatched: 0, seedPool, domains };
  }

  const picks = warmupConfig.pickSeedEmails(target);
  let dispatched = 0;
  for (let i = 0; i < picks.length; i++) {
    const seed = picks[i] as string;
    const sender = senderPool.pickNext();
    const payload: WarmupSingleSendPayload = {
      tenantId,
      seedEmail: seed,
      fromEmail: sender.email,
      fromName: sender.name,
      domain: sender.domain,
      bodyVariant: i,
    };
    try {
      await warmupQueue.add(`warmup-send:${Date.now()}:${i}`, payload, {
        delay: i * WARMUP_SEND_INTERVAL_MS,
      });
      dispatched += 1;
    } catch (err) {
      console.warn(`[warmup][daily] Failed to enqueue warmup send ${i}/${picks.length}:`, err);
    }
  }
  console.log(
    `[warmup][daily] Dispatched=${dispatched}/${picks.length} (target=${target}, trigger=${triggeredBy ?? 'cron'}, seed_pool=${seedPool}, domains=${domains.join(',')})`
  );
  return { planned: target, dispatched, seedPool, domains };
}

async function processWarmupSend(job: Job<WarmupSingleSendPayload>): Promise<{
  messageId: string | null;
  status: string;
}> {
  const p = job.data;
  const { tenantId, seedEmail, fromEmail, fromName, domain, bodyVariant } = p;

  const quota = await checkAndConsumeDomainQuota(tenantId, domain);
  const fromQuota = await checkAndConsumeFromEmailQuota(tenantId, fromEmail);
  if (!quota.allowed || !fromQuota.allowed) {
    await rollbackQuota(tenantId, domain, fromEmail);
    throw new Error(
      `Warmup quota exceeded domain=${quota.count}/${quota.limit} from=${fromQuota.count}/${fromQuota.limit}`
    );
  }

  try {
    const campaignId = await ensureWarmupCampaign(tenantId);
    const { subject, text } = await buildWarmupBody(bodyVariant);
    const fromStr = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    const tags = [
      { name: 'tenant_id', value: tenantId },
      { name: 'campaign_id', value: campaignId },
      { name: 'warmup', value: '1' },
      { name: 'domain', value: domain },
    ];

    const insertedRows = await db
      .insert(emailSends)
      .values({
        tenantId,
        campaignId,
        fromEmail,
        fromName,
        sendingDomain: domain,
        toEmail: seedEmail,
        toName: `Warmup Seed ${seedEmail.split('@')[0]}`,
        subject,
        bodySnapshot: text,
        variant: bodyVariant % 2 === 0 ? 'A' : 'B',
        status: 'sending',
        retryCount: 0,
      })
      .returning({ id: emailSends.id });
    const sendId = (insertedRows[0] as { id: string }).id;

    const result: ResendSendResult = await resendClient.send({
      from: fromStr,
      to: [seedEmail],
      subject,
      text,
      tags,
      headers: { 'X-PCB-Warmup': '1', 'X-PCB-Send-Id': sendId },
    });

    if (result.success) {
      const now = new Date();
      await db
        .update(emailSends)
        .set({
          status: result.usedMock ? 'sent_mock' : 'sent',
          resendMessageId: result.messageId,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(emailSends.id, sendId));
      await db
        .update(emailCampaigns)
        .set({ totalSent: sql`${emailCampaigns.totalSent} + 1` })
        .where(eq(emailCampaigns.id, campaignId));

      if (resendClient.isMock) {
        await simulateMockInteractions(tenantId, sendId, campaignId);
      }
      return { messageId: result.messageId, status: result.usedMock ? 'sent_mock' : 'sent' };
    }

    await rollbackQuota(tenantId, domain, fromEmail);
    await db
      .update(emailSends)
      .set({
        status: 'failed',
        lastError: result.errorMessage ?? 'resend failed',
        updatedAt: new Date(),
      })
      .where(eq(emailSends.id, sendId));
    throw new Error(result.errorMessage ?? 'warmup send failed');
  } catch (err) {
    await rollbackQuota(tenantId, domain, fromEmail);
    throw err;
  }
}

async function simulateMockInteractions(
  tenantId: string,
  sendId: string,
  campaignId: string
): Promise<void> {
  const willOpen = Math.random() < WARMUP_OPEN_RATE;
  const willClick = willOpen && Math.random() < WARMUP_CLICK_RATE;
  const baseDelay = WARMUP_INTERACTION_DELAY_MIN_MS;
  const range = WARMUP_INTERACTION_DELAY_MAX_MS - WARMUP_INTERACTION_DELAY_MIN_MS;
  if (willOpen) {
    const delay = baseDelay + Math.floor(Math.random() * Math.max(1, range));
    await sleep(Math.min(delay, 5000));
    const now = new Date();
    await db
      .update(emailSends)
      .set({
        status: 'opened',
        openCount: sql`${emailSends.openCount} + 1`,
        firstOpenedAt: now,
        lastOpenedAt: now,
        updatedAt: now,
        deliveredAt: now,
        statusUpdatedAt: now,
      } as never)
      .where(eq(emailSends.id, sendId));
    await db
      .update(emailCampaigns)
      .set({
        totalDelivered: sql`${emailCampaigns.totalDelivered} + 1`,
        totalOpened: sql`${emailCampaigns.totalOpened} + 1`,
      })
      .where(eq(emailCampaigns.id, campaignId));
  }
  if (willClick) {
    const delay = 2000 + Math.floor(Math.random() * 3000);
    await sleep(delay);
    const now = new Date();
    await db
      .update(emailSends)
      .set({
        status: 'clicked',
        clickCount: sql`${emailSends.clickCount} + 1`,
        firstClickedAt: now,
        lastClickedAt: now,
        updatedAt: now,
      } as never)
      .where(eq(emailSends.id, sendId));
    await db
      .update(emailCampaigns)
      .set({ totalClicked: sql`${emailCampaigns.totalClicked} + 1` })
      .where(eq(emailCampaigns.id, campaignId));
  }
}

async function main(): Promise<void> {
  await ensureRedisConnected();
  console.log(
    `[warmup] Starting warmup worker queue=${WARMUP_QUEUE_NAME} mock_mode=${resendClient.isMock} cron=${WARMUP_DAILY_CRON} send_interval_ms=${WARMUP_SEND_INTERVAL_MS}`
  );

  const worker = new Worker(
    WARMUP_QUEUE_NAME,
    async (job: Job<WarmupDailyJobPayload | WarmupSingleSendPayload>) => {
      const d = job.data as WarmupDailyJobPayload;
      const s = job.data as WarmupSingleSendPayload;
      if (
        typeof (d as WarmupDailyJobPayload).triggeredBy !== 'undefined' ||
        !('seedEmail' in job.data)
      ) {
        return processDailyWarmup(job as Job<WarmupDailyJobPayload>);
      }
      if ('seedEmail' in s) {
        return processWarmupSend(job as Job<WarmupSingleSendPayload>);
      }
      throw new Error(`Unknown warmup job payload for job=${job.id}`);
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[warmup] completed job=${job.id} name=${job.name} result=${JSON.stringify(result)}`
    );
  });
  worker.on('failed', (job, err) => {
    console.error(
      `[warmup] FAILED job=${job?.id} name=${job?.name} attempts=${job?.attemptsMade ?? 0}: ${err.message}`
    );
  });

  await ensureDailyWarmupJobScheduled();

  process.on('SIGTERM', async () => {
    console.log('[warmup] SIGTERM, shutting down...');
    await worker.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    console.log('[warmup] SIGINT, shutting down...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[warmup] Fatal:', err);
  process.exit(1);
});
