import { pool } from '../db/mysqlClient.js';
import { redis } from '../cache/redisClient.js';
import { Op, fn, col } from 'sequelize';

// Mapping fakultas berdasarkan kode institution
const FAKULTAS_MAPPING: Record<string, string> = {
  '01': 'Hukum',
  '02': 'Pertanian',
  '03': 'Kedokteran',
  '04': 'MIPA',
  '05': 'Ekonomi',
  '06': 'Peternakan',
  '07': 'Ilmu Budaya',
  '08': 'Ilmu Sosial dan Ilmu Politik',
  '09': 'Teknik',
  '10': 'Farmasi',
  '11': 'Teknologi Pertanian',
  '12': 'Kesehatan Masyarakat',
  '13': 'Keperawatan',
  '14': 'Kedokteran Gigi',
  '15': 'Teknologi Informasi',
  '16': 'Pascasarjana'
};

function getFakultasName(institution: string | null): string | null {
  if (!institution) return null;
  return FAKULTAS_MAPPING[institution] || null;
}

export interface VisitorRow {
  visitor_id: number;
  member_id: string | null;
  member_name: string | null;
  institution: string | null;
  fakultas: string | null;
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
      // Descending so latest month first
      order: [[fn('DATE_FORMAT', col('checkin_date'), '%Y-%m'), 'DESC']],
      raw: true
    });
    return rows.map((r: any) => ({ month: r.month, total: Number(r.total) }));
  }
  const sql = `SELECT DATE_FORMAT(checkin_date, '%Y-%m') AS month, COUNT(*) AS total
               FROM visitor_count
               WHERE checkin_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
               GROUP BY month
               ORDER BY month DESC`;
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
      // Descending so latest year first
      order: [[fn('YEAR', col('checkin_date')), 'DESC']],
      raw: true
    });
    return rows.map((r: any) => ({ year: Number(r.year), total: Number(r.total) }));
  }
  const sql = `SELECT YEAR(checkin_date) AS year, COUNT(*) AS total
               FROM visitor_count
               WHERE checkin_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-01-01'), INTERVAL 4 YEAR)
               GROUP BY YEAR(checkin_date)
               ORDER BY year DESC`;
  const [rows] = await pool.query(sql);
  return (rows as any[]).map(r => ({ year: Number(r.year), total: Number(r.total) }));
}

export interface MonthlyTopVisitor {
  month: string; // YYYY-MM (current month only in this implementation)
  member_id: string | null;
  member_name: string | null;
  institution: string | null;
  fakultas: string | null;
  total: number;
}

