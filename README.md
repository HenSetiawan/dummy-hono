# DUMMY-API (Bun + Hono) — target load test

API dummy untuk dipakai sebagai **upstream/target load test**: 3 endpoint GET berisi data
acak, tanpa database, tanpa I/O eksternal, dan tanpa middleware berat. Tujuannya bukan
fungsionalitas, tapi **stabil di ribuan request/detik** saat gateway/proxy diuji.

Port: **9000** (host) → 9000 (container). Berbeda dari DUMMY-API lama di k6 harness yang
menggunakan 8080/8081, jadi keduanya bisa jalan bersamaan.

## Endpoint

| Method | Path | Isi |
| --- | --- | --- |
| `GET` | `/random/user` | Satu objek user acak (~200 B): id, name, email, city, active, score, createdAt |
| `GET` | `/random/items?size=N` | Daftar `N` item acak (`size` dijepit 1..50, default 10) |
| `GET` | `/random/stats` | Angka metrik acak + histogram 12 bucket (~400 B) |
| `GET` | `/healthz` | `{ status, service, pid, time }` — dipakai healthcheck container |

Semua endpoint mengirim `cache-control: no-store` supaya angka acaknya tidak tersimpan di
proxy. Rute tak dikenal membalas `404` JSON (`E_NOT_FOUND`).

```sh
curl -s http://localhost:9000/random/user
curl -s "http://localhost:9000/random/items?size=5"
curl -s http://localhost:9000/random/stats
```

## Menjalankan

### Docker Compose (disarankan)

```sh
docker compose -f dummy-api-hono/docker-compose.yml up -d --build
curl -s http://localhost:9000/healthz
docker compose -f dummy-api-hono/docker-compose.yml logs -f dummy-api-hono
```

Compose menyetel hal yang penting untuk throughput tinggi: `API_PROCS=auto` (SO_REUSEPORT,
semua core), `ulimits.nofile=65535`, `net.core.somaxconn=4096`, dan healthcheck `/healthz`.

### Tanpa Docker

```sh
cd dummy-api-hono
bun install
bun run dev            # atau: bun run start
API_PROCS=auto bun run start   # multi-proses (Linux/WSL; di Windows tidak membagi koneksi)
```

## Mengukur RPS

Pengukur bawaan (tanpa dependency, keep-alive, dijalankan di mesin yang sama):

```sh
bun run bench                          # 5 dtk, 50 koneksi, ke http://127.0.0.1:9000
bun run bench http://127.0.0.1:9000 10 100
```

Untuk load test sungguhan, pakai k6 dari **network yang sama** (port publish/NAT bisa
memotong angka sampai ~4x):

```sh
docker compose -f dummy-api-hono/docker-compose.yml --profile k6 run --rm k6
# override beban: -e VUS=200 -e DURATION=30s
docker compose -f dummy-api-hono/docker-compose.yml --profile k6 run --rm -e VUS=200 k6
```

Service `k6` memakai skrip di `../k6` (`direct.js`) dengan `PATHS` diarahkan ke tiga endpoint
di atas, jadi tidak perlu setup tambahan. Skrip harness lain (`stress.js`, `soak.js`) bisa
dipakai dengan `-e DUMMY_URL=http://dummy-api-hono:9000`, tapi `lib/workload.js` mengharapkan
katalog `GET /__catalog` milik DUMMY-API lama (belum ada di sini — bilang saja kalau perlu).

## Env

| Env | Default | Arti |
| --- | --- | --- |
| `PORT` | `9000` | Port listen |
| `API_PROCS` | `1` | `1`, `auto`/`0` (= jumlah core), atau angka 1-64. `>1` = supervisor + N anak dengan `SO_REUSEPORT` |
| `ACCESS_LOG` | `0` | `1` = log per request (debug; memotong throughput) |

## Kenapa bisa kencang

- **Data acak dari pool yang sudah disiapkan** (`src/random.ts`): tiap request hanya indeks
  array + `Math.random()`, tanpa query, tanpa pembacaan berkas.
- **Timestamp ISO di-cache per detik** oleh satu timer; `new Date().toISOString()` per request
  jauh lebih mahal daripada nilainya.
- **Multi-proses + `SO_REUSEPORT`**: semua core terpakai tanpa load balancer eksternal
  (pembagiannya per koneksi, jadi baru terasa saat koneksi bersamaan banyak — pola k6).
- **Tanpa log/kompresi/body parser**: `ACCESS_LOG=0` default, tidak ada middleware kecuali
  diminta.
- **`idleTimeout: 30`** supaya koneksi keep-alive klien load test tidak diputus default 10 detik.

## Test

```sh
bun test          # endpoint (status, bentuk JSON, penjepitan ?size) + parsing API_PROCS
bun run typecheck
```

## Hasil ukur awal

Diukur di mesin pengembangan (14 core; klien dan server **berbagi mesin yang sama**, jadi angka
ini batas bawah - bukan kapasitas produksi):

| Cara | Beban | Hasil |
| --- | --- | --- |
| `bun run bench` (1 proses Bun, loopback) | 50 koneksi, 6 dtk | **18.265 RPS**, p95 4,8 ms, 0 error |
| k6 `direct.js` ke container lewat port publish | 100 VU, 20 dtk | **15.464 RPS** (bench) / 0 error |
| k6 `direct.js` di network compose (profil `k6`) | 100 VU, 20 dtk | **13.623 RPS**, 272.550 request, **0% gagal**, p95 21,9 ms, p99 46,8 ms |

Catatan: pada run k6 di atas CPU mesin sudah jenuh (14 proses API + k6 + service lain di satu
mesin), jadi yang membatasi adalah CPU total - bukan DUMMY-API-nya. Untuk angka kapasitas,
jalankan k6 dari mesin/container lain.
