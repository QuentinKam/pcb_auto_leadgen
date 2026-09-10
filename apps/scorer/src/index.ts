import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import 'dotenv/config';

import { scoreRoutes } from './routes/score.ts';
import { contentRoutes } from './routes/content.ts';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.get('/health', (c) =>
  c.json({
    service: 'scorer',
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
);

app.route('/score', scoreRoutes);
app.route('/content', contentRoutes);

app.notFound((c) => c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500);
});

const port = Number(process.env.PORT ?? 3002);

export { app };
export default {
  port,
  fetch: app.fetch,
};

console.log(`Scorer listening on http://localhost:${port}`);