// Returns top N visitors (grouped by member) for the CURRENT month only.
export async function getCurrentMonthTopVisitors(limit = 10): Promise<MonthlyTopVisitor[]> {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthKey = `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, '0')}`;
  const results: MonthlyTopVisitor[] = [];
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const rows = await Visitor.findAll({
      attributes: [
        'member_id',
        'member_name',
        'institution',
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: mStart, [Op.lt]: mEnd } },
      group: ['member_id', 'member_name', 'institution'],
      order: [[fn('COUNT', col('*')), 'DESC']],
      limit,
      raw: true
    });
    for (const r of rows as any[]) {
      results.push({
        month: monthKey,
        member_id: r.member_id,
        member_name: r.member_name,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  } else {
    const sql = `SELECT member_id, member_name, institution, COUNT(*) AS total
                 FROM visitor_count
                 WHERE checkin_date >= ? AND checkin_date < ?
                 GROUP BY member_id, member_name, institution
                 ORDER BY total DESC
                 LIMIT ${limit}`;
    const [rows] = await pool.query(sql, [mStart, mEnd]);
    for (const r of rows as any[]) {
      results.push({
        month: monthKey,
        member_id: r.member_id,
        member_name: r.member_name,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  }
  return results;
}

export interface YearlyTopVisitor {
  year: number; // current year only in this implementation
  member_id: string | null;
  member_name: string | null;
  institution: string | null;
  fakultas: string | null;
  total: number;
}

export interface MonthlyTopFaculty {
  month: string; // YYYY-MM (current month only in this implementation)
  institution: string | null;
  fakultas: string | null;
  total: number;
}

export interface YearlyTopFaculty {
  year: number; // current year only in this implementation
  institution: string | null;
  fakultas: string | null;
  total: number;
}

// Returns top N visitors (grouped by member) for the CURRENT year only.
export async function getCurrentYearTopVisitors(limit = 10): Promise<YearlyTopVisitor[]> {
  const now = new Date();
  const y = now.getFullYear();
  const yStart = new Date(y, 0, 1);
  const yEnd = new Date(y + 1, 0, 1);
  const results: YearlyTopVisitor[] = [];
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const rows = await Visitor.findAll({
      attributes: [
        'member_id',
        'member_name',
        'institution',
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: yStart, [Op.lt]: yEnd } },
      group: ['member_id', 'member_name', 'institution'],
      order: [[fn('COUNT', col('*')), 'DESC']],
      limit,
      raw: true
    });
    for (const r of rows as any[]) {
      results.push({
        year: y,
        member_id: r.member_id,
        member_name: r.member_name,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  } else {
    const sql = `SELECT member_id, member_name, institution, COUNT(*) AS total
                 FROM visitor_count
                 WHERE checkin_date >= ? AND checkin_date < ?
                 GROUP BY member_id, member_name, institution
                 ORDER BY total DESC
                 LIMIT ${limit}`;
    const [rows] = await pool.query(sql, [yStart, yEnd]);
    for (const r of rows as any[]) {
      results.push({
        year: y,
        member_id: r.member_id,
        member_name: r.member_name,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  }
  return results;
}

// Returns top N faculties (grouped by institution) for the CURRENT month only.
export async function getCurrentMonthTopFaculties(limit = 10): Promise<MonthlyTopFaculty[]> {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthKey = `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, '0')}`;
  const results: MonthlyTopFaculty[] = [];
  
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const rows = await Visitor.findAll({
      attributes: [
        'institution',
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: mStart, [Op.lt]: mEnd } },
      group: ['institution'],
      order: [[fn('COUNT', col('*')), 'DESC']],
      limit,
      raw: true
    });
    for (const r of rows as any[]) {
      results.push({
        month: monthKey,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  } else {
    const sql = `SELECT institution, COUNT(*) AS total
                 FROM visitor_count
                 WHERE checkin_date >= ? AND checkin_date < ?
                 GROUP BY institution
                 ORDER BY total DESC
                 LIMIT ${limit}`;
    const [rows] = await pool.query(sql, [mStart, mEnd]);
    for (const r of rows as any[]) {
      results.push({
        month: monthKey,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  }
  return results;
}

// Returns top N faculties (grouped by institution) for the CURRENT year only.
export async function getCurrentYearTopFaculties(limit = 10): Promise<YearlyTopFaculty[]> {
  const now = new Date();
  const y = now.getFullYear();
  const yStart = new Date(y, 0, 1);
  const yEnd = new Date(y + 1, 0, 1);
  const results: YearlyTopFaculty[] = [];
  
  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    const rows = await Visitor.findAll({
      attributes: [
        'institution',
        [fn('COUNT', col('*')), 'total']
      ],
      where: { checkin_date: { [Op.gte]: yStart, [Op.lt]: yEnd } },
      group: ['institution'],
      order: [[fn('COUNT', col('*')), 'DESC']],
      limit,
      raw: true
    });
    for (const r of rows as any[]) {
      results.push({
        year: y,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  } else {
    const sql = `SELECT institution, COUNT(*) AS total
                 FROM visitor_count
                 WHERE checkin_date >= ? AND checkin_date < ?
                 GROUP BY institution
                 ORDER BY total DESC
                 LIMIT ${limit}`;
    const [rows] = await pool.query(sql, [yStart, yEnd]);
    for (const r of rows as any[]) {
      results.push({
        year: y,
        institution: r.institution,
        fakultas: getFakultasName(r.institution),
        total: Number(r.total)
      });
    }
  }
  return results;
}

// Dummy visitor generation
let dummyGenerationInterval: NodeJS.Timeout | null = null;
let isDummyGenerationRunning = false;

export function getDummyGenerationStatus(): { running: boolean; interval: NodeJS.Timeout | null } {
  return { running: isDummyGenerationRunning, interval: dummyGenerationInterval };
}

export function startDummyGeneration(): { success: boolean; message: string } {
  if (isDummyGenerationRunning) {
    return { success: false, message: 'Dummy generation is already running' };
  }

  isDummyGenerationRunning = true;
  dummyGenerationInterval = setInterval(async () => {
    try {
      await generateDummyVisitor();
    } catch (error) {
      console.error('[dummy-generation] Error generating dummy visitor:', error);
    }
  }, 60000); // 1 menit = 60000ms

  console.log('[dummy-generation] Started generating dummy visitors every 1 minute');
  return { success: true, message: 'Dummy generation started successfully' };
}

export function stopDummyGeneration(): { success: boolean; message: string } {
  if (!isDummyGenerationRunning) {
    return { success: false, message: 'Dummy generation is not running' };
  }

  if (dummyGenerationInterval) {
    clearInterval(dummyGenerationInterval);
    dummyGenerationInterval = null;
  }
  isDummyGenerationRunning = false;

  console.log('[dummy-generation] Stopped generating dummy visitors');
  return { success: true, message: 'Dummy generation stopped successfully' };
}

async function generateDummyVisitor(): Promise<void> {
  const institutions = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16'];
  const memberNames = [
    'Ahmad Rizki', 'Siti Nurhaliza', 'Budi Santoso', 'Dewi Kartika', 'Eko Prasetyo',
    'Fina Rahayu', 'Gunawan Sari', 'Hesti Wulandari', 'Indra Kurniawan', 'Jihan Putri',
    'Kurniawan Adi', 'Lina Marlina', 'Muhammad Ali', 'Nina Sari', 'Oscar Wijaya',
    'Putri Maharani', 'Qori Sandria', 'Rizki Pratama', 'Sari Dewi', 'Tono Wijaya'
  ];
  const roomCodes = ['A101', 'A102', 'B201', 'B202', 'C301', 'C302', 'D401', 'D402'];

  const randomInstitution = institutions[Math.floor(Math.random() * institutions.length)];
  const randomMemberName = memberNames[Math.floor(Math.random() * memberNames.length)];
  const randomRoomCode = roomCodes[Math.floor(Math.random() * roomCodes.length)];
  const randomMemberId = `M${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

  const now = new Date();
  const checkinDate = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000); // Random time within last 24 hours

  if (USE_SEQUELIZE) {
    const Visitor = await getVisitorModel();
    await Visitor.create({
      member_id: randomMemberId,
      member_name: randomMemberName,
      institution: randomInstitution,
      room_code: randomRoomCode,
      checkin_date: checkinDate
    });
  } else {
    const sql = `INSERT INTO visitor_count (member_id, member_name, institution, room_code, checkin_date) VALUES (?, ?, ?, ?, ?)`;
    await pool.query(sql, [randomMemberId, randomMemberName, randomInstitution, randomRoomCode, checkinDate]);
  }

  // Increment today count if it's today
  const today = new Date();
  if (checkinDate.toDateString() === today.toDateString()) {
    await incrementTodayCount(1);
  }

  console.log(`[dummy-generation] Generated visitor: ${randomMemberName} (${randomInstitution}) at ${checkinDate.toISOString()}`);
}