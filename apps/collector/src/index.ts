import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { SearchProviderConfigError } from './clients/search/factory.ts';
import { loadConfig } from './config.ts';
import { runCollect } from './pipeline.ts';

const config = loadConfig();

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.get('/health', (c) =>
  c.json({
    service: 'collector',
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
);

const collectSchema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(10),
  country: z.string().min(2).max(10).optional(),
  limitPerKeyword: z.number().int().min(1).max(20).optional(),
  enrich: z.boolean().optional(),
  score: z.boolean().optional(),
});

app.post(
  '/collect',
  zValidator('json', collectSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const body = c.req.valid('json');
    const summary = await runCollect(
      {
        keywords: body.keywords,
        country: body.country ?? null,
        limitPerKeyword: body.limitPerKeyword,
        enrich: body.enrich,
        score: body.score,
      },
      config
    );
    return c.json(summary);
  }
);

app.notFound((c) => c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404));

app.onError((err, c) => {
  if (err instanceof SearchProviderConfigError) {
    return c.json({ error: err.message, code: 'SEARCH_PROVIDER_UNAVAILABLE' }, 503);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500);
});

export { app };
export default {
  port: config.PORT,
  fetch: app.fetch,
};

console.log(`Collector listening on http://localhost:${config.PORT}`);
