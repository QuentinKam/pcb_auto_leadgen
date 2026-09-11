/**
 * 按 key（通常是企业域名）串行 + 最小间隔限流。
 * - 同一 key 的请求排队串行执行（对应「每域名并发 = 1」）
 * - 相邻两次请求间隔 >= minIntervalMs（对应「请求间隔 ≥2s」）
 * - 不同 key 互不阻塞
 */
export interface ThrottleOptions {
  minIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class DomainThrottle {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lastAt = new Map<string, number>();
  private readonly chains = new Map<string, Promise<void>>();
  private waitCount = 0;

  constructor(options: ThrottleOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** 需要等待的次数（测试「限流计数」用） */
  get throttledCount(): number {
    return this.waitCount;
  }

  /**
   * 注意：此处不能声明为 async，否则返回值会多包一层 promise，
   * 调用方观测到的完成时间会滞后一个节流周期。
   */
  acquire(key: string): Promise<void> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(() => this.gate(key));
    // 链上错误不阻塞后续请求
    this.chains.set(
      key,
      next.catch(() => undefined)
    );
    return next;
  }

  private async gate(key: string): Promise<void> {
    const last = this.lastAt.get(key);
    if (last !== undefined) {
      const waitMs = last + this.minIntervalMs - this.now();
      if (waitMs > 0) {
        this.waitCount += 1;
        await this.sleep(waitMs);
      }
    }
    this.lastAt.set(key, this.now());
  }
}
