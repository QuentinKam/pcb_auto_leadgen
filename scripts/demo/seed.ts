#!/usr/bin/env bun
/**
 * 演示数据种子脚本
 *
 * 用法（仓库根目录）：
 *   bun run scripts/demo/seed.ts                 # 幂等写入演示数据（已存在则先清后写）
 *   bun run scripts/demo/seed.ts --reset         # 只清空演示数据，不写入
 *   bun run scripts/demo/seed.ts --purge-failed  # 顺带清掉历史 failed 发送（域名未验证时期的残留）
 *   bun run scripts/demo/seed.ts --recipient=a@b.com
 *
 * 设计：全部演示数据挂在 companies.raw_payload->>'demo' = 'true' 上，
 * reset 时按此标记精确回滚，绝不误伤真实数据。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

// ── 1. 先加载 env（必须在 import @pcb/db 之前，连接池在模块加载时创建）──
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(REPO_ROOT, 'apps/mailer/.env'));
loadEnvFile(resolve(REPO_ROOT, '.env'));

process.env.DATABASE_URL ??= 'postgresql://pcb_user:dev_only_local@localhost:5432/pcb_leadgen';
const TENANT_ID = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000000';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const SENDING_DOMAIN = process.env.DEFAULT_SENDING_DOMAIN ?? 'rakuto.store';
const FROM_ADDRESSES = (process.env.DEFAULT_FROM_ADDRESSES ?? 'Sales Team <sales@rakuto.store>')
  .split(',')
  .map((s) => {
    const m = s.trim().match(/^(.*?)\s*<(.+)>$/);
    return m
      ? { name: m[1].replace(/^"|"$/g, '').trim(), email: m[2].trim() }
      : { name: '', email: s.trim() };
  })
  .filter((a) => a.email);

// ── 2. 参数解析 ──
const argv = process.argv.slice(2);
const RESET_ONLY = argv.includes('--reset');
const PURGE_FAILED = argv.includes('--purge-failed');
const RECIPIENT_ARG = argv.find((a) => a.startsWith('--recipient='))?.split('=')[1];
const DEMO_RECIPIENT_EMAIL =
  RECIPIENT_ARG ??
  process.env.DEMO_RECIPIENT_EMAIL ??
  // 兜底：取 warmup 种子邮箱里的第一个（一定是你自己的邮箱）
  (() => {
    try {
      const raw = process.env.WARMUP_SEED_EMAILS ?? '[]';
      const list = JSON.parse(raw) as string[];
      return list[0] ?? 'demo@example.com';
    } catch {
      return 'demo@example.com';
    }
  })();

/** 所有演示联系人邮箱指向你自己邮箱的 + 别名：任何误点「批准并发信」都只会进你自己的收件箱 */
function demoEmail(slug: string): string {
  const at = DEMO_RECIPIENT_EMAIL.indexOf('@');
  if (at === -1) return DEMO_RECIPIENT_EMAIL;
  const user = DEMO_RECIPIENT_EMAIL.slice(0, at).replace(/\+.*$/, '');
  const domain = DEMO_RECIPIENT_EMAIL.slice(at + 1);
  return `${user}+${slug}@${domain}`;
}

// ── 3. 动态 import（env 已就位）──
const { db } = await import('@pcb/db');
const {
  tenants,
  companies,
  contacts,
  leadScores,
  profiles,
  contentDrafts,
  emailCampaigns,
  emailSends,
  emailEvents,
  auditLogs,
} = await import('@pcb/db/schema');
const { and, eq, inArray, sql } = await import('drizzle-orm');
const { DEMO_COMPANIES, DEMO_CAMPAIGN, DEMO_WARMUP_CAMPAIGN, DEMO_TAG } = await import(
  './dataset.ts'
);

// ── 4. 工具 ──
let seedState = 20260910;
function rnd(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)] as T;
}
function daysAgo(days: number, hour = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
  return d;
}

/** 公司/联系人创建时间：让演示公司排在「内容审核」公司列表最前（比历史 warmup 占位公司更新） */
const NOW_MS = Date.now();
function companyCreatedAt(idx: number, total: number): Date {
  return new Date(NOW_MS - (total - idx) * 30_000);
}

const DIM_CAPS = { industry: 28, pcb_keywords: 22, role: 18, size: 12, reachability: 8 } as const;
const DIM_TOTAL = 88;

