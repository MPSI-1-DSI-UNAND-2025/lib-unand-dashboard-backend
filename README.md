<div align="center">

# Library Dashboard Backend

Fast, cache-first analytics service for library visitor & borrowing statistics.

</div>

## 1. Ringkas Konsep
Hanya SATU metrik yang benar‑benar real‑time: jumlah pengunjung hari ini. Sisanya (mingguan, bulanan, tahunan, top visitors, top borrowed books, top borrowers) di-*freeze* sekali per hari lewat cron + prewarm saat startup, lalu disajikan full dari Redis (tanpa kueri DB per request). Ini menstabilkan beban MySQL dan membuat respon API konsisten dan cepat.

## 2. Arsitektur Tingkat Tinggi
```text
┌────────────────────┐        ┌──────────────────────┐
│  Frontend / Client │  HTTP  │ Fastify API Layer    │
│  - Dashboard UI    ├────────►  (Routes + Validation│
└────────────────────┘        │   + SSE for today)    │
                              └─────────┬────────────┘
                                        │
                              (Redis first, DB fallback only for today)
                                        │
                           ┌────────────▼────────────┐
                           │        Redis Cache       │
                           │  - Prewarmed snapshots   │
                           │  - Today count (short)   │
                           └────────────┬────────────┘
                                        │ (batch loads)
                              ┌─────────▼───────────┐
                              │      MySQL DB        │
                              │  (loan, item, biblio │
                              │   member, visitor)   │
                              └─────────┬───────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │   Schedulers / Jobs             │
                       │  • Fast Loop (today visitors)   │
                       │  • Daily Cron (all aggregates)  │
                       │  • Startup Prewarm              │
                       └─────────────────────────────────┘
```

## 3. Komponen Utama
| Komponen | Fungsi | Frekuensi |
|----------|--------|-----------|
| Fast Loop (visitor today) | Mengupdate jumlah pengunjung hari ini & emit SSE | Detik-level (tergantung interval) |
| Daily Cron | Regenerasi semua agregat non-real-time (visitor & books) | 1x per hari |
| Prewarm Startup | Mengisi cache agar tidak ada 202 warming setelah boot | Saat aplikasi start |
| Redis | Single source of truth untuk semua agregat non-real-time | — |
| SSE Endpoint | Menyajikan stream update jumlah pengunjung hari ini | Live |
| ORM (Sequelize) | Query relational untuk statistik buku/peminjam | Hanya saat prewarm/cron |

## 4. Alur Data (Detail)
1. Aplikasi start → koneksi MySQL + Redis → prewarm aggregator (pengunjung & buku) → tulis snapshot ke Redis (menyertakan metadata `generated_at`, `ttl_seconds`).
2. Fast loop mulai berulang menghitung ulang `today` (low latency) kemudian:
   - Set key Redis `visitors:today:count` (TTL pendek, misal 2x interval).
   - Emit event SSE ke semua klien yang subscribe.
3. Cron harian (misal jam 00:05) menjalankan ulang batch agregat (weekly, monthly, yearly, top, books, borrowers) → tulis ulang snapshot + perbarui metadata.
4. Request API:
   - Jika endpoint real-time: ambil dari Redis; fallback → kueri DB sekali & set TTL pendek.
   - Jika endpoint agregat: HANYA baca cache. Bila belum siap → kembalikan 202 (warming) tanpa kueri DB langsung.
5. Frontend menampilkan data stabil dan hanya perlu refresh manual (atau polling jarang) kecuali untuk today count yang bisa pakai SSE.

## 5. Pola Respons & Kontrak Cache
Semua agregat (non-today) disimpan dengan format:
```json
{
  "generated_at": "2025-09-23T00:05:12.345Z",
  "ttl_seconds": 90000,
  "data": [ ... ]
}
```
Jika cache belum tersedia: API merespons HTTP 202:
```json
{ "status": "warming", "message": "<description>", "retry_after_seconds": 5 }
```

