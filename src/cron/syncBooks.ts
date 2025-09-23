import cron from 'node-cron';
import { redis, CACHE_KEYS } from '../cache/redisClient.js';
import { getBookCollectionStats, getTopBorrowedBooks, getTopBorrowedBooksThisMonth, getTopBorrowedBooksThisYear, getTopBorrowersThisMonth, getTopBorrowersThisYear } from '../services/bookService.js';
import { CRON_SCHEDULES } from './schedules.js';

// Registers a daily job to refresh book collection statistics cache.
// Configurable via env BOOK_STATS_CRON (default: run at 00:10 every day)
export async function prewarmBookCaches() {
  try {
    const start = Date.now();
    const [stats, topBorrowedAll, topBorrowedMonth, topBorrowedYear, topBorrowersMonth, topBorrowersYear] = await Promise.all([
      getBookCollectionStats(),
      getTopBorrowedBooks(10),
      getTopBorrowedBooksThisMonth(10),
      getTopBorrowedBooksThisYear(10),
      getTopBorrowersThisMonth(10),
      getTopBorrowersThisYear(10)
    ]);
    await redis.set(CACHE_KEYS.BOOK_COLLECTION_STATS, JSON.stringify(stats), 'EX', 90000);
    await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED, JSON.stringify(topBorrowedAll), 'EX', 90000);
    await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED_MONTH, JSON.stringify(topBorrowedMonth), 'EX', 90000);
    await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED_YEAR, JSON.stringify(topBorrowedYear), 'EX', 90000);
    await redis.set(CACHE_KEYS.BOOK_TOP_BORROWERS_MONTH, JSON.stringify(topBorrowersMonth), 'EX', 90000);
    await redis.set(CACHE_KEYS.BOOK_TOP_BORROWERS_YEAR, JSON.stringify(topBorrowersYear), 'EX', 90000);
    const now = new Date();
    const summaryPayload = {
      generated_at: new Date().toISOString(),
      ttl_seconds: 90000,
      period_month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,
      year: now.getFullYear(),
      collection: stats,
      top_borrowed_all: topBorrowedAll,
      top_borrowed_month: topBorrowedMonth,
      top_borrowed_year: topBorrowedYear,
      top_borrowers_month: topBorrowersMonth,
      top_borrowers_year: topBorrowersYear
    };
    await redis.set(CACHE_KEYS.BOOK_SUMMARY, JSON.stringify(summaryPayload), 'EX', 90000);
    console.log(`[prewarm-books] done in ${Date.now() - start}ms`);
  } catch (e) {
    console.error('[prewarm-books] error', e);
  }
}

export function registerBookStatsJob() {
  const schedule = CRON_SCHEDULES.BOOKS_AGGREGATION;
  console.log(`[cron-books] Register schedule ${schedule}`);

  cron.schedule(schedule, async () => {
    const start = Date.now();
    console.log('[cron-books] ---- book stats aggregation start ----');
    try {
      const [stats, topBorrowedAll, topBorrowedMonth, topBorrowedYear, topBorrowersMonth, topBorrowersYear] = await Promise.all([
        getBookCollectionStats(),
        getTopBorrowedBooks(10),
        getTopBorrowedBooksThisMonth(10),
        getTopBorrowedBooksThisYear(10),
        getTopBorrowersThisMonth(10),
        getTopBorrowersThisYear(10)
      ]);
      await redis.set(CACHE_KEYS.BOOK_COLLECTION_STATS, JSON.stringify(stats), 'EX', 90000);
      await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED, JSON.stringify(topBorrowedAll), 'EX', 90000);
      await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED_MONTH, JSON.stringify(topBorrowedMonth), 'EX', 90000);
      await redis.set(CACHE_KEYS.BOOK_TOP_BORROWED_YEAR, JSON.stringify(topBorrowedYear), 'EX', 90000);
      await redis.set(CACHE_KEYS.BOOK_TOP_BORROWERS_MONTH, JSON.stringify(topBorrowersMonth), 'EX', 90000);
      await redis.set(CACHE_KEYS.BOOK_TOP_BORROWERS_YEAR, JSON.stringify(topBorrowersYear), 'EX', 90000);
      const now = new Date();
      const summaryPayload = {
        generated_at: new Date().toISOString(),
        ttl_seconds: 90000,
        period_month: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,
        year: now.getFullYear(),
        collection: stats,
        top_borrowed_all: topBorrowedAll,
        top_borrowed_month: topBorrowedMonth,
        top_borrowed_year: topBorrowedYear,
        top_borrowers_month: topBorrowersMonth,
        top_borrowers_year: topBorrowersYear
      };
      await redis.set(CACHE_KEYS.BOOK_SUMMARY, JSON.stringify(summaryPayload), 'EX', 90000);
      console.log(`[cron-books] refreshed stats titles=${stats.total_unique_titles} items=${stats.total_items} all=${topBorrowedAll.length} monthBooks=${topBorrowedMonth.length} yearBooks=${topBorrowedYear.length} monthBorrowers=${topBorrowersMonth.length} yearBorrowers=${topBorrowersYear.length} in ${Date.now() - start}ms`);
    } catch (e) {
      console.error('[cron-books] error', e);
    } finally {
      console.log('[cron-books] ---- book stats aggregation end ----');
    }
  });
}
