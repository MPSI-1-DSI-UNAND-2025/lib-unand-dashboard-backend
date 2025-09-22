# Backend Library Dashboard

Fastify + TypeScript backend for a Library Dashboard focusing on near-realtime visitor metrics sourced from a large MySQL table and cached in Redis. Supports hybrid DB access (native mysql2 or Sequelize ORM) and OpenAPI (Swagger) interactive docs.

## Features
- REST APIs:
  - `GET /api/visitors/today` – today's visitor count (near-realtime)
  - `GET /api/visitors/weekly` – last 7 days (daily counts)
  - `GET /api/visitors/monthly` – last 12 months (monthly totals)
  - `GET /api/visitors/yearly` – last 5 years (annual totals)
  - `GET /api/visitors/summary` – bundles today + weekly + monthly + yearly
- Redis caching layer to reduce MySQL load
- Dynamic scheduling:
  - Fast loop (self-rescheduling) refreshes today's count sequentially (no overlap) respecting `VISITOR_SYNC_MIN_INTERVAL_MS` + execution time + buffer.
  - Slow cron (daily 00:05 by default) warms weekly + monthly + yearly aggregates.
- Fallback logic: if cache empty, query MySQL and repopulate
- Strict TypeScript config

## Tech Stack
- Fastify
- MySQL (`mysql2/promise`) OR Sequelize (`USE_SEQUELIZE=true`)
- Redis (`ioredis`)
- Dynamic loop + `node-cron` (slow aggregates)
- TypeScript
- OpenAPI docs (`@fastify/swagger` + `@fastify/swagger-ui`)

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
| Dashboard / Docs | -----> | Fastify   | -----> | Redis |        | MySQL |
| (poll 5s) | <----- | API       | <----- | Cache | <----- |  DB   |
+-----------+        +-----------+        +-------+        +-------+
       |                   ^                   ^              ^
       |                   | fast loop (interval+duration) warms today count
       |                   | slow cron (daily) warms weekly/monthly/yearly
       +-------------------------------------------------------+
```
Flow:
1. Fast loop queries DB (today count, indexed range or delta mode) -> caches `visitors:today:count`
2. Slow cron queries MySQL (weekly + monthly + yearly aggregates) -> caches:
   - `visitors:week:daily`
   - `visitors:month:totals`
  - `visitors:year:totals`
3. Summary endpoint optionally composes today+weekly+monthly+yearly and caches `visitors:summary` (15s)
4. Dashboard/API calls respond from Redis (DB fallback if missing)
5. Swagger UI available at `/docs` (JSON spec at `/docs/json`)

## Cache Keys & TTL Strategy
- Today count: loop sets TTL ~ (2–3x min interval) or manual fallback 60s if API missed warm
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
| Mode | When to Use | Accuracy | DB Load |
|------|-------------|----------|---------|
| direct | Small data set / low QPS | Exact | Highest |
| incremental | You can modify the insert/write path | Near‑exact (minor drift) | Low |
| delta | Can't modify writes; auto-increment PK available | Near‑exact | Low (1 full + small deltas) |

Choose `delta` if you cannot call a write-time increment but want to avoid repeated full scans.

## SQL Index / Performance Notes
- Ensure an index exists on `checkin_date` (BTREE).
- Today query uses range: `checkin_date >= CURDATE() AND checkin_date < CURDATE() + INTERVAL 1 DAY` (index friendly).
- Consider composite index `(checkin_date, visitor_id)` if scanning large ranges frequently.
- For sub-second read pressure consider adding an in-memory rolling counter (Redis INCR) and periodically reconciling with DB.

### Faster Refresh?
Adjust:
```
VISITOR_SYNC_MIN_INTERVAL_MS=1000  # target base interval (1s)
VISITOR_SYNC_BUFFER_MS=300         # safety buffer after each run
```
Effective cadence ≈ lastRunDuration + buffer + minInterval. Monitor MySQL QPS & Redis ops.

### Sample Fast Loop Run (<10ms Total)

Real log sample (delta mode, warm Redis, index on `checkin_date` present):

```
[cron-fast] ---- sync start ----
[cron-fast] getTodayCount -> 3 (6ms)
[cron-fast] wrote cache keys (2ms) ttl=10s
[cron-fast] total elapsed 9ms
[cron-fast] ---- sync end ----
```

Why it's this fast:
1. Indexed predicate `checkin_date >= CURDATE() AND checkin_date < CURDATE() + INTERVAL 1 DAY` narrows directly to today's range.
2. Delta mode counts only new rows (`visitor_id > baseline_max_id`) instead of rescanning.
3. Redis holds the baseline + running total so only a small delta increment is applied.
4. Dynamic loop eliminates overlapping jobs; finish -> small buffer -> schedule next.
5. Very small Redis write footprint (a few short-TTL keys).

First run after a restart may be slower (baseline warm-up). Subsequent iterations typically converge to single‑digit milliseconds under normal load.

### Switching DB Layer
```
USE_SEQUELIZE=false  # default: raw mysql2 pool (fastest)
USE_SEQUELIZE=true   # use Sequelize model / ORM queries
```
All counting + aggregates honor the flag (no raw `sequelize.query` used).
## OpenAPI (Swagger)
After `npm install` and server start:
- UI: `http://localhost:3000/docs`
- JSON Spec: `http://localhost:3000/docs/json`

Tag: `Visitors` documents all metrics endpoints.

To disable docs in production, conditionally register swagger plugins (e.g., wrap registration with `if (process.env.ENABLE_SWAGGER !== 'false')`).

## Environment Variables (Key Ones)
| Variable | Purpose | Example |
|----------|---------|---------|
| PORT | Server port | 3000 |
| DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME | MySQL connection | — |
| REDIS_URL | Redis connection string | redis://localhost:6379 |
| TODAY_COUNT_MODE | `direct|incremental|delta` | direct |
| USE_SEQUELIZE | Toggle ORM | false |
| VISITOR_SYNC_MIN_INTERVAL_MS | Fast loop base interval | 5000 |
| VISITOR_SYNC_BUFFER_MS | Extra wait after a run | 500 |
| VISITOR_SLOW_CRON | Cron for aggregates | 5 0 * * * |

See `.env.example` for the full list.


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

  ## Development Notes
  - Dev server uses `tsx watch` (auto restart). No need for `nodemon`.
  - Production: build first (`npm run build`) then `npm start` (runs `dist/`).
  - Avoid editing files in `dist/`; regenerate via build.

  ## Performance Tips Recap
  1. Ensure index on `checkin_date` (critical for <10ms today count).
  2. Use `delta` mode if baseline count is heavy and you cannot increment on writes.
  3. Set `USE_SEQUELIZE=false` for lowest latency; enable only if you need model abstraction.
  4. Monitor loop logs to tune `VISITOR_SYNC_MIN_INTERVAL_MS`.
  5. Keep summary TTL low to avoid stale today metrics.

  ## Roadmap Ideas (Optional)
  - Adaptive interval (increase interval if run duration spikes)
  - Prometheus metrics exporter
  - Health endpoint exposing mode, last run duration, baseline info
  - Reusable OpenAPI component schemas


