import { describe, expect, test } from 'bun:test';
import { CircuitBreaker } from './circuit-breaker.ts';
import { CircuitOpenError, type Fetcher, HttpClient, HttpStatusError } from './http.ts';
import { DomainThrottle } from './throttle.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function createClient(
  fetcher: Fetcher,
  overrides: { retries?: number; breaker?: CircuitBreaker } = {}
) {
  const delays: number[] = [];
  const client = new HttpClient({
    fetcher,
    throttle: new DomainThrottle({ minIntervalMs: 0 }),
    breaker: overrides.breaker ?? new CircuitBreaker(),
    retries: overrides.retries ?? 2,
    random: () => 0,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { client, delays };
}

describe('HttpClient 重试退避', () => {
  test('429 按 Retry-After 退避后重试成功', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      if (calls <= 2) return json({ error: 'slow down' }, 429, { 'retry-after': '1' });
      return json({ value: 42 });
    };

    const { client, delays } = createClient(fetcher);
    const result = await client.json<{ value: number }>('https://api.example.com/search');

    expect(result.value).toBe(42);
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 1000]);
  });

  test('5xx 走指数退避', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return json({ error: 'boom' }, 503);
    };

    const { client, delays } = createClient(fetcher);
    await expect(client.request('https://api.example.com/search')).rejects.toBeInstanceOf(
      HttpStatusError
    );

    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  test('4xx（非 429）不重试', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return json({ error: 'nope' }, 404);
    };

    const { client } = createClient(fetcher);
    await expect(client.request('https://api.example.com/search')).rejects.toBeInstanceOf(
      HttpStatusError
    );
    expect(calls).toBe(1);
  });

  test('熔断打开后直接跳过请求', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      throw new Error('network down');
    };
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10 * 60_000 });

    const { client } = createClient(fetcher, { retries: 0, breaker });
    await expect(client.request('https://api.example.com/search')).rejects.toThrow('network down');
    expect(breaker.isOpen('api.example.com')).toBe(true);

    await expect(client.request('https://api.example.com/search')).rejects.toBeInstanceOf(
      CircuitOpenError
    );
    expect(calls).toBe(1);
  });
});
