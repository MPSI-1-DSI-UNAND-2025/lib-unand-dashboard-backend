import { pool } from '../db/mysqlClient.js';
import { redis } from '../cache/redisClient.js';
import { Op, fn, col } from 'sequelize';

export interface VisitorRow {
  visitor_id: number;
  member_id: string | null;
  member_name: string | null;
  institution: string | null;
  room_code: string | null;
  checkin_date: string; // ISO string
}

// Today count strategies:
// direct       -> always query DB with range predicate (accurate, slower for large tables)
// incremental  -> rolling Redis delta + periodic reconcile (needs increment hook on write path)
// delta        -> baseline (count + max_id) once, then only count rows with visitor_id > baseline_max_id
// Mode selected via env TODAY_COUNT_MODE=incremental|direct|delta (default direct)
const TODAY_MODE = (process.env.TODAY_COUNT_MODE || 'direct').toLowerCase();
const TODAY_INC_KEY = 'visitors:today:incremental';
const TODAY_BASE_KEY = 'visitors:today:base';
const TODAY_LAST_RECON_KEY = 'visitors:today:lastrecon';
const TODAY_DELTA_BASE_COUNT_KEY = 'visitors:today:delta:basecount';
const TODAY_DELTA_BASE_MAXID_KEY = 'visitors:today:delta:basemaxid';
const TODAY_DELTA_LAST_INIT_KEY = 'visitors:today:delta:lastinit';

const USE_SEQUELIZE = (process.env.USE_SEQUELIZE || 'false').toLowerCase() === 'true';
let visitorModelRef: any = null;
async function getVisitorModel() {
  if (!USE_SEQUELIZE) return null;
  if (!visitorModelRef) {
    // Ensure sequelize is initialized
    await import('../db/sequelize.js');
    const mod = await import('../models/Visitor.js');
    visitorModelRef = mod.Visitor;
  }
  return visitorModelRef;
}

function getTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

async function queryTodayFromDb(): Promise<number> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const { start, end } = getTodayRange();
    return Visitor.count({ where: { checkin_date: { [Op.gte]: start, [Op.lt]: end } } });
  }
  const sql = `SELECT COUNT(*) as total_today
               FROM visitor_count
               WHERE checkin_date >= CURDATE()
                 AND checkin_date < (CURDATE() + INTERVAL 1 DAY)`;
  const [rows] = await pool.query(sql);
  const r = rows as Array<{ total_today: number }>;
  return r[0]?.total_today || 0;
}

// Helper for delta mode: baseline (count + max id) for today
async function queryTodayBaseline(): Promise<{ count: number; maxId: number }> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const { start, end } = getTodayRange();
    const where = { checkin_date: { [Op.gte]: start, [Op.lt]: end } } as any;
    const [count, maxId] = await Promise.all([
      Visitor.count({ where }),
      Visitor.max('visitor_id', { where }).then((v: number | null) => v || 0)
    ]);
    return { count, maxId };
  }
  const sqlBaseline = `SELECT COUNT(*) AS c, MAX(visitor_id) AS m
                       FROM visitor_count
                       WHERE checkin_date >= CURDATE()
                         AND checkin_date < (CURDATE() + INTERVAL 1 DAY)`;
  const [rows] = await pool.query(sqlBaseline);
  const r = rows as Array<{ c: number; m: number | null }>;
  return { count: r[0]?.c || 0, maxId: r[0]?.m || 0 };
}

// Helper for delta mode: delta (count + new max id) after baseline
async function queryTodayDeltaAfter(baseMaxId: number): Promise<{ delta: number; newMax: number | null }> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const { start, end } = getTodayRange();
    const where = {
      visitor_id: { [Op.gt]: baseMaxId },
      checkin_date: { [Op.gte]: start, [Op.lt]: end }
    } as any;
    const [delta, newMax] = await Promise.all([
      Visitor.count({ where }),
      Visitor.max('visitor_id', { where })
    ]);
    return { delta, newMax };
  }
  const sqlDelta = `SELECT COUNT(*) AS dc, MAX(visitor_id) AS mx
                    FROM visitor_count
                    WHERE visitor_id > ?
                      AND checkin_date >= CURDATE()
                      AND checkin_date < (CURDATE() + INTERVAL 1 DAY)`;
  const [dRows] = await pool.query(sqlDelta, [baseMaxId]);
  const dr = dRows as Array<{ dc: number; mx: number | null }>;
  return { delta: dr[0]?.dc || 0, newMax: dr[0]?.mx || null };
}

