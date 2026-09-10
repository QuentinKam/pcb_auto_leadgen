import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import 'dotenv/config';

import { companiesRoutes } from './routes/companies.ts';
import { contactsRoutes } from './routes/contacts.ts';
import { contentRoutes } from './routes/content.ts';
import { leadScoresRoutes } from './routes/lead-scores.ts';
import { mailRoutes } from './routes/mails.ts';
import { tenantsRoutes } from './routes/tenants.ts';

const app = new Hono();

// 中间件
app.use('*', logger());
app.use('*', secureHeaders());

// 健康检查
app.get('/health', (c) =>
  c.json({
    service: 'gateway',
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
);

// 业务路由
app.route('/api/lead-scores', leadScoresRoutes);
app.route('/api/tenants', tenantsRoutes);
app.route('/api/companies', companiesRoutes);
app.route('/api/contacts', contactsRoutes);
app.route('/api/content', contentRoutes);
app.route('/api/mails', mailRoutes);

// 404 兜底
app.notFound((c) => c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404));

// 全局错误处理
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500);
});

const port = Number(process.env.PORT ?? 3001);

export { app };
export default {
  port,
  fetch: app.fetch,
};

console.log(`Gateway listening on http://localhost:${port}`);
