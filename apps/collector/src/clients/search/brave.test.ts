import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../../net/http.ts';
import { DomainThrottle } from '../../net/throttle.ts';
import { BraveSearchClient } from './brave.ts';

const BRAVE_PAYLOAD = {
  web: {
    results: [
      {
        title: 'Volterra Robotics - Home',
        url: 'https://volterra-robotics.example/about',
        description: 'Autonomous mobile robots for cold-chain logistics.',
      },
      { title: 'No URL result' },
    ],
  },
};

function createClient(fetcher: (url: string, init: RequestInit) => Promise<Response>) {
  const http = new HttpClient({
    fetcher,
    throttle: new DomainThrottle({ minIntervalMs: 0 }),
    retries: 0,
  });
  return new BraveSearchClient({ apiKey: 'test-key', http });
}

describe('BraveSearchClient', () => {
  test('解析结果并回读限流剩余额度', async () => {
    let requestedUrl = '';
    const captured: { token: string | null } = { token: null };

    const client = createClient(async (url, init) => {
      requestedUrl = url;
      captured.token = new Headers(init.headers).get('x-subscription-token');
      return new Response(JSON.stringify(BRAVE_PAYLOAD), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '17' },
      });
    });

    const hits = await client.search({
      keyword: 'robotics pcb',
      country: 'de',
      count: 5,
      offset: 2,
    });

    expect(captured.token).toBe('test-key');
    expect(requestedUrl).toContain('q=robotics+pcb');
    expect(requestedUrl).toContain('country=de');
    expect(requestedUrl).toContain('count=5');
    expect(requestedUrl).toContain('offset=2');

    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      title: 'Volterra Robotics - Home',
      url: 'https://volterra-robotics.example/about',
      snippet: 'Autonomous mobile robots for cold-chain logistics.',
      provider: 'brave',
    });
    expect(client.remainingQuota).toBe(17);
  });

  test('count 与 offset 超限时被裁剪到合法区间', async () => {
    let requestedUrl = '';
    const client = createClient(async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    });

    await client.search({ keyword: 'x', count: 999, offset: 99 });
    expect(requestedUrl).toContain('count=20');
    expect(requestedUrl).toContain('offset=9');
  });

  test('缺少 web 字段时返回空数组', async () => {
    const client = createClient(async () => new Response(JSON.stringify({}), { status: 200 }));
    expect(await client.search({ keyword: 'x' })).toEqual([]);
  });
});
