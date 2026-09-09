import { redis } from './redis.ts';

const MAX_DAILY_SENDS_PER_DOMAIN = Number(process.env.MAX_DAILY_SENDS_PER_DOMAIN ?? 500);
const MAX_DAILY_SENDS_PER_FROM_EMAIL = Number(process.env.MAX_DAILY_SENDS_PER_FROM_EMAIL ?? 50);

type DateKey = string;

function todayKey(): DateKey {
  return new Date().toISOString().slice(0, 10);
}

function domainKey(tenantId: string, domain: string): string {
  return `pcb:mailer:quota:domain:${tenantId}:${domain}:${todayKey()}`;
}

function fromEmailKey(tenantId: string, fromEmail: string): string {
  return `pcb:mailer:quota:from:${tenantId}:${fromEmail.toLowerCase()}:${todayKey()}`;
}

const inMemoryCounters = new Map<string, number>();

async function incrementAndGet(
  key: string,
  max: number
): Promise<{ count: number; allowed: boolean }> {
  try {
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.expire(key, 60 * 60 * 48);
    const result = await pipe.exec();
    let count = 0;
    if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0])) {
      const firstRow = result[0] as unknown[];
      if (firstRow.length >= 2 && firstRow[0] == null) {
        count = Number(firstRow[1] ?? 0);
      }
    }
    return { count, allowed: count > 0 ? count <= max : false };
  } catch (err) {
    const inMemCount = (inMemoryCounters.get(key) ?? 0) + 1;
    inMemoryCounters.set(key, inMemCount);
    return { count: inMemCount, allowed: inMemCount <= max };
  }
}

export async function checkAndConsumeDomainQuota(
  tenantId: string,
  domain: string
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const key = domainKey(tenantId, domain);
  const { count, allowed } = await incrementAndGet(key, MAX_DAILY_SENDS_PER_DOMAIN);
  return { allowed, count, limit: MAX_DAILY_SENDS_PER_DOMAIN };
}

export async function checkAndConsumeFromEmailQuota(
  tenantId: string,
  fromEmail: string
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const key = fromEmailKey(tenantId, fromEmail);
  const { count, allowed } = await incrementAndGet(key, MAX_DAILY_SENDS_PER_FROM_EMAIL);
  return { allowed, count, limit: MAX_DAILY_SENDS_PER_FROM_EMAIL };
}

export async function rollbackQuota(
  tenantId: string,
  domain: string,
  fromEmail: string
): Promise<void> {
  try {
    const pipe = redis.pipeline();
    pipe.decr(domainKey(tenantId, domain));
    pipe.decr(fromEmailKey(tenantId, fromEmail));
    await pipe.exec();
  } catch (err) {
    const dk = domainKey(tenantId, domain);
    const fk = fromEmailKey(tenantId, fromEmail);
    inMemoryCounters.set(dk, Math.max(0, (inMemoryCounters.get(dk) ?? 0) - 1));
    inMemoryCounters.set(fk, Math.max(0, (inMemoryCounters.get(fk) ?? 0) - 1));
  }
}

export const QUOTA_LIMITS = {
  MAX_DAILY_SENDS_PER_DOMAIN,
  MAX_DAILY_SENDS_PER_FROM_EMAIL,
};