## 6. Endpoint Kategori

### 6.1 Real-Time & Streaming
| Method | Path | Deskripsi | Sumber |
|--------|------|-----------|--------|
| GET | `/api/visitors/today` | Jumlah pengunjung hari ini (cache → fallback DB) | Redis / DB fallback |
| GET | `/api/visitors/today/stream` | SSE stream update realtime today count | SSE (EventSource) |

### 6.2 Visitor Aggregates (Cache-Only)
| Method | Path | Data | Warm Behavior |
|--------|------|------|---------------|
| GET | `/api/visitors/weekly` | 7 hari terakhir (daily) | 202 jika belum siap |
| GET | `/api/visitors/monthly` | 12 bulan terakhir | 202 jika belum siap |
| GET | `/api/visitors/yearly` | 5 tahun terakhir | 202 jika belum siap |
| GET | `/api/visitors/monthly/top` | Top 10 visitor bulan berjalan | 202 jika belum siap |
| GET | `/api/visitors/yearly/top` | Top 10 visitor tahun berjalan | 202 jika belum siap |
| GET | `/api/visitors/summary` | Bundle multi-metrik (cache summary) | 202 jika belum siap (kecuali today ditampilkan minimal) |

### 6.3 Book & Borrowing Aggregates (Cache-Only)
| Method | Path | Data |
|--------|------|------|
| GET | `/api/books/top-borrowed` | Top 10 buku paling banyak dipinjam (all time) |
| GET | `/api/books/top-borrowed/month` | Top 10 buku bulan berjalan |
| GET | `/api/books/top-borrowed/year` | Top 10 buku tahun berjalan |
| GET | `/api/books/top-borrowers/month` | Top 10 peminjam bulan berjalan |
| GET | `/api/books/top-borrowers/year` | Top 10 peminjam tahun berjalan |
| GET | `/api/books/collection` | Statistik koleksi (judul unik & total item) |
| GET | `/api/books/summary` | Ringkasan semua metrik buku |

Semua di atas: 202 warming jika cache belum ada (tidak ada fallback query langsung).

## 7. SSE (Server-Sent Events) Today Visitors
Route: `GET /api/visitors/today/stream`

Event types:
| Event | Payload | Kapan |
|-------|---------|-------|
| `init` | `{ total, source, at }` | Saat koneksi pertama berhasil |
| `update` | `{ total, generated_at }` | Setiap fast loop update |
| (heartbeat) | `: keepalive` | Tiap ±15s agar koneksi tidak idle timeout |

Contoh client sederhana (browser):
```js
const es = new EventSource('/api/visitors/today/stream');
es.addEventListener('init', e => console.log('init', JSON.parse(e.data)));
es.addEventListener('update', e => console.log('update', JSON.parse(e.data)));
```

## 8. Strategi Caching & TTL
| Key / Tipe | Isi | TTL | Refresh Sumber |
|------------|-----|-----|----------------|
| `visitors:today:count` | Counter hari ini | ~2x interval fast loop | Fast loop |
| Weekly / Monthly / Yearly / Top | Snapshot array + meta | 90000s (~25h) | Daily cron & startup prewarm |
| Books & Borrowers snapshots | Top & koleksi | 90000s | Daily cron & startup prewarm |
| Summary (opsional jika digunakan) | Bundle multi visitor metrics | (bisa diatur) | Cron / manual compose |

TTL > 24h memberi grace period jika cron terlambat (downtime singkat/tunda eksekusi).

## 9. Mode Penghitungan Today Visitors
Env: `TODAY_COUNT_MODE=direct|incremental|delta` (implementation aware di service)

| Mode | Karakteristik | Beban DB | Catatan |
|------|---------------|----------|---------|
| direct | COUNT range harian penuh | Paling tinggi | Sederhana, baseline default |
| incremental | Basis + delta INCR | Rendah | Butuh kontrol di jalur tulis |
| delta | COUNT awal + hitung penambahan berdasarkan PK > baseline | Sangat rendah | Ideal jika ada auto-increment & data besar |

