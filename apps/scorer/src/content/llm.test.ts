import { afterEach, describe, expect, it, mock } from 'bun:test';
import { LLMError, chat, chatJson, chatWithFallback } from './llm.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function useAnthropic(): void {
  process.env.LLM_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
}

function anthropicOk(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('upstream error', { status, headers });
}

/** 捕获 chat 抛出的 LLMError 以便断言 kind / retryable */
async function captureError(run: () => Promise<unknown>): Promise<LLMError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(LLMError);
    return error as LLMError;
  }
  throw new Error('expected chat to throw, but it resolved');
}

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('llm 加固', () => {
  it('正常返回文本', async () => {
    useAnthropic();
    let seenSignal = false;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      seenSignal = init.signal !== undefined;
      return Promise.resolve(anthropicOk('hello'));
    }) as unknown as typeof fetch;

    await expect(chat(messages)).resolves.toBe('hello');
    expect(seenSignal).toBe(true);
  });

  it('超时抛 timeout 且标记为可重试', async () => {
    useAnthropic();
    process.env.LLM_TIMEOUT_MS = '5';
    process.env.LLM_MAX_RETRIES = '0';
    globalThis.fetch = mock(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation timed out.');
            error.name = 'TimeoutError';
            reject(error);
          });
        })
    ) as unknown as typeof fetch;

    const error = await captureError(() => chat(messages));
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('429 按 Retry-After 退避后重试成功', async () => {
    useAnthropic();
    process.env.LLM_MAX_RETRIES = '1';
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? errorResponse(429, { 'retry-after': '0' }) : anthropicOk('recovered')
      );
    }) as unknown as typeof fetch;

    await expect(chat(messages)).resolves.toBe('recovered');
    expect(calls).toBe(2);
  });

  it('5xx 重试耗尽后抛 server 错误', async () => {
    useAnthropic();
    process.env.LLM_MAX_RETRIES = '2';
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(errorResponse(503, { 'retry-after': '0' }));
    }) as unknown as typeof fetch;

    const error = await captureError(() => chat(messages));
    expect(error.kind).toBe('server');
    expect(error.status).toBe(503);
    expect(calls).toBe(3);
  });

  it('401 立即失败且不重试', async () => {
    useAnthropic();
    process.env.LLM_MAX_RETRIES = '2';
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(errorResponse(401));
    }) as unknown as typeof fetch;

    const error = await captureError(() => chat(messages));
    expect(error.kind).toBe('auth');
    expect(error.retryable).toBe(false);
    expect(calls).toBe(1);
  });

  it('网络错误重试成功后返回', async () => {
    useAnthropic();
    process.env.LLM_MAX_RETRIES = '1';
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('fetch failed');
        error.name = 'TypeError';
        return Promise.reject(error);
      }
      return Promise.resolve(anthropicOk('ok-after-retry'));
    }) as unknown as typeof fetch;

    await expect(chat(messages)).resolves.toBe('ok-after-retry');
    expect(calls).toBe(2);
  });

  it('降级返回兜底文案并标记 degraded', async () => {
    useAnthropic();
    process.env.LLM_TIMEOUT_MS = '5';
    process.env.LLM_MAX_RETRIES = '0';
    globalThis.fetch = mock(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation timed out.');
            error.name = 'TimeoutError';
            reject(error);
          });
        })
    ) as unknown as typeof fetch;

    const result = await chatWithFallback(messages, 'fallback-text');
    expect(result.degraded).toBe(true);
    expect(result.text).toBe('fallback-text');
    expect(result.error).toContain('timed out');
  });

  it('API key 缺失属于配置错误，降级不吞、必须抛出', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = mock(() => Promise.resolve(anthropicOk('never'))) as unknown as typeof fetch;

    await expect(chatWithFallback(messages, 'fallback')).rejects.toThrow(
      'ANTHROPIC_API_KEY is not set'
    );
  });

  it('JSON 解析失败抛 parse 错误且不可重试', async () => {
    useAnthropic();
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('not json at all', { status: 200 }))
    ) as unknown as typeof fetch;

    const error = await captureError(() => chatJson(messages, { maxRetries: 0 }));
    expect(error.kind).toBe('parse');
    expect(error.retryable).toBe(false);
  });

  it('chatJson 正常解析并剥离 markdown 代码围栏', async () => {
    useAnthropic();
    globalThis.fetch = mock(() =>
      Promise.resolve(anthropicOk('```json\n{"a":1}\n```'))
    ) as unknown as typeof fetch;

    await expect(chatJson<{ a: number }>(messages)).resolves.toEqual({ a: 1 });
  });
});