/** 把总分确定性地拆成 5 个维度（各维不超上限，总和等于总分） */
function makeDims(score: number, jitterSeed: number) {
  const keys = Object.keys(DIM_CAPS) as Array<keyof typeof DIM_CAPS>;
  const out: Record<string, number> = {};
  let remaining = score;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      out[key] = Math.max(0, Math.min(DIM_CAPS[key], remaining));
      return;
    }
    const weight = DIM_CAPS[key] / DIM_TOTAL;
    const jitter = 0.9 + ((jitterSeed + i * 7) % 5) / 25; // 0.90 ~ 1.06
    const alloc = Math.min(DIM_CAPS[key], Math.round(score * weight * jitter));
    out[key] = alloc;
    remaining -= alloc;
  });
  return {
    industry: out.industry,
    pcb_keywords: out.pcb_keywords,
    role: out.role,
    size: out.size,
    reachability: out.reachability,
  };
}

// ── 5. reset ──
async function resetDemo(): Promise<number> {
  const demoCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.tenantId, TENANT_ID), sql`${companies.rawPayload}->>'demo' = 'true'`));
  const ids = demoCompanies.map((c) => c.id);

  if (ids.length > 0) {
    const sendIds = (
      await db
        .select({ id: emailSends.id })
        .from(emailSends)
        .where(inArray(emailSends.companyId, ids))
    ).map((s) => s.id);
    const scoreIds = (
      await db
        .select({ id: leadScores.id })
        .from(leadScores)
        .where(inArray(leadScores.companyId, ids))
    ).map((s) => s.id);

    if (sendIds.length > 0) {
      await db.delete(emailEvents).where(inArray(emailEvents.sendId, sendIds));
    }
    if (scoreIds.length > 0) {
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, scoreIds));
    }
    await db.delete(emailSends).where(inArray(emailSends.companyId, ids));
    await db.delete(contentDrafts).where(inArray(contentDrafts.companyId, ids));
    await db.delete(profiles).where(inArray(profiles.companyId, ids));
    await db.delete(leadScores).where(inArray(leadScores.companyId, ids));
    await db.delete(contacts).where(inArray(contacts.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
  }

  const campaigns = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.tenantId, TENANT_ID), sql`${emailCampaigns.name} LIKE '[DEMO]%'`));
  if (campaigns.length > 0) {
    await db.delete(emailCampaigns).where(
      inArray(
        emailCampaigns.id,
        campaigns.map((c) => c.id)
      )
    );
  }

  await db.delete(emailEvents).where(sql`${emailEvents.resendMessageId} LIKE 'demo_%'`);

  return ids.length;
}

async function purgeFailedSends(): Promise<number> {
  const failed = await db
    .select({ id: emailSends.id })
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, TENANT_ID), eq(emailSends.status, 'failed')));
  const ids = failed.map((f) => f.id);
  if (ids.length === 0) return 0;
  await db.delete(emailEvents).where(inArray(emailEvents.sendId, ids));
  await db.delete(emailSends).where(inArray(emailSends.id, ids));
  return ids.length;
}

// ── 6. seed ──
async function ensureTenant(): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: TENANT_ID, name: 'Dev Tenant', slug: 'dev-tenant' })
    .onConflictDoNothing();
}

