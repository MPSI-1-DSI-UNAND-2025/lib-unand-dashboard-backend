import type { FastifyInstance } from 'fastify';
import { redis, CACHE_KEYS, getJSON, setJSON } from '../cache/redisClient.js';
import { getTodayCount, getDailyCountsThisWeek, getMonthlyTotalsLastYear, getYearlyTotalsLast5Years } from '../services/visitorService.js';

export async function visitorRoutes(fastify: FastifyInstance) {
  fastify.get('/api/visitors/today', {
    schema: {
      summary: 'Get today\'s visitor count',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    // Try cache first
    const cached = await redis.get(CACHE_KEYS.TODAY_COUNT);
    if (cached) {
      return reply.send({ total: Number(cached), source: 'cache' });
    }
    const total = await getTodayCount();
    await redis.set(CACHE_KEYS.TODAY_COUNT, String(total), 'EX', 60);
    return reply.send({ total, source: 'db' });
  });

  // Removed /api/visitors/latest and /api/visitors/trend per requirement simplification.

  // Weekly (7-day daily counts)
  fastify.get('/api/visitors/weekly', {
    schema: {
      summary: 'Get last 7 days daily counts',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            days: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string' },
                  total: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const cached = await getJSON<any[]>(CACHE_KEYS.WEEK_DAILY);
    if (cached) {
      return reply.send({ days: cached, source: 'cache' });
    }
    const days = await getDailyCountsThisWeek();
    await setJSON(CACHE_KEYS.WEEK_DAILY, days, 86400); // 1 day TTL
    return reply.send({ days, source: 'db' });
  });

  // Monthly (12 months)
  fastify.get('/api/visitors/monthly', {
    schema: {
      summary: 'Get last 12 months totals',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            months: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  month: { type: 'string' },
                  total: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const cached = await getJSON<any[]>(CACHE_KEYS.MONTHLY_TOTALS);
    if (cached) {
      return reply.send({ months: cached, source: 'cache' });
    }
    const months = await getMonthlyTotalsLastYear();
    await setJSON(CACHE_KEYS.MONTHLY_TOTALS, months, 86400);
    return reply.send({ months, source: 'db' });
  });

  // Yearly (last 5 years including current)
  fastify.get('/api/visitors/yearly', {
    schema: {
      summary: 'Get yearly totals (last 5 years)',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            years: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  year: { type: 'number' },
                  total: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const cached = await getJSON<any[]>(CACHE_KEYS.YEARLY_TOTALS);
    if (cached) {
      return reply.send({ years: cached, source: 'cache' });
    }
    const years = await getYearlyTotalsLast5Years();
    // Long TTL (7 days) set also in cron
    await setJSON(CACHE_KEYS.YEARLY_TOTALS, years, 86400 * 7);
    return reply.send({ years, source: 'db' });
  });

  // Summary endpoint: bundles today, weekly, monthly into one response
  fastify.get('/api/visitors/summary', {
    schema: {
      summary: 'Get combined visitor metrics',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            today: { type: 'number' },
            weekly: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, total: { type: 'number' } } } },
            monthly: { type: 'array', items: { type: 'object', properties: { month: { type: 'string' }, total: { type: 'number' } } } },
            yearly: { type: 'array', items: { type: 'object', properties: { year: { type: 'number' }, total: { type: 'number' } } } },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    // Try summary cache first
    const summaryCached = await getJSON<any>(CACHE_KEYS.SUMMARY);
    if (summaryCached) {
      return reply.send({ ...summaryCached, source: 'cache' });
    }

    // Parallel attempt: read component caches
    const [todayRaw, weekCached, monthCached, yearCached] = await Promise.all([
      redis.get(CACHE_KEYS.TODAY_COUNT),
      getJSON<any[]>(CACHE_KEYS.WEEK_DAILY),
      getJSON<any[]>(CACHE_KEYS.MONTHLY_TOTALS),
      getJSON<any[]>(CACHE_KEYS.YEARLY_TOTALS)
    ]);

    let sourceParts: string[] = [];
    let today: number;
    if (todayRaw) {
      today = Number(todayRaw);
      sourceParts.push('today:cache');
    } else {
      today = await getTodayCount();
      await redis.set(CACHE_KEYS.TODAY_COUNT, String(today), 'EX', 60);
      sourceParts.push('today:db');
    }

    let weekly: any[];
    if (weekCached) {
      weekly = weekCached;
      sourceParts.push('weekly:cache');
    } else {
      weekly = await getDailyCountsThisWeek();
      await setJSON(CACHE_KEYS.WEEK_DAILY, weekly, 86400);
      sourceParts.push('weekly:db');
    }

    let monthly: any[];
    if (monthCached) {
      monthly = monthCached;
      sourceParts.push('monthly:cache');
    } else {
      monthly = await getMonthlyTotalsLastYear();
      await setJSON(CACHE_KEYS.MONTHLY_TOTALS, monthly, 86400);
      sourceParts.push('monthly:db');
    }

    let yearly: any[];
    if (yearCached) {
      yearly = yearCached;
      sourceParts.push('yearly:cache');
    } else {
      yearly = await getYearlyTotalsLast5Years();
      await setJSON(CACHE_KEYS.YEARLY_TOTALS, yearly, 86400 * 7);
      sourceParts.push('yearly:db');
    }

    const payload = { today, weekly, monthly, yearly };
    // Cache summary for short period (e.g. 15s) since today can change fast
    await setJSON(CACHE_KEYS.SUMMARY, payload, 15);
    return reply.send({ ...payload, source: sourceParts.join(',') });
  });
}
