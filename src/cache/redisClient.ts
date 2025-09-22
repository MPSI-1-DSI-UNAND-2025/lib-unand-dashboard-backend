import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL;

// ioredis types (ESM) sometimes require casting when using constructor with object literal in TS + NodeNext
export const redis = new (Redis as any)(
  redisUrl || {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  }
);

redis.on('connect', () => {
  console.log('[redis] connected');
});

redis.on('error', (err: unknown) => {
  console.error('[redis] error', err);
});

export const CACHE_KEYS = {
  TODAY_COUNT: 'visitors:today:count',
  WEEK_DAILY: 'visitors:week:daily',
  MONTHLY_TOTALS: 'visitors:month:totals',
  YEARLY_TOTALS: 'visitors:year:totals',
  SUMMARY: 'visitors:summary'
} as const;

export async function setJSON(key: string, value: unknown, ttlSeconds?: number) {
  const payload = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, payload, 'EX', ttlSeconds);
  } else {
    await redis.set(key, payload);
  }
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[redis] failed parse JSON for key ${key}`);
    return null;
  }
}
