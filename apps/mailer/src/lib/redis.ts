import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

export async function ensureRedisConnected(): Promise<void> {
  try {
    await redis.ping();
  } catch (err) {
    console.warn('[mailer] Redis not connected, quota counters will fall back to in-memory:', err);
  }
}
