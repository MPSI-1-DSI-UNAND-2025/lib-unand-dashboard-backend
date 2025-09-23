import type { FastifyInstance } from 'fastify';
import { getBookCollectionStats, getTopBorrowedBooks, getTopBorrowedBooksThisMonth, getTopBorrowedBooksThisYear, getTopBorrowersThisMonth, getTopBorrowersThisYear } from '../services/bookService.js';
import { redis, CACHE_KEYS } from '../cache/redisClient.js';

export async function bookRoutes(fastify: FastifyInstance) {
  fastify.get('/api/books/stats/collection', {
    schema: {
      summary: 'Get total unique titles and total items (collections)',
      tags: ['Books'],
      response: {
        200: {
          type: 'object',
          properties: {
            total_unique_titles: { type: 'number' },
            total_items: { type: 'number' },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const cached = await redis.get(CACHE_KEYS.BOOK_COLLECTION_STATS);
    if (cached) {
      try { return reply.send({ ...JSON.parse(cached), source: 'cache' }); } catch {}
    }
    return reply.status(202).send({ status: 'warming', message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/top/borrowed', {
    schema: {
      summary: 'Get top 10 borrowed books (all time)',
      tags: ['Books'],
      response: {
        200: {
          type: 'object',
          properties: {
            books: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  biblio_id: { type: 'number' },
                  title: { type: 'string' },
                  total_loans: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const cacheKey = CACHE_KEYS.BOOK_TOP_BORROWED;
    const cached = await redis.get(cacheKey);
    if (cached) { try { return reply.send({ books: JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/top/borrowed/month', {
    schema: {
      summary: 'Get top 10 borrowed books (current month)',
      tags: ['Books'],
      response: {
        200: {
          type: 'object',
          properties: {
            period: { type: 'string' },
            books: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  biblio_id: { type: 'number' },
                  title: { type: 'string' },
                  total_loans: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const key = CACHE_KEYS.BOOK_TOP_BORROWED_MONTH;
    const cached = await redis.get(key);
    const ym = new Date();
    const period = `${ym.getFullYear()}-${String(ym.getMonth()+1).padStart(2,'0')}`;
    if (cached) { try { return reply.send({ period, books: JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', period, message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/top/borrowed/year', {
    schema: {
      summary: 'Get top 10 borrowed books (current year)',
      tags: ['Books'],
      response: {
        200: {
          type: 'object',
          properties: {
            year: { type: 'number' },
            books: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  biblio_id: { type: 'number' },
                  title: { type: 'string' },
                  total_loans: { type: 'number' }
                }
              }
            },
            source: { type: 'string' }
          }
        }
      }
    }
  }, async (_req, reply) => {
    const key = CACHE_KEYS.BOOK_TOP_BORROWED_YEAR;
    const cached = await redis.get(key);
    const y = new Date().getFullYear();
    if (cached) { try { return reply.send({ year: y, books: JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', year: y, message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/top/borrowers/month', {
    schema: {
      summary: 'Top 10 peminjam (member) bulan ini',
      tags: ['Books'],
      response: { 200: { type: 'object', properties: { period: { type: 'string' }, borrowers: { type: 'array', items: { type: 'object', properties: { member_id: { type: 'number' }, member_name: { type: 'string' }, total_loans: { type: 'number' } } } }, source: { type: 'string' } } } }
    }
  }, async (_req, reply) => {
    const key = CACHE_KEYS.BOOK_TOP_BORROWERS_MONTH;
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const cached = await redis.get(key);
    if (cached) { try { return reply.send({ period, borrowers: JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', period, message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/top/borrowers/year', {
    schema: {
      summary: 'Top 10 peminjam (member) tahun ini',
      tags: ['Books'],
      response: { 200: { type: 'object', properties: { year: { type: 'number' }, borrowers: { type: 'array', items: { type: 'object', properties: { member_id: { type: 'number' }, member_name: { type: 'string' }, total_loans: { type: 'number' } } } }, source: { type: 'string' } } } }
    }
  }, async (_req, reply) => {
    const key = CACHE_KEYS.BOOK_TOP_BORROWERS_YEAR;
    const year = new Date().getFullYear();
    const cached = await redis.get(key);
    if (cached) { try { return reply.send({ year, borrowers: JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', year, message: 'cache not ready', retry_after_seconds: 5 });
  });

  fastify.get('/api/books/summary', {
    schema: {
      summary: 'Ringkasan buku: koleksi, top borrowed (all/month/year), top borrowers (month/year)',
      tags: ['Books'],
      response: { 200: { type: 'object', properties: {
        period_month: { type: 'string' },
        year: { type: 'number' },
        collection: { type: 'object', properties: { total_unique_titles: { type: 'number' }, total_items: { type: 'number' } } },
        top_borrowed_all: { type: 'array', items: { type: 'object', properties: { biblio_id: { type: 'number' }, title: { type: 'string' }, total_loans: { type: 'number' } } } },
        top_borrowed_month: { type: 'array', items: { type: 'object', properties: { biblio_id: { type: 'number' }, title: { type: 'string' }, total_loans: { type: 'number' } } } },
        top_borrowed_year: { type: 'array', items: { type: 'object', properties: { biblio_id: { type: 'number' }, title: { type: 'string' }, total_loans: { type: 'number' } } } },
        top_borrowers_month: { type: 'array', items: { type: 'object', properties: { member_id: { type: 'number' }, member_name: { type: 'string' }, total_loans: { type: 'number' } } } },
        top_borrowers_year: { type: 'array', items: { type: 'object', properties: { member_id: { type: 'number' }, member_name: { type: 'string' }, total_loans: { type: 'number' } } } },
        source: { type: 'string' }
      } } }
    }
  }, async (_req, reply) => {
    const cacheKey = CACHE_KEYS.BOOK_SUMMARY;
    const cached = await redis.get(cacheKey);
    if (cached) { try { return reply.send({ ...JSON.parse(cached), source: 'cache' }); } catch {} }
    return reply.status(202).send({ status: 'warming', message: 'summary cache not ready', retry_after_seconds: 5 });
  });
}
