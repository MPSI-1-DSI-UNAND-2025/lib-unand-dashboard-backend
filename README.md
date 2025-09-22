# Backend Library Dashboard

Fastify + TypeScript backend for a Library Dashboard focusing on near-realtime visitor metrics sourced from a large MySQL table and cached in Redis.

## Features
- REST APIs:
  - `GET /api/visitors/today` – today's visitor count (near-realtime)
  - `GET /api/visitors/weekly` – last 7 days (daily counts)
  - `GET /api/visitors/monthly` – last 12 months (monthly totals)
  - `GET /api/visitors/yearly` – last 5 years (annual totals)
  - `GET /api/visitors/summary` – bundles today + weekly + monthly + yearly
- Redis caching layer to reduce MySQL load
- Dual cron schedules:
  - Fast (default every 5s) warms today's count (tunable down to 1s if needed)
  - Slow (daily 00:05) warms weekly + monthly + yearly aggregates
- Fallback logic: if cache empty, query MySQL and repopulate
- Strict TypeScript config

## Tech Stack
- Fastify
- MySQL (`mysql2/promise`)
- Redis (`ioredis`)
- `node-cron` for scheduling
- TypeScript

## Environment Variables
See `.env.example` for all variables. Create a `.env` file:
```bash
cp .env.example .env
```

## Development
```bash
npm install
npm run dev
```
Server runs on `http://localhost:3000`.

## Build & Run
```bash
npm run build
npm start
```

## Sequence Diagram (Simplified)
```text
+-----------+        +-----------+        +-------+        +-------+
| Dashboard | -----> | Fastify   | -----> | Redis |        | MySQL |
| (poll 5s) | <----- | API       | <----- | Cache | <----- |  DB   |
+-----------+        +-----------+        +-------+        +-------+
       |                   ^                   ^              ^
       |                   | fast cron (*/5s) warms today count
     |                   | slow cron (daily) warms weekly/monthly/yearly
       +-------------------------------------------------------+
```
Flow:
1. Fast cron queries MySQL (today count) -> caches `visitors:today:count`
2. Slow cron queries MySQL (weekly + monthly + yearly aggregates) -> caches:
   - `visitors:week:daily`
   - `visitors:month:totals`
  - `visitors:year:totals`
3. Summary endpoint optionally composes today+weekly+monthly+yearly and caches `visitors:summary` (15s)
4. Dashboard/API calls respond from Redis (DB fallback if missing)

## Cache Keys & TTL Strategy
- Today count: cron sets TTL 12s (with 5s interval) ensuring > interval but < 3x interval
- Weekly & Monthly: TTL 86400s (24h) since updated daily
- Yearly: TTL 604800s (7 days) since it rarely changes mid-year
- Summary: TTL 15s (short composite cache, avoids repeated multi-get + compute)
- API fallback sets a short TTL (60s) for ad-hoc refresh safety

### Today Count Modes
Env: `TODAY_COUNT_MODE=direct|incremental|delta`

- direct (default): Each refresh queries MySQL with indexed range predicate.
- incremental: Maintains two Redis keys:
  - `visitors:today:base` (snapshot from last reconciliation)
  - `visitors:today:incremental` (delta via INCRBY operations)
  - Reconciliation every 60s (configurable in code) resets delta after pulling true count.
- delta: Single baseline query (COUNT + MAX(visitor_id)) then only counts rows with `visitor_id > baseline_max_id` for the rest of the day; updates baseline as new rows appear.

When to choose:
| Mode | Kapan Dipakai | Akurasi | Beban DB |
|------|---------------|---------|----------|
| direct | Data kecil / QPS rendah | Sangat akurat | Tertinggi |
| incremental | Bisa modifikasi jalur insert | Hampir akurat (drift < interval) | Rendah |
| delta | Tidak bisa modifikasi insert, PK auto-increment | Hampir akurat | Rendah (1 full + mini deltas) |

Pakai `delta` bila Anda tidak bisa panggil `incrementTodayCount()` tapi ingin mengurangi full scan harian besar.

## SQL Index / Performance Notes
- Ensure an index exists on `checkin_date` (BTREE).
- Today query uses range: `checkin_date >= CURDATE() AND checkin_date < CURDATE() + INTERVAL 1 DAY` (index friendly).
- Consider composite index `(checkin_date, visitor_id)` if scanning large ranges frequently.
- For sub-second read pressure consider adding an in-memory rolling counter (Redis INCR) and periodically reconciling with DB.

### Faster Than 5s?
Set `VISITOR_SYNC_CRON=* * * * * *` for 1s interval and adjust TTL to ~3s; monitor MySQL QPS and Redis ops.

## Adding More Metrics
Add a service function in `src/services/visitorService.ts`, register a cache key in `src/cache/redisClient.ts`, and decide whether it belongs to the fast (high-frequency) or slow (daily) schedule in `src/cron/syncVisitors.ts`. If it should be part of the combined response, also extend the logic in `routes/visitor.ts` summary handler.

## Example Summary Response
```json
{
  "today": 154,
  "weekly": [ { "date": "2025-09-16", "total": 123 }, ... ],
  "monthly": [ { "month": "2025-03", "total": 3456 }, ... ],
  "yearly": [ { "year": 2023, "total": 45678 }, ... ],
  "source": "today:cache,weekly:cache,monthly:db,yearly:cache"
}
```

## License
MIT
