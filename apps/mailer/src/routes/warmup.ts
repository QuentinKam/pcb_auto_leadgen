import { zValidator } from '@hono/zod-validator';
import { emailCampaigns, emailSends } from '@pcb/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../lib/db.ts';
import { warmupConfig } from '../lib/warmup-config.ts';
import { ensureDailyWarmupJobScheduled, warmupQueue } from '../workers/warmup-worker.ts';

const app = new Hono();

const TriggerSchema = z.object({
  seedEmails: z.array(z.string().email()).optional(),
  countOverride: z.number().int().min(1).max(500).optional(),
});

app.get('/status', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  const plan = warmupConfig.getPlan();
  const elapsed = warmupConfig.getElapsedDays();
  const todaysEntry = warmupConfig.getTodaysEntry();
  const domains = warmupConfig.getDomainCandidates();
  const seedEmails = warmupConfig.plan.seedEmails;

  let todaySent = 0;
  let campaignStats: Record<string, number> = {};
  if (tenantId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRows = (await db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(
        and(
          eq(emailSends.tenantId, tenantId),
          eq(emailSends.sendingDomain, domains[0] ?? ''),
          gte(emailSends.createdAt, today)
        )
      )) as unknown as Array<{ id: string }>;
    todaySent = todayRows.length;

    const campRows = (await db
      .select({
        totalSent: sql<number>`COALESCE(SUM(${emailCampaigns.totalSent}), 0)`,
        totalDelivered: sql<number>`COALESCE(SUM(${emailCampaigns.totalDelivered}), 0)`,
        totalOpened: sql<number>`COALESCE(SUM(${emailCampaigns.totalOpened}), 0)`,
        totalClicked: sql<number>`COALESCE(SUM(${emailCampaigns.totalClicked}), 0)`,
        totalBounced: sql<number>`COALESCE(SUM(${emailCampaigns.totalBounced}), 0)`,
        totalComplained: sql<number>`COALESCE(SUM(${emailCampaigns.totalComplained}), 0)`,
      })
      .from(emailCampaigns)
      .where(
        and(eq(emailCampaigns.tenantId, tenantId), eq(emailCampaigns.isWarmup, true))
      )) as unknown as Array<{
      totalSent: number;
      totalDelivered: number;
      totalOpened: number;
      totalClicked: number;
      totalBounced: number;
      totalComplained: number;
    }>;
    const r = campRows[0] ?? {};
    campaignStats = {
      totalSent: Number(r.totalSent ?? 0),
      totalDelivered: Number(r.totalDelivered ?? 0),
      totalOpened: Number(r.totalOpened ?? 0),
      totalClicked: Number(r.totalClicked ?? 0),
      totalBounced: Number(r.totalBounced ?? 0),
      totalComplained: Number(r.totalComplained ?? 0),
    };
  }

  let reputationScore = 0;
  if (campaignStats.totalSent > 0) {
    const openRate =
      campaignStats.totalDelivered > 0
        ? campaignStats.totalOpened / campaignStats.totalDelivered
        : 0;
    const clickRate =
      campaignStats.totalOpened > 0 ? campaignStats.totalClicked / campaignStats.totalOpened : 0;
    const bouncePenalty = Math.min(
      1,
      campaignStats.totalBounced / Math.max(1, campaignStats.totalSent)
    );
    const complaintPenalty = Math.min(
      1,
      (campaignStats.totalComplained / Math.max(1, campaignStats.totalSent)) * 100
    );
    reputationScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(openRate * 600 + clickRate * 400 - bouncePenalty * 50 - complaintPenalty * 80)
      )
    );
  }

  const queueCount = await warmupQueue.getWaitingCount().catch(() => 0);
  const queueActive = await warmupQueue.getActiveCount().catch(() => 0);
  const queueDelayed = await warmupQueue.getDelayedCount().catch(() => 0);

  return c.json({
    startDate: warmupConfig.getStartDate().toISOString().slice(0, 10),
    elapsedDays: elapsed,
    totalWeeks: plan.totalWeeks,
    todaysEntry,
    todaySent,
    todayRemaining: Math.max(0, (todaysEntry?.targetCount ?? 0) - todaySent),
    seedPool: {
      totalAvailable: seedEmails.length,
      sample: seedEmails.slice(0, 5),
    },
    sendingDomains: domains,
    campaignStats,
    reputationScore,
    queue: {
      waiting: queueCount,
      active: queueActive,
      delayed: queueDelayed,
    },
  });
});

app.get('/plan', async (c) => {
  const plan = warmupConfig.getPlan();
  const recent = plan.entries.filter((e) => e.absoluteDay <= warmupConfig.getElapsedDays() + 14);
  return c.json({
    totalWeeks: plan.totalWeeks,
    maxPerDay: plan.maxPerDay,
    seedPoolSize: plan.seedEmails.length,
    entries: recent,
    entryCount: plan.entries.length,
  });
});

app.get('/recent', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const limit = 50;
  const recent = await db
    .select()
    .from(emailSends)
    .innerJoin(
      emailCampaigns,
      and(eq(emailCampaigns.id, emailSends.campaignId), eq(emailCampaigns.isWarmup, true))
    )
    .where(eq(emailSends.tenantId, tenantId))
    .orderBy(desc(emailSends.createdAt))
    .limit(limit);
  return c.json({ total: recent.length, limit, items: recent });
});

app.post('/trigger', zValidator('json', TriggerSchema), async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const { seedEmails, countOverride } = c.req.valid('json');

  const domains = warmupConfig.getDomainCandidates();
  const seeds = seedEmails && seedEmails.length > 0 ? seedEmails : warmupConfig.plan.seedEmails;
  if (seeds.length === 0) {
    return c.json(
      {
        error: 'WARMUP_SEED_EMAILS is empty and no seedEmails[] override provided',
        code: 'NO_SEEDS',
      },
      400
    );
  }
  if (domains.length === 0) {
    return c.json(
      {
        error: 'No sending domain configured (DEFAULT_FROM_ADDRESSES / DEFAULT_SENDING_DOMAIN)',
        code: 'NO_DOMAIN',
      },
      400
    );
  }

  const target = countOverride ?? warmupConfig.getTodaysTargetCount();
  const count = Math.min(target, seeds.length > 0 ? 500 : 0);
  const picks: string[] = [];
  for (let i = 0; i < count; i++) picks.push(seeds[i % seeds.length] as string);

  try {
    const job = await warmupQueue.add(
      'warmup-manual',
      {
        tenantId,
        triggeredBy: 'manual',
        seedEmailsOverride: picks,
        countOverride: count,
      } as never,
      {
        jobId: `warmup-manual-${Date.now()}`,
        removeOnComplete: 500,
      }
    );
    return c.json(
      {
        jobId: job.id,
        count,
        seedPool: seeds.length,
        domains,
        status: 'queued',
      },
      202
    );
  } catch (err) {
    return c.json(
      {
        error: `Warmup queue failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'QUEUE_FAILED',
      },
      500
    );
  }
});

app.post('/reschedule', async (c) => {
  await ensureDailyWarmupJobScheduled();
  return c.json({
    rescheduled: true,
    cron: process.env.WARMUP_DAILY_CRON ?? '0 2 * * *',
    nextRun: 'based on system cron (BullMQ Pro scheduler required for repeatable)',
  });
});

export const warmupRoutes = app;