## 10. Startup Sequence
1. Inisialisasi koneksi Sequelize / mysql2 (dengan retry)
2. Prewarm visitor aggregates & book aggregates (Promise.allSettled)
3. Mulai fast loop (today)
4. Register cron harian (visitor & books)
5. Server siap terima traffic (sebagian besar cache sudah panas)

## 11. Environment Variabel Utama
| Var | Deskripsi |
|-----|-----------|
| `PORT` | Port HTTP server |
| `MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE` | Kredensial MySQL |
| `REDIS_URL` | Koneksi Redis (redis://...) |
| `USE_SEQUELIZE` | Pakai Sequelize untuk query buku/loan (`true/false`) |
| `TODAY_COUNT_MODE` | Mode hitung today (lihat tabel) |
| `VISITOR_SYNC_MIN_INTERVAL_MS` | Interval minimal fast loop |
| `VISITOR_SYNC_BUFFER_MS` | Buffer setelah selesai loop |
| `VISITOR_SLOW_CRON` | Jadwal cron visitor agregat |
| `BOOKS_SLOW_CRON` | Jadwal cron agregat buku |
| `ENABLE_SSE_TODAY` (opsional future) | Flag mematikan SSE |

Lihat `.env.example` untuk daftar lengkap.

## 12. Query & Index Best Practice
| Area | Rekomendasi |
|------|-------------|
| Today count | Index pada kolom tanggal (`checkin_date`) |
| Delta mode | Tambah index komposit `(checkin_date, visitor_id)` untuk seleksi cepat & delta range |
| Loan aggregations | Index di kolom sering difilter `loan_date`, serta foreign key `item_code`, `member_id`, `biblio_id` |
| Top borrowed | Pastikan join path `loan.item_code -> item.item_code -> item.biblio_id -> biblio` indeks | 

## 13. Pola 202 Warming
Endpoint agregat TIDAK akan langsung kueri DB jika cache miss. Ini mencegah thundering herd saat cold start. Frontend dapat:
1. Mendapat 202 → tampilkan spinner / status “Menyiapkan data…”.
2. Retry setelah `retry_after_seconds`.

## 14. Development
```bash
npm install
npm run dev          # watch mode (tsx)
```
Server default: `http://localhost:3000`

Build produksi:
```bash
npm run build
npm start
```

## 15. OpenAPI / Docs
Swagger UI: `/docs`
Spec JSON: `/docs/json`
Non-produksi disarankan; bisa diproteksi environment flag sebelum register plugin.

## 16. Contoh Respons Real-Time Today
```json
{ "total": 312, "source": "cache" }
```
SSE update event JSON:
```json
{ "total": 313, "generated_at": "2025-09-23T09:10:22.111Z" }
```

## 17. Observability (Ide Lanjutan)
| Item | Ide |
|------|-----|
| Metrics | Ekspor Prometheus: loop duration, cache hit rate |
| Health | Endpoint: last cron run, age of snapshots |
| Alerts | Jika `generated_at` > 30 jam → trigger warning |
| Throttle | Adaptive interval jika durasi loop > ambang |

## 18. Roadmap (Opsional)
- Health & metrics endpoint
- Feature flag SSE (`ENABLE_SSE_TODAY`)
- Prometheus exporter
- Adaptive fast loop (meningkatkan interval bila QPS tinggi)
- Bandwidth optimization (coalesce SSE updates jika burst)

## 19. Lisensi
Internal / private (sesuaikan kebutuhan Anda).

---
Jika Anda menambah metrik baru: definisikan service → tambahkan key cache → masukkan ke cron/prewarm → buat route cache-only (202 warming) → (opsional) tambahkan ke summary. Pertahankan prinsip: DB hanya disentuh secara terjadwal atau untuk today count.

Selamat membangun dashboard yang cepat & efisien 🚀