async function seed(): Promise<void> {
  await ensureTenant();

  // 倒序插入：companies 列表按 createdAt desc 排，最后插入的排最前 → Volterra 置顶
  const ordered = [...DEMO_COMPANIES].reverse();
  const companyIdBySlug = new Map<string, string>();
  let sendCount = 0;
  let draftCount = 0;
  let scoreCount = 0;

  // 演示活动
  const [campaign] = await db
    .insert(emailCampaigns)
    .values({
      tenantId: TENANT_ID,
      name: DEMO_CAMPAIGN.name,
      description: DEMO_CAMPAIGN.description,
      format: DEMO_CAMPAIGN.format,
      status: 'active',
      targetScoreMin: DEMO_CAMPAIGN.targetScoreMin,
      targetScoreMax: DEMO_CAMPAIGN.targetScoreMax,
      totalTargets: 12,
      startedAt: daysAgo(12),
      isWarmup: false,
    })
    .returning({ id: emailCampaigns.id });

  const [warmupDemo] = await db
    .insert(emailCampaigns)
    .values({
      tenantId: TENANT_ID,
      name: DEMO_WARMUP_CAMPAIGN.name,
      description: DEMO_WARMUP_CAMPAIGN.description,
      format: 'cold_email',
      status: 'active',
      totalTargets: 300,
      isWarmup: true,
      startedAt: daysAgo(30),
    })
    .returning({ id: emailCampaigns.id });

  for (const [idx, seedCompany] of ordered.entries()) {
    const [company] = await db
      .insert(companies)
      .values({
        tenantId: TENANT_ID,
        name: seedCompany.name,
        website: seedCompany.website,
        industry: seedCompany.industry,
        sizeBucket: seedCompany.sizeBucket,
        employeeCount: seedCompany.employeeCount,
        fundingStage: seedCompany.fundingStage,
        country: seedCompany.country,
        description: seedCompany.description,
        rawPayload: { demo: true, demoTag: DEMO_TAG, slug: seedCompany.slug },
        createdAt: companyCreatedAt(idx, ordered.length),
        updatedAt: companyCreatedAt(idx, ordered.length),
      })
      .returning({ id: companies.id });
    if (!company) continue;
    const companyId = company.id;
    companyIdBySlug.set(seedCompany.slug, companyId);

    // 联系人（邮箱 = 你自己邮箱的 + 别名，演示发信零外泄）
    const [contact] = await db
      .insert(contacts)
      .values({
        tenantId: TENANT_ID,
        companyId,
        email: demoEmail(seedCompany.slug),
        name: seedCompany.contact.name,
        title: seedCompany.contact.title,
        linkedinUrl: `https://www.linkedin.com/in/${seedCompany.slug}-${seedCompany.contact.local.replace(/\W/g, '')}`,
        emailVerified: 'valid',
        active: true,
        createdAt: companyCreatedAt(idx, ordered.length),
        updatedAt: companyCreatedAt(idx, ordered.length),
      })
      .returning({ id: contacts.id });
    const contactId = contact?.id ?? null;

    // 打分
    const dims = makeDims(seedCompany.score, idx);
    const [scoreRow] = await db
      .insert(leadScores)
      .values({
        tenantId: TENANT_ID,
        companyId,
        contactId,
        score: seedCompany.score,
        grade: seedCompany.grade,
        reason: seedCompany.reason,
        dimensionBreakdown: dims,
        modelVersion: 'v1',
        finalGrade: seedCompany.grade,
        createdAt: daysAgo(20 - idx * 0.5, 8),
      })
      .returning({ id: leadScores.id });
    scoreCount += 1;

    // 人工覆盖（演示「已覆盖」状态 + 审计日志）
    if (seedCompany.override && scoreRow) {
      await db.insert(leadScores).values({
        tenantId: TENANT_ID,
        companyId,
        contactId,
        score: seedCompany.score,
        grade: seedCompany.grade,
        reason: seedCompany.reason,
        dimensionBreakdown: dims,
        modelVersion: 'v1',
        overriddenBy: USER_ID,
        overrideReason: seedCompany.override.reason,
        finalGrade: seedCompany.override.finalGrade,
        createdAt: daysAgo(18 - idx * 0.5, 15),
      });
      await db.insert(auditLogs).values({
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'score.override',
        entityType: 'lead_score',
        entityId: scoreRow.id,
        before: { finalGrade: seedCompany.grade },
        after: {
          finalGrade: seedCompany.override.finalGrade,
          overrideReason: seedCompany.override.reason,
        },
        note: `Overridden by ${USER_ID}`,
        createdAt: daysAgo(18 - idx * 0.5, 15),
      });
      scoreCount += 1;
    }

    // 画像
    const [profile] = await db
      .insert(profiles)
      .values({
        tenantId: TENANT_ID,
        companyId,
        businessSummary: seedCompany.profile.businessSummary,
        productTypes: seedCompany.profile.productTypes,
        customerType: seedCompany.profile.customerType,
        painPoints: seedCompany.profile.painPoints,
        buyingSignals: seedCompany.profile.buyingSignals,
        modelVersion: 'v1',
        createdAt: daysAgo(19 - idx * 0.5, 11),
        updatedAt: daysAgo(19 - idx * 0.5, 11),
      })
      .returning({ id: profiles.id });

    // 内容草稿
    const draftRows: Array<typeof contentDrafts.$inferInsert> = [];
    if (seedCompany.draftSet !== 'none' && seedCompany.coldEmail) {
      draftRows.push(
        {
          tenantId: TENANT_ID,
          companyId,
          contactId,
          profileId: profile?.id ?? null,
          format: 'cold_email',
          variant: 'A',
          subject: seedCompany.coldEmail.a.subject,
          body: seedCompany.coldEmail.a.body,
          status: seedCompany.slug === 'helix-medical-devices' ? 'approved' : 'generated',
          usedFacts: seedCompany.usedFacts,
          gaps: seedCompany.gaps,
          model: 'deepseek-chat',
          createdAt: daysAgo(17 - idx * 0.5, 14),
        },
        {
          tenantId: TENANT_ID,
          companyId,
          contactId,
          profileId: profile?.id ?? null,
          format: 'cold_email',
          variant: 'B',
          subject: seedCompany.coldEmail.b.subject,
          body: seedCompany.coldEmail.b.body,
          status: 'generated',
          usedFacts: seedCompany.usedFacts,
          gaps: seedCompany.gaps,
          model: 'deepseek-chat',
          createdAt: daysAgo(17 - idx * 0.5, 14),
        }
      );
    }
    if (seedCompany.draftSet === 'full' && seedCompany.linkedin) {
      draftRows.push(
        {
          tenantId: TENANT_ID,
          companyId,
          contactId,
          profileId: profile?.id ?? null,
          format: 'linkedin_dm',
          variant: 'A',
          subject: '',
          body: seedCompany.linkedin.a.body,
          status: 'generated',
          usedFacts: seedCompany.usedFacts.slice(0, 2),
          gaps: [],
          model: 'deepseek-chat',
          createdAt: daysAgo(17 - idx * 0.5, 14),
        },
        {
          tenantId: TENANT_ID,
          companyId,
          contactId,
          profileId: profile?.id ?? null,
          format: 'linkedin_dm',
          variant: 'B',
          subject: '',
          body: seedCompany.linkedin.b.body,
          status: seedCompany.slug === 'helix-medical-devices' ? 'rejected' : 'generated',
          usedFacts: seedCompany.usedFacts.slice(0, 2),
          gaps: [],
          model: 'deepseek-chat',
          createdAt: daysAgo(17 - idx * 0.5, 14),
        }
      );
    }
    if (draftRows.length > 0) {
      await db.insert(contentDrafts).values(draftRows);
      draftCount += draftRows.length;
    }

    // 历史发送记录（演示数据，不真实投递）
    const sendPlan = planSendsForCompany(seedCompany.grade, idx);
    for (const plan of sendPlan) {
      const from = FROM_ADDRESSES[(idx + plan.n) % FROM_ADDRESSES.length] ?? {
        name: 'Sales Team',
        email: `sales@${SENDING_DOMAIN}`,
      };
      const sentAt = daysAgo(plan.dayOffset, 9 + (plan.n % 6));
      const deliveredAt =
        plan.status === 'failed' || plan.status === 'queued' || plan.status === 'bounced'
          ? null
          : new Date(sentAt.getTime() + 45_000);
      const openedAt =
        plan.opens > 0 ? new Date(sentAt.getTime() + 3 * 3600_000 + plan.n * 60_000) : null;
      const clickedAt =
        plan.clicks > 0 ? new Date(sentAt.getTime() + 5 * 3600_000 + plan.n * 60_000) : null;

      const [send] = await db
        .insert(emailSends)
        .values({
          tenantId: TENANT_ID,
          campaignId: campaign?.id ?? null,
          companyId,
          contactId,
          fromEmail: from.email,
          fromName: from.name || null,
          toEmail: demoEmail(seedCompany.slug),
          toName: seedCompany.contact.name,
          sendingDomain: SENDING_DOMAIN,
          subject: seedCompany.coldEmail?.a.subject ?? `Partnership inquiry — ${seedCompany.name}`,
          bodySnapshot:
            seedCompany.coldEmail?.a.body ??
            `Hi ${seedCompany.contact.name},\n\n(Demo dataset record for ${seedCompany.name}.)\n\nBest regards,\nGAN PCB Manufacturing`,
          variant: plan.n % 2 === 0 ? 'A' : 'B',
          status: plan.status,
          retryCount: plan.status === 'failed' ? 3 : 0,
          lastError:
            plan.status === 'failed' ? 'Simulated transient SMTP timeout (demo dataset)' : null,
          sentAt: plan.status === 'queued' ? null : sentAt,
          deliveredAt,
          firstOpenedAt: openedAt,
          lastOpenedAt: openedAt,
          openCount: plan.opens,
          firstClickedAt: clickedAt,
          lastClickedAt: clickedAt,
          clickCount: plan.clicks,
          bouncedAt: plan.bounceType ? (deliveredAt ?? sentAt) : null,
          bounceType: plan.bounceType,
          resendMessageId: `demo_${seedCompany.slug}_${plan.n}`,
          createdAt: sentAt,
          updatedAt: clickedAt ?? openedAt ?? deliveredAt ?? sentAt,
        })
        .returning({ id: emailSends.id });
      sendCount += 1;

      if (send && deliveredAt) {
        const events: Array<typeof emailEvents.$inferInsert> = [
          {
            tenantId: TENANT_ID,
            sendId: send.id,
            resendMessageId: `demo_${seedCompany.slug}_${plan.n}`,
            resendEventId: `demo_evt_${seedCompany.slug}_${plan.n}_delivered`,
            eventType: 'delivered',
            createdAt: deliveredAt,
          },
        ];
        if (openedAt) {
          events.push({
            tenantId: TENANT_ID,
            sendId: send.id,
            resendMessageId: `demo_${seedCompany.slug}_${plan.n}`,
            resendEventId: `demo_evt_${seedCompany.slug}_${plan.n}_opened`,
            eventType: 'opened',
            ipAddress: '203.0.113.24',
            userAgent: 'Mozilla/5.0 (compatible; demo dataset)',
            createdAt: openedAt,
          });
        }
        if (clickedAt) {
          events.push({
            tenantId: TENANT_ID,
            sendId: send.id,
            resendMessageId: `demo_${seedCompany.slug}_${plan.n}`,
            resendEventId: `demo_evt_${seedCompany.slug}_${plan.n}_clicked`,
            eventType: 'clicked',
            url: 'https://rakuto.store/capabilities',
            linkTag: 'capabilities',
            createdAt: clickedAt,
          });
        }
        await db.insert(emailEvents).values(events);
      }

      if (send && plan.bounceType) {
        await db.insert(emailEvents).values({
          tenantId: TENANT_ID,
          sendId: send.id,
          resendMessageId: `demo_${seedCompany.slug}_${plan.n}`,
          resendEventId: `demo_evt_${seedCompany.slug}_${plan.n}_bounced`,
          eventType: 'bounced',
          bounceType: plan.bounceType,
          bounceSubtype: plan.bounceType === 'hard' ? 'General' : 'MailboxFull',
          diagnosticCode: 'smtp; 550 5.1.1 mailbox unavailable (demo dataset)',
          createdAt: deliveredAt ?? sentAt,
        });
      }
    }
  }

  // 演示 warmup 历史（让 reputation 卡片呈现健康色阶）
  const warmupContacts = await db
    .select({ id: contacts.id, companyId: contacts.companyId })
    .from(contacts)
    .where(eq(contacts.tenantId, TENANT_ID))
    .limit(6);
  const warmSent = 300;
  const warmDelivered = 285;
  const warmOpened = 198;
  const warmClicked = 88;
  if (warmupDemo && warmupContacts.length > 0) {
    await db
      .update(emailCampaigns)
      .set({
        totalSent: warmSent,
        totalDelivered: warmDelivered,
        totalOpened: warmOpened,
        totalClicked: warmClicked,
        totalBounced: 4,
        totalComplained: 0,
        totalReplied: 0,
      })
      .where(eq(emailCampaigns.id, warmupDemo.id));

    // 抽样写少量 warmup 发送明细，避免发送记录被 300 条淹没（活动计数已代表全量）
    const warmupRows: Array<typeof emailSends.$inferInsert> = [];
    for (let i = 0; i < 12; i += 1) {
      const c = warmupContacts[i % warmupContacts.length];
      if (!c) continue;
      const sentAt = daysAgo(6 - Math.floor(i / 2), 2);
      warmupRows.push({
        tenantId: TENANT_ID,
        campaignId: warmupDemo.id,
        companyId: c.companyId,
        contactId: c.id,
        fromEmail: `warmup@${SENDING_DOMAIN}`,
        fromName: 'Domain Warmup',
        toEmail: `seed${i}@${SENDING_DOMAIN}`,
        toName: 'Warmup Seed',
        sendingDomain: SENDING_DOMAIN,
        subject: `Warmup cycle — scheduled domain ramp [demo #${i + 1}]`,
        bodySnapshot: 'Demo dataset warmup record.',
        variant: 'A',
        status: i % 3 === 0 ? 'clicked' : i % 3 === 1 ? 'opened' : 'delivered',
        sentAt,
        deliveredAt: new Date(sentAt.getTime() + 30_000),
        firstOpenedAt: i % 3 === 2 ? null : new Date(sentAt.getTime() + 2 * 3600_000),
        lastOpenedAt: i % 3 === 2 ? null : new Date(sentAt.getTime() + 2 * 3600_000),
        openCount: i % 3 === 2 ? 0 : 1,
        firstClickedAt: i % 3 === 0 ? new Date(sentAt.getTime() + 4 * 3600_000) : null,
        lastClickedAt: i % 3 === 0 ? new Date(sentAt.getTime() + 4 * 3600_000) : null,
        clickCount: i % 3 === 0 ? 1 : 0,
        resendMessageId: `demo_warmup_${i}`,
        createdAt: sentAt,
        updatedAt: sentAt,
      });
    }
    if (warmupRows.length > 0) {
      await db.insert(emailSends).values(warmupRows);
      sendCount += warmupRows.length;
    }
  }

  console.log('');
  console.log('  演示数据写入完成');
  console.log(`  租户           : ${TENANT_ID}`);
  console.log(`  公司 / 联系人  : ${companyIdBySlug.size} / ${companyIdBySlug.size}`);
  console.log(`  打分记录       : ${scoreCount}（含人工覆盖）`);
  console.log(`  客户画像       : ${companyIdBySlug.size}`);
  console.log(`  内容草稿       : ${draftCount}`);
  console.log(`  邮件发送记录   : ${sendCount}`);
  console.log(`  演示收件邮箱   : ${demoEmail('<公司标识>')}  ← 全部指向你自己`);
  console.log('');
}

