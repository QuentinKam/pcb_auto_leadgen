import { describe, expect, test } from 'bun:test';
import { HttpClient } from '../../net/http.ts';
import { DomainThrottle } from '../../net/throttle.ts';
import { DuckDuckGoSearchClient } from './duckduckgo.ts';

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvolterra-robotics.example%2Fabout&amp;rut=abc123">Volterra Robotics</a>
    </h2>
    <a class="result__snippet">Autonomous mobile robots for cold-chain logistics.</a>
  </div>
</div>
<div class="result">
  <div class="result__body">
    <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme-hardware.example">ACME Hardware</a></h2>
    <a class="result__snippet">Industrial controllers and IoT sensors.</a>
  </div>
</div>
`;

function createClient(fetcher: (url: string, init: RequestInit) => Promise<Response>) {
  const http = new HttpClient({
    fetcher,
    throttle: new DomainThrottle({ minIntervalMs: 0 }),
    retries: 0,
  });
  return new DuckDuckGoSearchClient({ http });
}

describe('DuckDuckGoSearchClient', () => {
  test('解析 HTML 结果并解码 uddg 重定向链接', async () => {
    let requestedUrl = '';
    const client = createClient(async (url) => {
      requestedUrl = url;
      return new Response(DDG_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    const hits = await client.search({ keyword: 'robotics pcb', country: 'de', count: 10 });

    expect(requestedUrl).toContain('q=robotics+pcb');
    expect(requestedUrl).toContain('kl=de-en');

    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      title: 'Volterra Robotics',
      url: 'https://volterra-robotics.example/about',
      snippet: 'Autonomous mobile robots for cold-chain logistics.',
      provider: 'duckduckgo',
    });
    expect(hits[1]!.url).toBe('https://acme-hardware.example');
  });

  test('count 超限时被裁剪到 20', async () => {
    let requestedUrl = '';
    const client = createClient(async (url) => {
      requestedUrl = url;
      return new Response('<html></html>', { status: 200 });
    });

    await client.search({ keyword: 'x', count: 999 });
    expect(requestedUrl).toContain('q=x');
    expect((await client.search({ keyword: 'y', count: 999 })).length).toBe(0);
  });

  test('空 HTML 返回空数组', async () => {
    const client = createClient(async () => new Response('<html><body></body></html>', { status: 200 }));
    expect(await client.search({ keyword: 'x' })).toEqual([]);
  });
});
