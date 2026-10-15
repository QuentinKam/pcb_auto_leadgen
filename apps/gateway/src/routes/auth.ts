import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import type { AppEnv } from '../middleware/trace.ts';

/**
 * POST /api/auth/token
 * 身份校验已由 nginx basic auth 完成（浏览器自动携带 Authorization: Basic），
 * 此处仅解析用户名，并用 JWT_SECRET 签发绑定租户的 JWT。
 * 该端点被 auth 中间件白名单放行（见 middleware/auth.ts），因此无需已持有 token。
 */
export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/token', async (c) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return c.json({ error: 'Token endpoint not configured', code: 'NOT_CONFIGURED' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Basic ')) {
    return c.json({ error: 'Basic auth required', code: 'UNAUTHORIZED' }, 401);
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  const username = decoded.split(':')[0];
  if (!username) {
    return c.json({ error: 'Invalid credentials', code: 'UNAUTHORIZED' }, 401);
  }

  const tenantId = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000000';
  const expiresIn = 12 * 3600;
  const token = await sign(
    { sub: username, tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + expiresIn },
    secret,
    'HS256'
  );

  return c.json({ token, tokenType: 'Bearer', expiresIn });
});
