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

### Clustering: pakai lebih dari satu core

Dua cara, keduanya berbasis `SO_REUSEPORT` (kernel membagi **koneksi baru** ke semua proses
yang bind port yang sama; jadi pembagiannya per koneksi, bukan per request):

**1. Beberapa proses dalam satu container (default compose)** — `API_PROCS=auto`:

```sh
API_PROCS=auto REUSE_PORT=auto bun run start    # 1 supervisor + N anak (N = jumlah core)
```

Compose sudah memakai ini, dan log saat boot menunjukkan jumlahnya:
`[dummy-api] supervisor: 14 proses di :9000 (reusePort=true, ...)`.

**2. Beberapa container (replika) berbagi satu port** — tiap replika `API_PROCS=1`,
`REUSE_PORT=1`, dan **tanpa** port publish (pakai `network_mode: host` supaya bisa bind 9000
langsung di host):

```yaml
services:
  dummy-api-hono:
    network_mode: host
    environment:
      PORT: 9000
      API_PROCS: "1"
      REUSE_PORT: "1"
    deploy:
      replicas: 4
```

Catatan penting:

- Hanya efektif di **Linux**. Di Windows/macOS flag `reusePort` tidak membagi trafik.
- Dengan `REUSE_PORT=1`, proses kedua yang tidak sengaja bind port yang sama **tidak** gagal
  `EADDRINUSE` - dia ikut melayani. Kalau ingin jaminan "gagal keras", pakai `REUSE_PORT=0`.
- Kalau container dibatasi CPU (`cpus:`/`deploy.resources`), set `API_PROCS` manual agar
  jumlah anaknya tidak melebihi kuota (mis. `cpus: 2` → `API_PROCS=2`).

## Mengukur RPS

Pengukur bawaan (tanpa dependency, keep-alive, dijalankan di mesin yang sama):

```sh
bun run bench                          # 5 dtk, 50 koneksi, ke http://127.0.0.1:9000
bun run bench http://127.0.0.1:9000 10 100
```

Untuk load test sungguhan, jalankan k6 dari **network/mesin yang sama** (port publish/NAT bisa
memotong angka sampai ~4x). Service k6 **tidak** lagi ada di compose ini supaya compose-nya
fokus ke API-nya saja; script k6 dijalankan terpisah:

```sh
# di VM/network yang sama dengan API (lihat k6/README.md untuk pasang k6 + ulimit)
k6 run -e BASE_URL=http://172.16.30.11:9000 k6/rps-items.js

# atau lewat image k6 tanpa mount apa pun
docker run --rm -i --network host grafana/k6 run -e BASE_URL=http://127.0.0.1:9000 - < k6/rps-items.js
```

`k6/rps-items.js` melaporkan **RPS per tingkat VU** (default 200 → 1000, 1 menit/tingkat) ke
`/random/items`, dan script-nya berdiri sendiri sehingga bisa disalin apa adanya ke VM.
Langkah lengkap (pasang k6, `ulimit -n`, jalankan, baca tabel RPS) ada di
[`k6/README.md`](../k6/README.md#uji-rps-per-tingkat-vu-dual-apis-randomitems).

Skrip harness lain di `k6/` (`stress.js`, `soak.js`) mengharapkan katalog `GET /__catalog`
milik DUMMY-API lama (belum ada di sini — bilang saja kalau perlu).

## Env

| Env | Default | Arti |
| --- | --- | --- |
| `PORT` | `9000` | Port listen |
| `API_PROCS` | `1` | `1`, `auto`/`0` (= jumlah core), atau angka 1-64. `>1` = supervisor + N anak dengan `SO_REUSEPORT` |
| `REUSE_PORT` | `auto` | Flag `Bun.serve({ reusePort })` (`SO_REUSEPORT`): `auto` (menyala kalau `API_PROCS>1`), `1` (selalu), `0` (mati). Lihat bagian Clustering |
| `ACCESS_LOG` | `0` | `1` = log per request (debug; memotong throughput) |

## Kenapa bisa kencang

- **Data acak dari pool yang sudah disiapkan** (`src/random.ts`): tiap request hanya indeks
  array + `Math.random()`, tanpa query, tanpa pembacaan berkas.
- **Timestamp ISO di-cache per detik** oleh satu timer; `new Date().toISOString()` per request
  jauh lebih mahal daripada nilainya.
- **Multi-proses + `SO_REUSEPORT`** (`API_PROCS`, `REUSE_PORT`): semua core terpakai tanpa load
  balancer eksternal (pembagiannya per koneksi, jadi baru terasa saat koneksi bersamaan
  banyak — persis pola load test). Bisa juga lintas container (lihat Clustering).
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
