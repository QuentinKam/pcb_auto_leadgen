import { describe, expect, test } from 'bun:test';
import { DomainThrottle } from './throttle.ts';

/** 可控时钟：sleep 只推进时间，不真的等待 */
function createClock() {
  let current = 0;
  const waits: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      waits.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
    waits,
    time: () => current,
  };
}

describe('DomainThrottle', () => {
  test('同一 key 连续请求间隔不小于 minIntervalMs', async () => {
    const clock = createClock();
    const throttle = new DomainThrottle({
      minIntervalMs: 2000,
      now: clock.now,
      sleep: clock.sleep,
    });

    await throttle.acquire('acme.com');
    const first = clock.time();
    await throttle.acquire('acme.com');
    const second = clock.time();
    await throttle.acquire('acme.com');
    const third = clock.time();

    expect([first, second, third]).toEqual([0, 2000, 4000]);
    expect(throttle.throttledCount).toBe(2);
    expect(clock.waits).toEqual([2000, 2000]);
  });

  test('不同 key 互不阻塞', async () => {
    const clock = createClock();
    const throttle = new DomainThrottle({
      minIntervalMs: 2000,
      now: clock.now,
      sleep: clock.sleep,
    });

    await throttle.acquire('acme.com');
    await throttle.acquire('globex.com');
    await throttle.acquire('initech.com');

    expect(clock.time()).toBe(0);
    expect(throttle.throttledCount).toBe(0);
  });

  test('并发请求被串行化（每域名并发 = 1）', async () => {
    const clock = createClock();
    const throttle = new DomainThrottle({
      minIntervalMs: 2000,
      now: clock.now,
      sleep: clock.sleep,
    });
    const order: number[] = [];

    await Promise.all([
      throttle.acquire('acme.com').then(() => order.push(clock.time())),
      throttle.acquire('acme.com').then(() => order.push(clock.time())),
      throttle.acquire('acme.com').then(() => order.push(clock.time())),
    ]);

    expect(order).toEqual([0, 2000, 4000]);
  });
});
