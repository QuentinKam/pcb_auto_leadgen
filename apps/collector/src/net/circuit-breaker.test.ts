import { describe, expect, test } from 'bun:test';
import { CircuitBreaker } from './circuit-breaker.ts';

describe('CircuitBreaker', () => {
  test('连续 5 次失败后熔断，冷却 10 分钟后恢复', () => {
    let current = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 10 * 60_000,
      now: () => current,
    });

    for (let i = 0; i < 4; i += 1) breaker.recordFailure('acme.com');
    expect(breaker.isOpen('acme.com')).toBe(false);

    breaker.recordFailure('acme.com');
    expect(breaker.failureCount('acme.com')).toBe(5);
    expect(breaker.isOpen('acme.com')).toBe(true);

    current += 9 * 60_000;
    expect(breaker.isOpen('acme.com')).toBe(true);

    current += 61_000;
    expect(breaker.isOpen('acme.com')).toBe(false);
  });

  test('成功一次即清零失败计数', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    breaker.recordFailure('acme.com');
    breaker.recordFailure('acme.com');
    breaker.recordSuccess('acme.com');

    expect(breaker.failureCount('acme.com')).toBe(0);
    expect(breaker.isOpen('acme.com')).toBe(false);
  });

  test('不同 key 状态隔离', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });
    breaker.recordFailure('acme.com');
    breaker.recordFailure('acme.com');

    expect(breaker.isOpen('acme.com')).toBe(true);
    expect(breaker.isOpen('globex.com')).toBe(false);
  });
});
