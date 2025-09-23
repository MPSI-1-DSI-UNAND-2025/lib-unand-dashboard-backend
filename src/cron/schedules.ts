// Centralized cron schedule definitions and timing-related configuration
// All non-real-time aggregations run strictly once per 24h (unless manually triggered)

export const CRON_SCHEDULES = {
  VISITOR_AGGREGATION: process.env.VISITOR_SLOW_CRON || '0 5 0 * * *',      // 00:05 server time daily
  BOOKS_AGGREGATION: process.env.BOOK_STATS_CRON || '0 10 0 * * *',         // 00:10 server time daily
};

export const REALTIME = {
  // Faster default: 1s loop interval (can be overridden via env)
  VISITOR_FAST_MIN_INTERVAL_MS: Number(process.env.VISITOR_SYNC_MIN_INTERVAL_MS || 1000),
  // Shorter buffer to keep cadence tight but still avoid overlap
  VISITOR_FAST_BUFFER_MS: Number(process.env.VISITOR_SYNC_BUFFER_MS || 200)
};
