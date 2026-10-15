import { type Context, Hono } from 'hono';
import { resolveTenantId } from '../middleware/auth.ts';
import { type AppEnv, TRACE_HEADER, getTraceId } from '../middleware/trace.ts';

const MAILER_URL = process.env.MAILER_URL ?? 'http://localhost:3003';
const TIMEOUT_MS = 60_000;

export const mailRoutes = new Hono<AppEnv>();

function getForwardHeaders(c: Context<AppEnv>) {
  const headers = new Headers();
  const tenantId = resolveTenantId(c);
  if (tenantId) headers.set('X-Tenant-Id', tenantId);
  const ct = c.req.header('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  const accept = c.req.header('Accept');
  if (accept) headers.set('Accept', accept);
  const auth = c.req.header('Authorization');
  if (auth) headers.set('Authorization', auth);
  const traceId = getTraceId(c);
  if (traceId) headers.set(TRACE_HEADER, traceId);
  return headers;
}

mailRoutes.all('/*', async (c) => {
  const method = c.req.method;
  const url = new URL(c.req.url);
  const subpath = url.pathname.replace(/^\/api\/mails/, '') || '/';
  const targetUrl = `${MAILER_URL}${subpath}${url.search}`;

  const headers = getForwardHeaders(c);
  if (subpath.startsWith('/webhook')) {
    const svixId = c.req.header('svix-id');
    const svixTs = c.req.header('svix-timestamp');
    const svixSig = c.req.header('svix-signature');
    if (svixId) headers.set('svix-id', svixId);
    if (svixTs) headers.set('svix-timestamp', svixTs);
    if (svixSig) headers.set('svix-signature', svixSig);
  }

  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (subpath.startsWith('/webhook')) {
      body = await c.req.text();
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    } else {
      try {
        const json = await c.req.json();
        body = JSON.stringify(json);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      } catch {
        body = undefined;
      }
    }
  }

  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const resBody = await res.text();
    return c.body(resBody, res.status as never, Object.fromEntries(res.headers.entries()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out')) {
      return c.json({ error: 'Mailer timeout', code: 'MAILER_TIMEOUT' }, 504);
    }
    return c.json({ error: `Mailer unavailable: ${msg}`, code: 'MAILER_UNAVAILABLE' }, 502);
  }
});
