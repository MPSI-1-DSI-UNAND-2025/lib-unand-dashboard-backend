import type { FastifyInstance } from 'fastify';
import { redis, CACHE_KEYS } from '../cache/redisClient.js';
import { CRON_SCHEDULES, REALTIME } from '../cron/schedules.js';
import { sequelize } from '../db/sequelize.js';

// We'll track minimal loop runtime stats by monkey patching global vars via an optional import.
// For now, we expose only configuration + cache ages.

interface CacheAgeInfo {
  key: string;
  exists: boolean;
  ttl_seconds: number | null;
}

async function getKeyTTL(key: string): Promise<CacheAgeInfo> {
  const ttl = await redis.ttl(key); // -2 = no key, -1 = no expire
  if (ttl === -2) return { key, exists: false, ttl_seconds: null };
  return { key, exists: true, ttl_seconds: ttl >= 0 ? ttl : null };
}

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', {
    schema: {
      summary: 'Basic service health',
      tags: ['Health']
    }
  }, async (_req, reply) => {
  const startedAt = (fastify as any).startTime as number | undefined;
    const uptimeMs = startedAt ? Date.now() - startedAt : null;
    let mysqlOk = false;
    try {
      if (sequelize) await sequelize.authenticate();
      mysqlOk = true;
    } catch (_) {
      mysqlOk = false;
    }
    let redisOk = true;
    try {
      await redis.ping();
    } catch (_) {
      redisOk = false;
    }

    const cacheKeys = [
      CACHE_KEYS.TODAY_COUNT,
      CACHE_KEYS.WEEK_DAILY,
      CACHE_KEYS.MONTHLY_TOTALS,
      CACHE_KEYS.YEARLY_TOTALS,
      CACHE_KEYS.TOP_MONTH_VISITORS,
      CACHE_KEYS.TOP_YEAR_VISITORS,
      CACHE_KEYS.SUMMARY,
      CACHE_KEYS.BOOK_COLLECTION_STATS,
      CACHE_KEYS.BOOK_TOP_BORROWED,
      CACHE_KEYS.BOOK_TOP_BORROWED_MONTH,
      CACHE_KEYS.BOOK_TOP_BORROWED_YEAR,
      CACHE_KEYS.BOOK_TOP_BORROWERS_MONTH,
      CACHE_KEYS.BOOK_TOP_BORROWERS_YEAR,
      CACHE_KEYS.BOOK_SUMMARY
    ];
    const ttlList = await Promise.all(cacheKeys.map(getKeyTTL));

    return reply.send({
      service: 'library-dashboard-backend',
      status: (mysqlOk && redisOk) ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      uptime_ms: uptimeMs,
      dependencies: {
        mysql: mysqlOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down'
      },
      fast_loop: {
        configured_min_interval_ms: REALTIME.VISITOR_FAST_MIN_INTERVAL_MS,
        buffer_ms: REALTIME.VISITOR_FAST_BUFFER_MS,
        adaptive_enabled: process.env.VISITOR_FAST_ADAPTIVE === 'true',
        target_multiplier: Number(process.env.VISITOR_FAST_TARGET_MULTIPLIER || 20),
        soft_floor_ms: Number(process.env.VISITOR_FAST_SOFT_FLOOR_MS || 400),
        hard_floor_ms: Number(process.env.VISITOR_FAST_HARD_FLOOR_MS || 150),
        mode: process.env.TODAY_COUNT_MODE || 'direct'
      },
      schedules: {
        visitor_daily: CRON_SCHEDULES.VISITOR_AGGREGATION,
        books_daily: CRON_SCHEDULES.BOOKS_AGGREGATION
      },
      cache: ttlList
    });
  });
}
