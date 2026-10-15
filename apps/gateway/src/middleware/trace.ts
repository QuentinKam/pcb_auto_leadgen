import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

/** 贯穿「网关 → 微服务 → LLM 调用」的链路标识 */
export const TRACE_HEADER = 'X-Trace-Id';

/** 网关内所有 Hono 实例共享的环境类型 */
export type AppEnv = {
  Variables: {
    traceId: string;
    /** 由 JWT 解析出的租户，存在时优先级高于请求头 */
    authTenantId?: string;
    authSubject?: string;
  };
};

/**
 * 只接受有限字符集且限制长度：
 * trace id 会进日志，放任上游传任意值等于给日志注入换行与超长内容
 */
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** 生成或沿用一个 trace id，并在响应头回传，便于端上串联报错 */
export function traceMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header(TRACE_HEADER);
    const traceId = incoming && TRACE_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    c.set('traceId', traceId);
    c.header(TRACE_HEADER, traceId);
    await next();
  };
}

/** 取当前请求链路 ID */
export function getTraceId(c: Context<AppEnv>): string {
  return c.get('traceId');
}
