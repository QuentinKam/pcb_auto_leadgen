import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveTenantId } from '../middleware/auth.ts';
import { type AppEnv, TRACE_HEADER, getTraceId } from '../middleware/trace.ts';

const COLLECTOR_URL = process.env.COLLECTOR_URL ?? 'http://localhost:3004';
const TIMEOUT_MS = 120_000;

export const collectorsRoutes = new Hono<AppEnv>();

const runSchema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(10),
  country: z.string().min(2).max(10).optional(),
  limitPerKeyword: z.number().int().min(1).max(20).optional(),
  enrich: z.boolean().optional(),
  score: z.boolean().optional(),
});

/**
 * POST /api/collectors/run
 * 转发到 collector /collect：搜索 → enrich → 落库 → 打分。
 * 鉴权/租户边界在 gateway；collector 使用自身配置的 TENANT_ID 落库。
 */
collectorsRoutes.post(
  '/run',
  zValidator('json', runSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const headers = new Headers();
    const tenantId = resolveTenantId(c);
    if (tenantId) headers.set('X-Tenant-Id', tenantId);
    headers.set('Content-Type', 'application/json');
    const traceId = getTraceId(c);
    if (traceId) headers.set(TRACE_HEADER, traceId);

    try {
      const res = await fetch(`${COLLECTOR_URL}/collect`, {
        method: 'POST',
        headers,
        body: JSON.stringify(c.req.valid('json')),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timed out')) {
        return c.json({ error: 'Collector timeout', code: 'COLLECTOR_TIMEOUT' }, 504);
      }
      return c.json({ error: `Collector unavailable: ${msg}`, code: 'COLLECTOR_UNAVAILABLE' }, 502);
    }
  }
);
