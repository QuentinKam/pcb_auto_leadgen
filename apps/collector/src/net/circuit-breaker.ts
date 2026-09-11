/**
 * 失败熔断：连续 N 次 4xx/5xx（或网络错误）→ 冷却 M 毫秒。
 * 冷却结束后删除状态（半开），放行下一次探测请求。
 */
export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, BreakerState>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  isOpen(key: string): boolean {
    const state = this.states.get(key);
    if (!state || state.openedAt === null) return false;
    if (this.now() - state.openedAt >= this.cooldownMs) {
      this.states.delete(key);
      return false;
    }
    return true;
  }

  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  recordFailure(key: string): void {
    const state = this.states.get(key) ?? { failures: 0, openedAt: null };
    state.failures += 1;
    if (state.failures >= this.failureThreshold) {
      state.openedAt = this.now();
    }
    this.states.set(key, state);
  }

  /** 当前连续失败次数（测试用） */
  failureCount(key: string): number {
    return this.states.get(key)?.failures ?? 0;
  }
}