export async function getTodayCount(): Promise<number> {
  if (TODAY_MODE === 'direct') {
    return queryTodayFromDb();
  }
  if (TODAY_MODE === 'incremental') {
    const now = Date.now();
    const RECON_INTERVAL = 60_000; // 1 minute
    const lastReconRaw = await redis.get(TODAY_LAST_RECON_KEY);
    const lastRecon = lastReconRaw ? Number(lastReconRaw) : 0;
    if (now - lastRecon > RECON_INTERVAL) {
      const real = await queryTodayFromDb();
      await redis.multi()
        .set(TODAY_BASE_KEY, String(real))
        .set(TODAY_INC_KEY, '0')
        .set(TODAY_LAST_RECON_KEY, String(now))
        .exec();
    }
    const [baseRaw, deltaRaw] = await Promise.all([
      redis.get(TODAY_BASE_KEY),
      redis.get(TODAY_INC_KEY)
    ]);
    const base = baseRaw ? Number(baseRaw) : 0;
    const delta = deltaRaw ? Number(deltaRaw) : 0;
    return base + delta;
  }
  if (TODAY_MODE === 'delta') {
    // Initialize baseline once per day (or if missing)
    const [baseCountRaw, baseMaxIdRaw, lastInitRaw] = await Promise.all([
      redis.get(TODAY_DELTA_BASE_COUNT_KEY),
      redis.get(TODAY_DELTA_BASE_MAXID_KEY),
      redis.get(TODAY_DELTA_LAST_INIT_KEY)
    ]);
  let baseCount: number | null = baseCountRaw ? Number(baseCountRaw) : null;
  let baseMaxId: number | null = baseMaxIdRaw ? Number(baseMaxIdRaw) : null;
    let needInit = false;
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (!lastInitRaw || !lastInitRaw.startsWith(todayStr) || baseCount === null || baseMaxId === null) {
      needInit = true;
    }
    if (needInit) {
      // Single query (via pool or sequelize) to get baseline count + max id for today
      const { count, maxId } = await queryTodayBaseline();
      baseCount = count;
      baseMaxId = maxId;
      await redis.multi()
        .set(TODAY_DELTA_BASE_COUNT_KEY, String(baseCount))
        .set(TODAY_DELTA_BASE_MAXID_KEY, String(baseMaxId))
        .set(TODAY_DELTA_LAST_INIT_KEY, `${todayStr}:${Date.now()}`)
        .exec();
      return baseCount; // first call returns baseline only
    }
    // Delta query: only rows with id > baseline max id within today's range
    const { delta: deltaCount, newMax } = await queryTodayDeltaAfter(baseMaxId!);
    if (baseCount === null) baseCount = 0; // safety fallback
    if (baseMaxId === null) baseMaxId = 0;
    if (deltaCount > 0 && newMax && newMax > baseMaxId) {
      baseCount = baseCount + deltaCount;
      baseMaxId = newMax;
      await redis.multi()
        .set(TODAY_DELTA_BASE_COUNT_KEY, String(baseCount))
        .set(TODAY_DELTA_BASE_MAXID_KEY, String(baseMaxId))
        .exec();
    }
    return baseCount;
  }
  // Fallback
  return queryTodayFromDb();
}

// Utility to increment today count externally (e.g., when a new visit is recorded)
export async function incrementTodayCount(by = 1) {
  if (TODAY_MODE === 'incremental') {
    await redis.incrby(TODAY_INC_KEY, by);
  }
  // In delta mode we do NOT increment manually; delta counted via DB query on visitor_id range.
}

export interface DailyCount { date: string; total: number; }

export async function getDailyCountsThisWeek(): Promise<DailyCount[]> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const rows = await Visitor.findAll({
      attributes: [
        [fn('DATE', col('checkin_date')), 'date'],
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: start } },
      group: [fn('DATE', col('checkin_date'))],
      order: [[fn('DATE', col('checkin_date')), 'ASC']],
      raw: true
    });
    return rows.map((r: any) => ({ date: r.date, total: Number(r.total) }));
  }
  const sql = `SELECT DATE(checkin_date) AS date, COUNT(*) AS total
               FROM visitor_count
               WHERE checkin_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
               GROUP BY DATE(checkin_date)
               ORDER BY date ASC`;
  const [rows] = await pool.query(sql);
  return (rows as any[]).map(r => ({ date: r.date, total: Number(r.total) }));
}

export interface MonthlyTotal { month: string; total: number; }

export async function getMonthlyTotalsLastYear(): Promise<MonthlyTotal[]> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1); // first of current month
    startMonth.setMonth(startMonth.getMonth() - 11);
    const rows = await Visitor.findAll({
      attributes: [
        [fn('DATE_FORMAT', col('checkin_date'), '%Y-%m'), 'month'],
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: startMonth } },
      group: [fn('DATE_FORMAT', col('checkin_date'), '%Y-%m')],
      order: [[fn('DATE_FORMAT', col('checkin_date'), '%Y-%m'), 'ASC']],
      raw: true
    });
    return rows.map((r: any) => ({ month: r.month, total: Number(r.total) }));
  }
  const sql = `SELECT DATE_FORMAT(checkin_date, '%Y-%m') AS month, COUNT(*) AS total
               FROM visitor_count
               WHERE checkin_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
               GROUP BY month
               ORDER BY month ASC`;
  const [rows] = await pool.query(sql);
  return (rows as any[]).map(r => ({ month: r.month, total: Number(r.total) }));
}

export interface YearlyTotal { year: number; total: number; }

export async function getYearlyTotalsLast5Years(): Promise<YearlyTotal[]> {
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const now = new Date();
    const start = new Date(now.getFullYear() - 4, 0, 1); // Jan 1 (currentYear-4)
    const rows = await Visitor.findAll({
      attributes: [
        [fn('YEAR', col('checkin_date')), 'year'],
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: start } },
      group: [fn('YEAR', col('checkin_date'))],
      order: [[fn('YEAR', col('checkin_date')), 'ASC']],
      raw: true
    });
    return rows.map((r: any) => ({ year: Number(r.year), total: Number(r.total) }));
  }
  const sql = `SELECT YEAR(checkin_date) AS year, COUNT(*) AS total
               FROM visitor_count
               WHERE checkin_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-01-01'), INTERVAL 4 YEAR)
               GROUP BY YEAR(checkin_date)
               ORDER BY year ASC`;
  const [rows] = await pool.query(sql);
  return (rows as any[]).map(r => ({ year: Number(r.year), total: Number(r.total) }));
}
