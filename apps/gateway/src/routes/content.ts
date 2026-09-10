import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const SCORER_URL = process.env.SCORER_URL ?? 'http://localhost:3002';
const TIMEOUT_MS = 120_000;

export const contentRoutes = new Hono();

function getForwardHeaders(c: Parameters<Parameters<Hono['use']>[1]>[0]) {
  const headers = new Headers();
  const tenantId = c.req.header('X-Tenant-Id');
  if (tenantId) headers.set('X-Tenant-Id', tenantId);
  const ct = c.req.header('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  const accept = c.req.header('Accept');
  if (accept) headers.set('Accept', accept);
  return headers;
}

contentRoutes.get('/profile/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const headers = getForwardHeaders(c as never);

  try {
    const res = await fetch(`${SCORER_URL}/content/profile/${companyId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      return c.json({ error: 'Scorer timeout', code: 'SCORER_TIMEOUT' }, 504);
    }
    return c.json({ error: `Scorer unavailable: ${msg}`, code: 'SCORER_UNAVAILABLE' }, 502);
  }
});

contentRoutes.post('/profile/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const headers = getForwardHeaders(c as never);

  try {
    const res = await fetch(`${SCORER_URL}/content/profile/${companyId}`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      return c.json({ error: 'Scorer timeout', code: 'SCORER_TIMEOUT' }, 504);
    }
    return c.json({ error: `Scorer unavailable: ${msg}`, code: 'SCORER_UNAVAILABLE' }, 502);
  }
});

const generateSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  format: z.enum(['cold_email', 'linkedin_dm', 'industry_blog']),
  variant: z.enum(['A', 'B']).optional(),
});

contentRoutes.post(
  '/generate',
  zValidator('json', generateSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const payload = c.req.valid('json' as never);
    const headers = getForwardHeaders(c as never);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    try {
      const res = await fetch(`${SCORER_URL}/content/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timed out')) {
        return c.json({ error: 'Scorer timeout', code: 'SCORER_TIMEOUT' }, 504);
      }
      return c.json({ error: `Scorer unavailable: ${msg}`, code: 'SCORER_UNAVAILABLE' }, 502);
    }
  }
);

contentRoutes.get('/drafts/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const headers = getForwardHeaders(c as never);

  try {
    const res = await fetch(`${SCORER_URL}/content/drafts/${companyId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      return c.json({ error: 'Scorer timeout', code: 'SCORER_TIMEOUT' }, 504);
    }
    return c.json({ error: `Scorer unavailable: ${msg}`, code: 'SCORER_UNAVAILABLE' }, 502);
  }
});

const updateDraftSchema = z.object({
  status: z.enum(['generated', 'approved', 'rejected', 'sent']).optional(),
  body: z.string().optional(),
  subject: z.string().optional(),
});

contentRoutes.patch(
  '/drafts/:draftId',
  zValidator('json', updateDraftSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const draftId = c.req.param('draftId');
    const payload = c.req.valid('json' as never);
    const headers = getForwardHeaders(c as never);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    try {
      const res = await fetch(`${SCORER_URL}/content/drafts/${draftId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();
      return c.body(body, res.status as never, Object.fromEntries(res.headers.entries()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('timed out')) {
        return c.json({ error: 'Scorer timeout', code: 'SCORER_TIMEOUT' }, 504);
      }
      return c.json({ error: `Scorer unavailable: ${msg}`, code: 'SCORER_UNAVAILABLE' }, 502);
    }
  }
);
