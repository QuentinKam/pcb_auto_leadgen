import { CircuitBreaker } from './circuit-breaker.ts';
import { DomainThrottle } from './throttle.ts';

/**
 * 统一 HTTP 客户端：超时 + UA 轮换 + 按域名限流 + 失败熔断 + 重试退避 + 代理。
 * - 429 / 5xx：按 Retry-After（秒）或指数退避重试
 * - 其他 4xx：直接抛错
 * - 网络异常：按退避重试
 */
const USER_AGENTS: [string, ...string[]] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
];

const DEFAULT_USER_AGENT = USER_AGENTS[0];

export interface FetcherInit extends RequestInit {
  proxy?: string;
}

export type Fetcher = (url: string, init: FetcherInit) => Promise<Response>;

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Headers
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly key: string) {
    super(`Circuit open for "${key}", request skipped`);
    this.name = 'CircuitOpenError';
  }
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  /** 限流/熔断 key，默认取 URL host */
  throttleKey?: string;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface HttpClientOptions {
  fetcher?: Fetcher;
  throttle?: DomainThrottle;
  breaker?: CircuitBreaker;
  proxyUrl?: string | null;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  userAgents?: string[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class HttpClient {
  private readonly fetcher: Fetcher;
  private readonly throttle: DomainThrottle;
  private readonly breaker: CircuitBreaker;
  private readonly proxyUrl: string | null;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly userAgents: string[];
  private agentCursor = 0;

  constructor(options: HttpClientOptions = {}) {
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.throttle = options.throttle ?? new DomainThrottle({ minIntervalMs: 2000 });
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.proxyUrl = options.proxyUrl ?? null;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.userAgents = options.userAgents ?? USER_AGENTS;
  }

  async request<T>(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    return (await this.execute(url, options, readJson)) as HttpResponse<T>;
  }

  /** 读取文本响应（HTML / 非 JSON），沿用限流 / 熔断 / 重试 / 代理 */
  async text(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse<string>> {
    return (await this.execute(url, options, readText)) as HttpResponse<string>;
  }

  async json<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.request<T>(url, options);
    return response.data;
  }

  private async execute(
    url: string,
    options: HttpRequestOptions,
    read: (response: Response) => Promise<unknown>
  ): Promise<HttpResponse<unknown>> {
    const throttleKey = options.throttleKey ?? safeHost(url);
    const retries = options.retries ?? this.retries;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    if (this.breaker.isOpen(throttleKey)) {
      throw new CircuitOpenError(throttleKey);
    }

    let attempt = 0;
    for (;;) {
      await this.throttle.acquire(throttleKey);

      let response: Response;
      try {
        response = await this.send(url, options, timeoutMs);
      } catch (error) {
        this.breaker.recordFailure(throttleKey);
        if (attempt < retries) {
          await this.sleep(this.retryDelayMs(attempt));
          attempt += 1;
          continue;
        }
        throw error;
      }

      if (response.ok) {
        this.breaker.recordSuccess(throttleKey);
        const data = await read(response);
        return { status: response.status, data, headers: response.headers };
      }

      this.breaker.recordFailure(throttleKey);

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < retries) {
        await this.sleep(this.retryDelayMs(attempt, response.headers));
        attempt += 1;
        continue;
      }

      throw new HttpStatusError(
        response.status,
        `HTTP ${response.status} for ${url}`,
        response.headers
      );
    }
  }

  private async send(
    url: string,
    options: HttpRequestOptions,
    timeoutMs: number
  ): Promise<Response> {
    const headers = new Headers(options.headers ?? {});
    if (!headers.has('user-agent')) headers.set('user-agent', this.pickUserAgent());
    if (!headers.has('accept')) headers.set('accept', 'application/json');

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const init: FetcherInit = {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (this.proxyUrl) init.proxy = this.proxyUrl;
    return this.fetcher(url, init);
  }

  private pickUserAgent(): string {
    const agent = this.userAgents[this.agentCursor % this.userAgents.length] ?? DEFAULT_USER_AGENT;
    this.agentCursor += 1;
    return agent;
  }

  private retryDelayMs(attempt: number, headers?: Headers): number {
    const retryAfter = headers?.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 60_000);
      }
    }
    const base = 1000 * 2 ** attempt;
    return Math.min(base + Math.floor(this.random() * 250), 60_000);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function readText(response: Response): Promise<string> {
  return response.text();
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
}
