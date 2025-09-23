
# 📊 Library Dashboard Backend

<p align="center"><strong>Fast, cache-first analytics API for library visitors and borrowing statistics.</strong></p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Node.js-22.x-green.svg"></a>
  <a href="#"><img src="https://img.shields.io/badge/Framework-Fastify-blue.svg"></a>
  <a href="#"><img src="https://img.shields.io/badge/Database-MySQL-orange.svg"></a>
  <a href="#"><img src="https://img.shields.io/badge/Cache-Redis-red.svg"></a>
  <a href="#"><img src="https://img.shields.io/badge/License-MIT-purple.svg"></a>
</p>

---

## 🚀 About The Project

**Library Dashboard Backend** adalah API berperforma tinggi untuk analitik perpustakaan dengan latensi rendah.  
Menggunakan strategi **cache-first** untuk meringankan beban MySQL dan memastikan respons cepat.

### ✨ Fitur Utama
- ⚡ Real-time Visitor Count via **SSE**  
- 💾 Cache-first architecture dengan **Redis**  
- 🛡️ Database load protection  
- ⏳ Cache Warming (respon `202 Accepted` saat data belum siap)  
- 🔄 Automated daily aggregates dengan cron job  
- 📚 Swagger UI untuk dokumentasi API  

---

## 🏗️ Architecture Overview

Sistem ini memisahkan alur data real-time dan agregat untuk performa optimal:

```

Frontend ⇆ Fastify API ⇆ Redis ⇆ MySQL
│
├── SSE untuk real-time visitor count (hari ini)
└── Cron Jobs untuk agregasi harian

````

**Komponen utama:**
1. **Fastify API** → entrypoint & business logic  
2. **Redis Cache** → penyimpanan metrik agregat yang sudah diproses  
3. **MySQL** → source of truth (hanya diakses cron & real-time query singkat)  
4. **Cron Jobs** → query berat harian → simpan ke Redis  
5. **SSE** → streaming real-time ke frontend  

---

## 🛠️ Tech Stack

- **Server:** Fastify (Node.js + TypeScript)  
- **Database:** MySQL (ORM: Sequelize)  
- **Cache:** Redis  
- **Scheduler:** node-cron  
- **Realtime:** SSE  
- **Docs:** @fastify/swagger  

---

## ⚙️ Getting Started

### Prerequisites
- Node.js v18+  
- NPM / Yarn  
- MySQL Server  
- Redis Server  
- Git  

### Installation
```bash
git clone https://github.com/your-username/library-dashboard-backend.git
cd library-dashboard-backend
npm install
````

### Configuration

Salin file `.env.example` → `.env` lalu sesuaikan:

```env
# Server
PORT=3000
NODE_ENV=development

# MySQL (read-only user recommended)
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=readonly
MYSQL_PASSWORD=secret
MYSQL_DATABASE=library
MYSQL_POOL_LIMIT=10

# Redis
# Either provide REDIS_URL or host/port/password
# REDIS_URL=redis://:password@127.0.0.1:6379/0
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Dynamic fast loop (today count)
# Minimum gap between starts (ms) (actual cadence = max(interval, adaptive) + buffer + runTime)
VISITOR_SYNC_MIN_INTERVAL_MS=1000
# Extra buffer wait after each run (ms)
VISITOR_SYNC_BUFFER_MS=200

# Adaptive mode (optional). When enabled the loop can lower its effective interval based on average run duration.
# Enable adaptive logic: true / false
VISITOR_FAST_ADAPTIVE=false
# Average run duration * multiplier = target dynamic interval (before floors & min cap)
VISITOR_FAST_TARGET_MULTIPLIER=20
# Soft floor (will not go below unless minInterval is higher)
VISITOR_FAST_SOFT_FLOOR_MS=400
# Hard floor (absolute minimum effective interval)
VISITOR_FAST_HARD_FLOOR_MS=150

# (If you want very aggressive loop, e.g. ~300ms cadence, consider: 
# VISITOR_SYNC_MIN_INTERVAL_MS=600
# VISITOR_SYNC_BUFFER_MS=120
# VISITOR_FAST_ADAPTIVE=true
# VISITOR_FAST_TARGET_MULTIPLIER=18
# VISITOR_FAST_SOFT_FLOOR_MS=250
# VISITOR_FAST_HARD_FLOOR_MS=120 )

# Slow cron (weekly + monthly + yearly aggregates) runs daily at 00:05
VISITOR_SLOW_CRON=0 5 0 * * *

# Today counting mode:
# direct       -> query DB every time (range predicate)
# incremental  -> Redis rolling counter + periodic reconcile
# delta        -> baseline (count + max id) then only count new rows (no write hook needed)
TODAY_COUNT_MODE=direct

# SSE enable flag (future use; currently SSE always on for /api/visitors/today/stream)
ENABLE_SSE_TODAY=true

```

### Running

Development (auto-restart):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

Server jalan di [http://localhost:3000](http://localhost:3000)

---

## 🔗 API Endpoints

<details>
<summary><strong>Visitors</strong></summary>

* `GET /api/visitors/today` → jumlah pengunjung hari ini (cache TTL pendek)
* `GET /api/visitors/today/stream` → real-time SSE
* `GET /api/visitors/weekly` → data 7 hari terakhir
* `GET /api/visitors/monthly` → data 12 bulan terakhir
* `GET /api/visitors/yearly` → data 5 tahun terakhir
* `GET /api/visitors/monthly/top` → top 10 visitor bulan ini
* `GET /api/visitors/yearly/top` → top 10 visitor tahun ini
* `GET /api/visitors/summary` → ringkasan semua metrik visitor

</details>

<details>
<summary><strong>Books</strong></summary>

* `GET /api/books/stats/collection` → total judul unik & eksemplar
* `GET /api/books/top/borrowed` → top 10 buku paling dipinjam (all time)
* `GET /api/books/top/borrowed/month` → top 10 bulan ini
* `GET /api/books/top/borrowed/year` → top 10 tahun ini
* `GET /api/books/top/borrowers/month` → top 10 peminjam bulan ini
* `GET /api/books/top/borrowers/year` → top 10 peminjam tahun ini
* `GET /api/books/summary` → ringkasan semua metrik buku

</details>

<details>
<summary><strong>Health & Docs</strong></summary>

* `GET /health` → service health check
* `GET /docs` → Swagger UI
* `GET /docs/json` → raw OpenAPI spec (JSON)

</details>

---

## 🧩 Core Concepts

### Cache Warming

Jika data belum ada di cache:

* **HTTP 202 Accepted**
* Response contoh:

```json
{
  "status": "warming",
  "message": "Weekly visitor data is being computed. Please try again shortly.",
  "retry_after_seconds": 10
}
```

### Response Example

**Cached Result:**

```json
{
  "total": 125,
  "source": "cache",
  "last_updated": "2025-09-23T12:00:34Z"
}
```

**SSE Event:**

```
{
    "total": 0,
    "generated_at": "2025-09-23T12:10:16.120Z"
}
```


