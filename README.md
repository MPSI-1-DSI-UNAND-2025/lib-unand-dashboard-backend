```markdown
# Library Dashboard Backend

Fast, cache-first analytics API for library visitors and borrowing statistics.

---

## Core Principle
- **Realtime:** Only today's visitor count is real-time (via SSE).  
- **Cache-first:** All other metrics are pre-computed once per day and served from Redis.  
- **Goal:** Minimize MySQL load while providing consistently fast API responses.  

---

## Architecture
```

Frontend  ⇆  Fastify API  ⇆  Redis Cache  ⇆  MySQL
│
├── SSE for today visitors (realtime)
└── Cron Jobs for daily aggregates

````

---

## Tech Stack
- **Fastify (Node.js + TypeScript)** – API framework  
- **MySQL + Sequelize** – Database & ORM  
- **Redis** – Cache layer  
- **node-cron** – Scheduler for aggregates  
- **Server-Sent Events (SSE)** – Live streaming  

---

## API Endpoints

### Visitors
| Method | Path                         | Description                                   |
|--------|------------------------------|-----------------------------------------------|
| GET    | `/api/visitors/today`        | Get today's visitor count                     |
| GET    | `/api/visitors/today/stream` | SSE stream: real-time today visitor count     |
| GET    | `/api/visitors/weekly`       | Get last 7 days daily counts                  |
| GET    | `/api/visitors/monthly`      | Get last 12 months totals                     |
| GET    | `/api/visitors/yearly`       | Get yearly totals (last 5 years)              |
| GET    | `/api/visitors/monthly/top`  | Get top 10 visitors for the current month     |
| GET    | `/api/visitors/yearly/top`   | Get top 10 visitors for the current year      |
| GET    | `/api/visitors/summary`      | Get combined visitor metrics                  |

---

### Books
| Method | Path                               | Description                                   |
|--------|------------------------------------|-----------------------------------------------|
| GET    | `/api/books/stats/collection`      | Get total unique titles and total items       |
| GET    | `/api/books/top/borrowed`          | Get top 10 borrowed books (all time)          |
| GET    | `/api/books/top/borrowed/month`    | Get top 10 borrowed books (current month)     |
| GET    | `/api/books/top/borrowed/year`     | Get top 10 borrowed books (current year)      |
| GET    | `/api/books/top/borrowers/month`   | Get top 10 borrowers (current month)          |
| GET    | `/api/books/top/borrowers/year`    | Get top 10 borrowers (current year)           |
| GET    | `/api/books/summary`               | Get combined book metrics (collection + top)  |

---

### Health & Docs
| Method | Path           | Description                        |
|--------|----------------|------------------------------------|
| GET    | `/health`      | Basic service health               |
| GET    | `/docs`        | Swagger UI API documentation       |
| GET    | `/docs/json`   | Raw OpenAPI spec (JSON format)     |

---

## Data Flow
1. **Startup:** Connect to MySQL & Redis, prewarm cache with initial snapshots.  
2. **Fast Loop:** Update today’s visitor count at short intervals and emit SSE events.  
3. **Daily Cron:** Recompute aggregates (weekly, monthly, yearly, top metrics) and refresh Redis.  
4. **API Request:**  
   - Realtime endpoints → fetch from Redis (short TTL, fallback DB if required).  
   - Aggregate endpoints → serve only from Redis (if cache missing → return `202 warming`).  

---

## Example Responses

**Visitor today (realtime):**
```json
{ "total": 125, "source": "cache" }
````

**SSE update event:**

```json
{ "total": 126, "generated_at": "2025-09-23T10:00:00Z" }
```

**Cache warming (202 response):**

```json
{ "status": "warming", "message": "weekly cache not ready", "retry_after_seconds": 5 }
```

---

## Development

```bash
npm install
npm run dev      # development mode
npm run build
npm start        # production server
```

---

## Key Features

* Realtime updates for today’s visitor count (SSE)
* Cache-first strategy for all aggregates
* 202 "warming" pattern to prevent DB overload during cold start
* Cron jobs + startup prewarm to keep cache fresh
* Health and docs endpoints for monitoring and testing

---


