import cron from 'node-cron';
import { CACHE_KEYS, setJSON, redis } from '../cache/redisClient.js';
import { getTodayCount, getDailyCountsThisWeek, getMonthlyTotalsLastYear, getYearlyTotalsLast5Years, getCurrentMonthTopVisitors, getCurrentYearTopVisitors } from '../services/visitorService.js';
import { CRON_SCHEDULES, REALTIME } from './schedules.js';
import { emitTodayVisitor } from '../events/visitorEvents.js';

let fastJobRunning = false;
let fastLoopStarted = false;

export function registerVisitorSyncJob() {
  const minIntervalMs = REALTIME.VISITOR_FAST_MIN_INTERVAL_MS; // minimum gap between starts
  const bufferMs = REALTIME.VISITOR_FAST_BUFFER_MS; // added after each run
  const slowSchedule = CRON_SCHEDULES.VISITOR_AGGREGATION; // daily aggregation

  console.log(`[cron] Fast loop dynamic (minIntervalMs=${minIntervalMs}, bufferMs=${bufferMs})`);
  console.log(`[cron] Register slow schedule ${slowSchedule}`);

  async function runFastLoop() {
    if (fastLoopStarted) return;
    fastLoopStarted = true;
    let lastStart = 0;
    // Adaptive controls
    const ADAPTIVE_ENABLED = process.env.VISITOR_FAST_ADAPTIVE === 'true';
    const HARD_FLOOR_MS = Number(process.env.VISITOR_FAST_HARD_FLOOR_MS || 150); // absolute lowest allowed
    const TARGET_MULTIPLIER = Number(process.env.VISITOR_FAST_TARGET_MULTIPLIER || 20); // interval ≈ avgDuration * multiplier
    const SOFT_FLOOR_MS = Number(process.env.VISITOR_FAST_SOFT_FLOOR_MS || 400); // do not dip below unless minIntervalMs higher
    let avgRun = 0;
    let runs = 0;

    const loop = async () => {
      const now = Date.now();
      const sinceLast = now - lastStart;
  let effectiveMin = minIntervalMs;
      if (ADAPTIVE_ENABLED && runs > 5) {
        const dynamic = Math.round((avgRun || 1) * TARGET_MULTIPLIER);
        // Cap by configured minIntervalMs, but enforce floors
        effectiveMin = Math.max(
          HARD_FLOOR_MS,
          Math.min(minIntervalMs, Math.max(dynamic, SOFT_FLOOR_MS))
        );
      }
      if (sinceLast < effectiveMin) {
        const wait = effectiveMin - sinceLast;
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
  // TTL should scale with effectiveMin (not the original configured min) so cache hits remain high
  const ttlBase = (ADAPTIVE_ENABLED && runs > 5) ? effectiveMin : minIntervalMs;
  // Ensure at least 2s TTL; scale ~2x interval (if interval < 1000ms floor to seconds still =0 so clamp)
  const ttl = Math.max(Math.floor(ttlBase / 1000) * 2, 2);
  await redis.set(CACHE_KEYS.TODAY_COUNT, String(today), 'EX', ttl);
        emitTodayVisitor(today);
        console.log(`[cron-fast] wrote cache keys (${Date.now() - w1}ms) ttl=${ttl}s`);
        const total = Date.now() - start;
        console.log(`[cron-fast] total elapsed ${total}ms`);
        runs++;
        avgRun = avgRun === 0 ? total : (avgRun * 0.85 + total * 0.15);
        if (ADAPTIVE_ENABLED) {
          const dynamic = Math.round((avgRun || 1) * TARGET_MULTIPLIER);
            console.log(`[cron-fast][adaptive] avgRun≈${avgRun.toFixed(1)}ms dynamic≈${dynamic}ms effectiveMin=${effectiveMin}ms`);
        }
      } catch (e) {
        console.error('[cron-fast] error', e);
      } finally {
        fastJobRunning = false;
        console.log('[cron-fast] ---- sync end ----');
        setTimeout(loop, bufferMs);
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
      const [weekDaily, monthly, yearly, topMonthly, topYearly] = await Promise.all([
        getDailyCountsThisWeek(),
        getMonthlyTotalsLastYear(),
        getYearlyTotalsLast5Years(),
        getCurrentMonthTopVisitors(10),
        getCurrentYearTopVisitors(10)
      ]);
      const metaWrap = (data: any) => ({ generated_at: new Date().toISOString(), ttl_seconds: 90000, data });
      await setJSON(CACHE_KEYS.WEEK_DAILY, metaWrap(weekDaily), 90000);
      await setJSON(CACHE_KEYS.MONTHLY_TOTALS, metaWrap(monthly), 90000);
      await setJSON(CACHE_KEYS.YEARLY_TOTALS, metaWrap(yearly), 90000);
      await setJSON(CACHE_KEYS.TOP_MONTH_VISITORS, metaWrap(topMonthly), 90000);
      await setJSON(CACHE_KEYS.TOP_YEAR_VISITORS, metaWrap(topYearly), 90000);
  console.log(`[cron-slow] updated weekDaily=${weekDaily.length} monthly=${monthly.length} yearly=${yearly.length} topMonthly=${topMonthly.length} topYearly=${topYearly.length} in ${Date.now() - start}ms`);
    } catch (e) {
      console.error('[cron-slow] error', e);
    } finally {
      console.log('[cron-slow] ---- aggregation end ----');
    }
  });
}

export async function prewarmVisitorCaches() {
  try {
    const start = Date.now();
    const [weekDaily, monthly, yearly, topMonthly, topYearly] = await Promise.all([
      getDailyCountsThisWeek(),
      getMonthlyTotalsLastYear(),
      getYearlyTotalsLast5Years(),
      getCurrentMonthTopVisitors(10),
      getCurrentYearTopVisitors(10)
    ]);
    const metaWrap = (data: any) => ({ generated_at: new Date().toISOString(), ttl_seconds: 90000, data });
    await setJSON(CACHE_KEYS.WEEK_DAILY, metaWrap(weekDaily), 90000);
    await setJSON(CACHE_KEYS.MONTHLY_TOTALS, metaWrap(monthly), 90000);
    await setJSON(CACHE_KEYS.YEARLY_TOTALS, metaWrap(yearly), 90000);
    await setJSON(CACHE_KEYS.TOP_MONTH_VISITORS, metaWrap(topMonthly), 90000);
    await setJSON(CACHE_KEYS.TOP_YEAR_VISITORS, metaWrap(topYearly), 90000);
    console.log(`[prewarm-visitors] done in ${Date.now() - start}ms`);
  } catch (e) {
    console.error('[prewarm-visitors] error', e);
  }
}
