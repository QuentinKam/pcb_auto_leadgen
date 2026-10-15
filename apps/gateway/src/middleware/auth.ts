import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import { type AppEnv, getTraceId } from './trace.ts';

export const API_KEY_HEADER = 'X-Api-Key';

export type AuthMode = 'off' | 'required';

/**
 * 开发期默认关闭，保持现有联调链路（含 demo 环境）可用；
 * 生产由 PM2 env 注入 AUTH_MODE=required。
 *
 * 注意：关闭时租户 ID 仍信任 X-Tenant-Id 请求头，
 * 因此生产环境必须配合 AUTH_MODE=required，不能只靠 nginx basic auth。
 */
export function getAuthMode(): AuthMode {
  return process.env.AUTH_MODE?.toLowerCase() === 'required' ? 'required' : 'off';
}

export interface Identity {
  tenantId: string;
  subject: string;
}

/**
 * 取当前请求的租户 ID
 * JWT 模式下以 token 解析结果为准，调用方无法用请求头冒充其他租户；
 * 鉴权关闭时退回请求头，仅供开发/demo 使用
 */
export function resolveTenantId(c: Context<AppEnv>): string | null {
  const fromToken = c.get('authTenantId');
  if (typeof fromToken === 'string' && fromToken.length > 0) return fromToken;
  return c.req.header('X-Tenant-Id') ?? null;
}

/** 常量时间比较，避免 API Key 被逐字节时序爆破 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 校验调用方身份
 * 优先 JWT —— tenant_id 从 token 解析，请求头无法覆盖，从根上杜绝跨租户读取；
 * 未配置 JWT_SECRET 时回退静态 API Key
 */
async function authenticate(c: Context<AppEnv>): Promise<Identity | null> {
  const jwtSecret = process.env.JWT_SECRET;
  const authHeader = c.req.header('Authorization');

  if (jwtSecret && authHeader?.startsWith('Bearer ')) {
    let payload: Record<string, unknown>;
    try {
      payload = (await verify(authHeader.slice(7), jwtSecret, 'HS256')) as Record<string, unknown>;
    } catch {
      return null;
    }
    const tenantId = payload.tenant_id;
    if (typeof tenantId !== 'string' || tenantId.length === 0) return null;
    return {
      tenantId,
      subject: typeof payload.sub === 'string' ? payload.sub : 'unknown',
    };
  }

  const expectedKey = process.env.GATEWAY_API_KEY;
  const presentedKey = c.req.header(API_KEY_HEADER);
  if (expectedKey && presentedKey && safeEqual(presentedKey, expectedKey)) {
    // 静态 Key 只能证明"有权调用网关"，租户归属仍由请求头声明
    return { tenantId: c.req.header('X-Tenant-Id') ?? '', subject: 'api-key' };
  }

  return null;
}

/**
 * 网关鉴权中间件
 * AUTH_MODE=required 时，除 /health 与 OPTIONS 预检外所有请求都需通过校验。
 * 未配置任何凭据来源时直接 500：宁可拒绝服务，也不要"以为开了其实没开"。
 */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (getAuthMode() === 'off') {
      await next();
      return;
    }

    const path = new URL(c.req.url).pathname;
    if (path === '/health' || c.req.method === 'OPTIONS') {
      await next();
      return;
    }

    // token 签发端点本身不要求已持有 token，否则会出现「要 token 才能拿 token」的死循环
    if (path === '/api/auth/token') {
      await next();
      return;
    }

    if (!process.env.JWT_SECRET && !process.env.GATEWAY_API_KEY) {
      console.error(
        '[gateway][auth] AUTH_MODE=required but neither JWT_SECRET nor GATEWAY_API_KEY is set'
      );
      return c.json({ error: 'Auth required but not configured', code: 'AUTH_MISCONFIGURED' }, 500);
    }

    const identity = await authenticate(c);
    if (!identity) {
      console.warn(`[gateway][auth] trace=${getTraceId(c)} rejected ${c.req.method} ${path}`);
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    // 身份有效但没有租户标识是「参数缺失」，与「身份不合法」区分开，便于调用方定位
    if (identity.tenantId.length === 0) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }

    c.set('authTenantId', identity.tenantId);
    c.set('authSubject', identity.subject);
    await next();
  };
}
