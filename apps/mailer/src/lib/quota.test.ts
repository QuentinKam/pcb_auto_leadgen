import { describe, expect, test } from 'bun:test';
import {
  checkAndConsumeDomainQuota,
  checkAndConsumeFromEmailQuota,
  rollbackQuota,
} from './quota.ts';

// 用随机 tenant/from 避免污染真实配额计数器
const tenantId = crypto.randomUUID();
const domain = 'test-quota.local';
const fromEmail = `quota-test-${Date.now()}@${domain}`;

describe('quota 计数器', () => {
  test('回滚导致计数器为负后，INCR 回 0 也应判定 allowed=true', async () => {
    await rollbackQuota(tenantId, domain, fromEmail);
    await rollbackQuota(tenantId, domain, fromEmail);

    const domainQuota = await checkAndConsumeDomainQuota(tenantId, domain);
    expect(domainQuota.count).toBe(-1);
    expect(domainQuota.allowed).toBe(true);

    const fromQuota = await checkAndConsumeFromEmailQuota(tenantId, fromEmail);
    expect(fromQuota.allowed).toBe(true);
  });

  test('超过每日上限时应判定 allowed=false', async () => {
    const t = crypto.randomUUID();
    const f = `over-limit-${Date.now()}@${domain}`;
    const limit = Number(process.env.MAX_DAILY_SENDS_PER_FROM_EMAIL ?? 50);
    let last = { allowed: true, count: 0, limit };
    for (let i = 0; i < limit + 1; i++) {
      last = await checkAndConsumeFromEmailQuota(t, f);
    }
    expect(last.count).toBe(limit + 1);
    expect(last.allowed).toBe(false);
  });
});
