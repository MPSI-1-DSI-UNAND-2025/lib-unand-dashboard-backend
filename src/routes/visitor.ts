import type { FastifyInstance } from 'fastify';
import { redis, CACHE_KEYS, getJSON, setJSON } from '../cache/redisClient.js';
import { getTodayCount, getDailyCountsThisWeek, getMonthlyTotalsLastYear, getYearlyTotalsLast5Years, getCurrentMonthTopVisitors, getCurrentYearTopVisitors } from '../services/visitorService.js';
import { visitorEvents } from '../events/visitorEvents.js';

function sortMonthlyDesc(months: { month: string; total: number }[]): { month: string; total: number }[] {
  return [...months].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}

function sortYearlyDesc(years: { year: number; total: number }[]): { year: number; total: number }[] {
  return [...years].sort((a, b) => b.year - a.year);
}

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

  // SSE stream for real-time today count
  fastify.get('/api/visitors/today/stream', {
    schema: {
      summary: 'SSE stream: real-time today visitor count',
      tags: ['Visitors'],
      description: 'Server-Sent Events stream pushing updates whenever today\'s visitor count updates (fast loop).',
      response: {
        200: {
          description: 'SSE stream (text/event-stream)',
          type: 'string'
        }
      }
    }
  }, async (req, reply) => {
    // Setup SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    // For proxies (optional) disable buffering
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    // Flush headers
    // @ts-ignore
    reply.raw.flushHeaders && reply.raw.flushHeaders();

    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial value
    try {
      const cached = await redis.get(CACHE_KEYS.TODAY_COUNT);
      if (cached) {
        send('init', { total: Number(cached), source: 'cache', at: new Date().toISOString() });
      } else {
        const total = await getTodayCount();
        // short TTL just for initial fetch fallback
        await redis.set(CACHE_KEYS.TODAY_COUNT, String(total), 'EX', 30);
        send('init', { total, source: 'db', at: new Date().toISOString() });
      }
    } catch (e: any) {
      send('error', { message: 'Failed to load initial today count', error: e.message });
    }

    const listener = (payload: any) => {
      send('update', payload);
    };
    visitorEvents.on('today', listener);

    // Heartbeat every 15s to keep connection alive (comment lines with colon are ignored by SSE clients)
    const heartbeat = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      visitorEvents.off('today', listener);
    };
    req.raw.on('close', cleanup);
    req.raw.on('end', cleanup);

    return reply; // keep connection open
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
    const cachedMeta = await getJSON<any>(CACHE_KEYS.WEEK_DAILY);
    if (cachedMeta) {
      return reply.send({ days: cachedMeta.data, generated_at: cachedMeta.generated_at, ttl_seconds: cachedMeta.ttl_seconds, source: 'cache' });
    }
    return reply.status(202).send({ status: 'warming', message: 'weekly cache not ready', retry_after_seconds: 5 });
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
    const cachedMeta = await getJSON<any>(CACHE_KEYS.MONTHLY_TOTALS);
    if (cachedMeta) {
      return reply.send({ months: sortMonthlyDesc(cachedMeta.data), generated_at: cachedMeta.generated_at, ttl_seconds: cachedMeta.ttl_seconds, source: 'cache' });
    }
    return reply.status(202).send({ status: 'warming', message: 'monthly cache not ready', retry_after_seconds: 5 });
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
    const cachedMeta = await getJSON<any>(CACHE_KEYS.YEARLY_TOTALS);
    if (cachedMeta) {
      return reply.send({ years: sortYearlyDesc(cachedMeta.data), generated_at: cachedMeta.generated_at, ttl_seconds: cachedMeta.ttl_seconds, source: 'cache' });
    }
    return reply.status(202).send({ status: 'warming', message: 'yearly cache not ready', retry_after_seconds: 5 });
  });

  // Monthly top visitors (current month top 10)
  fastify.get('/api/visitors/monthly/top', {
    schema: {
      summary: 'Get top 10 visitors for current month',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            month: { type: 'string' },
            visitors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  member_id: { type: ['string', 'null'] },
                  member_name: { type: ['string', 'null'] },
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
    const currentMonth = new Date().toISOString().slice(0,7);
    const cachedMeta = await getJSON<any>(CACHE_KEYS.TOP_MONTH_VISITORS);
    if (cachedMeta) {
      const rows = cachedMeta.data;
      if (rows.length > 0 && rows[0].month === currentMonth) {
        return reply.send({ month: rows[0].month, visitors: rows.map((r: any) => ({ member_id: r.member_id, member_name: r.member_name, total: r.total })), generated_at: cachedMeta.generated_at, ttl_seconds: cachedMeta.ttl_seconds, source: 'cache' });
      }
    }
    return reply.status(202).send({ status: 'warming', month: currentMonth, message: 'top month cache not ready', retry_after_seconds: 5 });
  });

  // Yearly top visitors (current year top 10)
  fastify.get('/api/visitors/yearly/top', {
    schema: {
      summary: 'Get top 10 visitors for current year',
      tags: ['Visitors'],
      response: {
        200: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            visitors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  member_id: { type: ['string', 'null'] },
                  member_name: { type: ['string', 'null'] },
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
    const currentYear = new Date().getFullYear();
    const cachedMeta = await getJSON<any>(CACHE_KEYS.TOP_YEAR_VISITORS);
    if (cachedMeta) {
      const rows = cachedMeta.data;
      if (rows.length > 0 && rows[0].year === currentYear) {
        return reply.send({ year: rows[0].year, visitors: rows.map((r: any) => ({ member_id: r.member_id, member_name: r.member_name, total: r.total })), generated_at: cachedMeta.generated_at, ttl_seconds: cachedMeta.ttl_seconds, source: 'cache' });
      }
    }
    return reply.status(202).send({ status: 'warming', year: currentYear, message: 'top year cache not ready', retry_after_seconds: 5 });
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
            top_monthly_visitors: { type: 'array', items: { type: 'object', properties: { month: { type: 'string' }, member_id: { type: ['string', 'null'] }, member_name: { type: ['string', 'null'] }, total: { type: 'number' } } } },
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
    // Provide minimal today only (real-time) and instruct warming for aggregates
    const todayRaw = await redis.get(CACHE_KEYS.TODAY_COUNT);
    let today: number;
    if (todayRaw) {
      today = Number(todayRaw);
    } else {
      today = await getTodayCount();
      await redis.set(CACHE_KEYS.TODAY_COUNT, String(today), 'EX', 30);
    }
    return reply.status(202).send({ status: 'warming', today, message: 'summary cache not ready', retry_after_seconds: 5 });
  });
}
