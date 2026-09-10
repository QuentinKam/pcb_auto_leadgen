import 'dotenv/config';
import { emailSends } from '@pcb/db/schema';
import { type Job, Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db.ts';
import { SEND_QUEUE_NAME, type SendJobPayload } from '../lib/queue.ts';
import {
  checkAndConsumeDomainQuota,
  checkAndConsumeFromEmailQuota,
  rollbackQuota,
} from '../lib/quota.ts';
import { ensureRedisConnected, redis } from '../lib/redis.ts';
import { type ResendSendResult, resendClient } from '../lib/resend-client.ts';

const MIN_SEND_INTERVAL_MS = Number(process.env.MIN_SEND_INTERVAL_MS ?? 1000);

async function loadSendRecord(tenantId: string, emailSendId: string) {
  const rows = await db
    .select()
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, emailSendId)))
    .limit(1);
  return rows[0] ?? null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function processSend(
  job: Job<SendJobPayload>
): Promise<{ messageId: string | null; status: string }> {
  const { tenantId, emailSendId } = job.data;
  const record = await loadSendRecord(tenantId, emailSendId);
  if (!record) {
    throw new Error(`EmailSend ${emailSendId} not found`);
  }
  if (!['queued', 'failed'].includes(record.status)) {
    console.log(`[worker] Skip send ${emailSendId} in status=${record.status}`);
    return { messageId: record.resendMessageId, status: record.status };
  }

  await db
    .update(emailSends)
    .set({
      status: 'sending',
      retryCount: (record.retryCount ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(emailSends.id, record.id));

  const domainQuota = await checkAndConsumeDomainQuota(tenantId, record.sendingDomain);
  const fromQuota = await checkAndConsumeFromEmailQuota(tenantId, record.fromEmail);

  if ((domainQuota as unknown as { suspended?: boolean }).suspended) {
    const reason = `Domain ${record.sendingDomain} SUSPENDED due to complaint rate threshold; manual review required`;
    await db
      .update(emailSends)
      .set({ status: 'blocked', lastError: reason, updatedAt: new Date() })
      .where(eq(emailSends.id, record.id));
    throw new Error(reason);
  }

  if (!domainQuota.allowed || !fromQuota.allowed) {
    const reason = !domainQuota.allowed
      ? `Domain daily quota exceeded (${domainQuota.count}/${domainQuota.limit})`
      : `From email daily quota exceeded (${fromQuota.count}/${fromQuota.limit})`;
    await rollbackQuota(tenantId, record.sendingDomain, record.fromEmail);
    await db
      .update(emailSends)
      .set({ status: 'quota_exceeded', lastError: reason, updatedAt: new Date() })
      .where(eq(emailSends.id, record.id));
    throw new Error(reason);
  }

  try {
    if (MIN_SEND_INTERVAL_MS > 0) await sleep(MIN_SEND_INTERVAL_MS);

    const fromStr = record.fromName ? `${record.fromName} <${record.fromEmail}>` : record.fromEmail;
    const to = [record.toEmail];
    const bodyHtml: string | null = /<[a-z][\s\S]*>/i.test(record.bodySnapshot ?? '')
      ? record.bodySnapshot
      : null;
    const bodyText: string | null = bodyHtml ? null : (record.bodySnapshot ?? null);

    const tags = [
      { name: 'tenant_id', value: tenantId },
      { name: 'send_id', value: record.id },
      { name: 'variant', value: record.variant ?? 'A' },
    ];
    if (record.campaignId) tags.push({ name: 'campaign_id', value: record.campaignId });

    const result: ResendSendResult = await resendClient.send({
      from: fromStr,
      to,
      subject: record.subject ?? '(no subject)',
      html: bodyHtml,
      text: bodyText,
      tags,
      headers: {
        'X-PCB-Send-Id': record.id,
        ...(record.campaignId ? { 'X-PCB-Campaign-Id': record.campaignId } : {}),
      },
    });

    if (result.success) {
      const now = new Date();
      await db
        .update(emailSends)
        .set({
          status: result.usedMock ? 'sent_mock' : 'sent',
          resendMessageId: result.messageId,
          sentAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(emailSends.id, record.id));
      return { messageId: result.messageId, status: result.usedMock ? 'sent_mock' : 'sent' };
    }

    await rollbackQuota(tenantId, record.sendingDomain, record.fromEmail);
    await db
      .update(emailSends)
      .set({
        status: 'failed',
        lastError: result.errorMessage ?? 'Unknown resend error',
        updatedAt: new Date(),
      })
      .where(eq(emailSends.id, record.id));
    throw new Error(result.errorMessage ?? 'Send failed');
  } catch (err) {
    await rollbackQuota(tenantId, record.sendingDomain, record.fromEmail);
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(emailSends)
      .set({ status: 'failed', lastError: msg, updatedAt: new Date() })
      .where(eq(emailSends.id, record.id));
    throw err;
  }
}

async function main(): Promise<void> {
  await ensureRedisConnected();
  console.log(
    `[worker] Starting BullMQ worker on queue=${SEND_QUEUE_NAME}, mock mode=${resendClient.isMock}`
  );

  const worker = new Worker<SendJobPayload, { messageId: string | null; status: string }>(
    SEND_QUEUE_NAME,
    async (job) => processSend(job),
    {
      connection: redis,
      concurrency: 1,
    }
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[worker] Completed job=${job.id} sendId=${job.data.emailSendId} status=${result.status} messageId=${result.messageId}`
    );
  });

  worker.on('failed', (job, err) => {
    const attemptNumber = job?.attemptsMade ?? 0;
    console.error(
      `[worker] FAILED job=${job?.id} sendId=${job?.data.emailSendId} attempts=${attemptNumber}: ${err.message}`
    );
  });

  process.on('SIGTERM', async () => {
    console.log('[worker] SIGTERM, shutting down...');
    await worker.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    console.log('[worker] SIGINT, shutting down...');
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[worker] Fatal:', err);
  process.exit(1);
});
