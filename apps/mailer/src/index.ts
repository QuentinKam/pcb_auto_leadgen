import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import 'dotenv/config';

import { QUOTA_LIMITS } from './lib/quota.ts';
import { ensureRedisConnected } from './lib/redis.ts';
import { resendClient } from './lib/resend-client.ts';
import { senderPool } from './lib/sender-pool.ts';
import { warmupConfig } from './lib/warmup-config.ts';
import { sendsRoutes } from './routes/sends.ts';
import { statsAndCampaignsRoutes } from './routes/stats-and-campaigns.ts';
import { warmupRoutes } from './routes/warmup.ts';
import { webhookRoutes } from './routes/webhook.ts';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.get('/health', async (c) => {
  let redisOk = false;
  try {
    redisOk = (await import('./lib/redis.ts')).redis.status === 'ready';
  } catch {
    redisOk = false;
  }
  await ensureRedisConnected().catch(() => {});
  const todaysEntry = warmupConfig.getTodaysEntry();
  return c.json({
    service: 'mailer',
    status: 'ok',
    timestamp: new Date().toISOString(),
    resend: {
      mockMode: resendClient.isMock,
    },
    senders: {
      poolSize: senderPool.all().length,
      domains: senderPool.listDomains(),
    },
    quota: QUOTA_LIMITS,
    warmup: {
      enabled: process.env.WARMUP_ENABLED !== 'false',
      startDate: warmupConfig.getStartDate().toISOString().slice(0, 10),
      elapsedDays: warmupConfig.getElapsedDays(),
      todaysTarget: todaysEntry?.targetCount ?? 0,
      seedPoolSize: warmupConfig.plan.seedEmails.length,
      sendingDomains: warmupConfig.getDomainCandidates(),
    },
    redis: redisOk ? 'ready' : 'disconnected (in-memory fallback active)',
  });
});

app.route('/sends', sendsRoutes);
app.route('/warmup', warmupRoutes);
app.route('/webhook', webhookRoutes);
app.route('/', statsAndCampaignsRoutes);

app.notFound((c) => c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404));

app.onError((err, c) => {
  console.error('[mailer] Unhandled error:', err);
  return c.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500);
});

const port = Number(process.env.PORT ?? 3003);

export { app };
export default {
  port,
  fetch: app.fetch,
};

console.log(
  `[mailer] Listening on http://localhost:${port} | resend_mode=${resendClient.isMock ? 'MOCK' : 'LIVE'} | senders=${senderPool.all().length} | domains=${senderPool.listDomains().join(',')} | warmup_enabled=${process.env.WARMUP_ENABLED !== 'false'} | warmup_seeds=${warmupConfig.plan.seedEmails.length}`
);
