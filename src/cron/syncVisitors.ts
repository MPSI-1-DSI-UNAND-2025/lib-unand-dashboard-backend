import cron from 'node-cron';
import { CACHE_KEYS, setJSON, redis } from '../cache/redisClient.js';
import { getTodayCount, getDailyCountsThisWeek, getMonthlyTotalsLastYear, getYearlyTotalsLast5Years } from '../services/visitorService.js';

let fastJobRunning = false;
let fastLoopStarted = false;

export function registerVisitorSyncJob() {
  const minIntervalMs = Number(process.env.VISITOR_SYNC_MIN_INTERVAL_MS || 5000); // minimum gap between starts
  const bufferMs = Number(process.env.VISITOR_SYNC_BUFFER_MS || 500); // added after each run
  const slowSchedule = process.env.VISITOR_SLOW_CRON || '0 5 0 * * *'; // 00:05 daily

  console.log(`[cron] Fast loop dynamic (minIntervalMs=${minIntervalMs}, bufferMs=${bufferMs})`);
  console.log(`[cron] Register slow schedule ${slowSchedule}`);

  async function runFastLoop() {
    if (fastLoopStarted) return;
    fastLoopStarted = true;
    let lastStart = 0;
    const loop = async () => {
      const now = Date.now();
      const sinceLast = now - lastStart;
      if (sinceLast < minIntervalMs) {
        const wait = minIntervalMs - sinceLast;
        setTimeout(loop, wait);
        return;
      }
      lastStart = Date.now();
      fastJobRunning = true;
      const start = Date.now();
      console.log('[cron-fast] ---- sync start ----');
      try {
        const t1 = Date.now();
        const today = await getTodayCount();
        const dur = Date.now() - t1;
        console.log(`[cron-fast] getTodayCount -> ${today} (${dur}ms)`);
        const w1 = Date.now();
        // TTL chosen: slightly > minInterval (2.2x typical if using default values) to reduce misses
        const ttl = Math.max(Math.floor(minIntervalMs / 1000) * 2, 10);
        await redis.set(CACHE_KEYS.TODAY_COUNT, String(today), 'EX', ttl);
        console.log(`[cron-fast] wrote cache keys (${Date.now() - w1}ms) ttl=${ttl}s`);
        console.log(`[cron-fast] total elapsed ${Date.now() - start}ms`);
      } catch (e) {
        console.error('[cron-fast] error', e);
      } finally {
        fastJobRunning = false;
        console.log('[cron-fast] ---- sync end ----');
        setTimeout(loop, bufferMs); // schedule next after buffer
      }
    };
    loop();
  }

  runFastLoop();

  // Slow schedule: weekly + monthly + yearly aggregates (still cron-based)
  cron.schedule(slowSchedule, async () => {
    const start = Date.now();
    console.log('[cron-slow] ---- aggregation start ----');
    try {
      const [weekDaily, monthly, yearly] = await Promise.all([
        getDailyCountsThisWeek(),
        getMonthlyTotalsLastYear(),
        getYearlyTotalsLast5Years()
      ]);
      await setJSON(CACHE_KEYS.WEEK_DAILY, weekDaily, 86400);
      await setJSON(CACHE_KEYS.MONTHLY_TOTALS, monthly, 86400);
      await setJSON(CACHE_KEYS.YEARLY_TOTALS, yearly, 86400 * 7); // yearly changes infrequently, 7-day TTL
      console.log(`[cron-slow] updated weekDaily=${weekDaily.length} monthly=${monthly.length} yearly=${yearly.length} in ${Date.now() - start}ms`);
    } catch (e) {
      console.error('[cron-slow] error', e);
    } finally {
      console.log('[cron-slow] ---- aggregation end ----');
    }
  });
}
