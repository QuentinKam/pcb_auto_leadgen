import { afterEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { API_KEY_HEADER, authMiddleware, getAuthMode } from './auth.ts';
import { type AppEnv, traceMiddleware } from './trace.ts';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', traceMiddleware());
  app.use('*', authMiddleware());
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/whoami', (c) => c.json({ tenantId: c.get('authTenantId') ?? null }));
  return app;
}

describe('gateway 鉴权', () => {
  it('AUTH_MODE 未配置时默认关闭，业务接口放行', async () => {
    delete process.env.AUTH_MODE;
    expect(getAuthMode()).toBe('off');
    const res = await buildApp().request('/api/whoami');
    expect(res.status).toBe(200);
  });

  it('AUTH_MODE=required 且无凭据时返回 401', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.GATEWAY_API_KEY = 'correct-key';
    delete process.env.JWT_SECRET;

    const res = await buildApp().request('/api/whoami');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('AUTH_MODE=required 且 API Key 正确时放行', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.GATEWAY_API_KEY = 'correct-key';
    delete process.env.JWT_SECRET;

    const res = await buildApp().request('/api/whoami', {
      headers: { [API_KEY_HEADER]: 'correct-key', 'X-Tenant-Id': 'tenant-a' },
    });
    expect(res.status).toBe(200);
  });

  it('AUTH_MODE=required 且 API Key 正确但缺租户头时返回 400', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.GATEWAY_API_KEY = 'correct-key';
    delete process.env.JWT_SECRET;

    const res = await buildApp().request('/api/whoami', {
      headers: { [API_KEY_HEADER]: 'correct-key' },
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'MISSING_TENANT' });
  });

  it('AUTH_MODE=required 且 API Key 错误时返回 401', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.GATEWAY_API_KEY = 'correct-key';
    delete process.env.JWT_SECRET;

    const res = await buildApp().request('/api/whoami', {
      headers: { [API_KEY_HEADER]: 'wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('AUTH_MODE=required 但未配置任何凭据时返回 500', async () => {
    process.env.AUTH_MODE = 'required';
    delete process.env.GATEWAY_API_KEY;
    delete process.env.JWT_SECRET;

    const res = await buildApp().request('/api/whoami');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ code: 'AUTH_MISCONFIGURED' });
  });

  it('AUTH_MODE=required 时 /health 与 OPTIONS 预检仍放行', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.GATEWAY_API_KEY = 'correct-key';
    delete process.env.JWT_SECRET;

    const app = buildApp();
    const health = await app.request('/health');
    expect(health.status).toBe(200);

    const preflight = await app.request('/api/whoami', { method: 'OPTIONS' });
    expect(preflight.status).not.toBe(401);
  });

  it('JWT 模式下 tenant_id 取自 token，请求头无法冒充其他租户', async () => {
    const secret = 'integration-secret';
    process.env.AUTH_MODE = 'required';
    process.env.JWT_SECRET = secret;
    delete process.env.GATEWAY_API_KEY;

    const token = await sign({ sub: 'user-1', tenant_id: 'tenant-from-token' }, secret, 'HS256');
    const res = await buildApp().request('/api/whoami', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': 'tenant-forged',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ tenantId: 'tenant-from-token' });
  });

  it('JWT 签名不匹配时返回 401', async () => {
    process.env.AUTH_MODE = 'required';
    process.env.JWT_SECRET = 'real-secret';
    delete process.env.GATEWAY_API_KEY;

    const forged = await sign(
      { sub: 'attacker', tenant_id: 'other-tenant' },
      'wrong-secret',
      'HS256'
    );
    const res = await buildApp().request('/api/whoami', {
      headers: { Authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });
});