/** 按等级生成该公司的历史发送计划（确定性，保证每次跑出来一样） */
function planSendsForCompany(
  grade: 'A' | 'B' | 'C',
  idx: number
): Array<{
  n: number;
  dayOffset: number;
  status: string;
  opens: number;
  clicks: number;
  bounceType: string | null;
}> {
  const count = grade === 'A' ? 7 : grade === 'B' ? 6 : 4;
  const plan: Array<{
    n: number;
    dayOffset: number;
    status: string;
    opens: number;
    clicks: number;
    bounceType: string | null;
  }> = [];

  for (let n = 0; n < count; n += 1) {
    const dayOffset = 11 - ((idx * 3 + n * 2) % 11);
    const base = { n, dayOffset, opens: 0, clicks: 0, bounceType: null as string | null };

    // A 级必有一条回复 + 一条硬退（演示「回复」与「退信自动拉黑」）
    if (n === 0 && grade === 'A') {
      plan.push({ ...base, status: 'replied', opens: 3, clicks: 2 });
      continue;
    }
    if (n === 1 && grade === 'A') {
      plan.push({ ...base, status: 'bounced', bounceType: 'hard' });
      continue;
    }
    // C 级必有一条排队中（演示「取消排队发送」）
    if (n === count - 1 && grade === 'C') {
      plan.push({ ...base, status: 'queued' });
      continue;
    }
    // B 级抽一条软退（演示软退累计拉黑）；只放 1-2 条，避免退信率看起来不正常
    if (n === 2 && grade === 'B' && idx % 3 === 0) {
      plan.push({ ...base, status: 'bounced', bounceType: 'soft' });
      continue;
    }

    const r = rnd();
    if (r < 0.26) {
      plan.push({ ...base, status: 'clicked', opens: 2, clicks: 1 });
    } else if (r < 0.62) {
      plan.push({ ...base, status: 'opened', opens: 1 });
    } else if (r < 0.86) {
      plan.push({ ...base, status: 'delivered' });
    } else {
      plan.push({ ...base, status: 'queued' });
    }
  }
  return plan;
}

// ── 7. main ──
const removed = await resetDemo();
if (removed > 0) console.log(`  已清理旧的演示数据：${removed} 家公司`);

if (PURGE_FAILED) {
  const purged = await purgeFailedSends();
  if (purged > 0) {
    console.log(`  已清理历史 failed 发送记录：${purged} 条（域名未验证时期的残留）`);
  }
}

if (!RESET_ONLY) {
  await seed();
}

process.exit(0);
