# Runtime saja: Bun menjalankan TypeScript langsung, jadi tidak ada langkah build.
# Versi di-pin supaya sama dengan Bun di mesin lokal; override: --build-arg BUN_VERSION=x.y.z
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-alpine

WORKDIR /app

# Dependency dipisah dari source supaya layer ini tidak batal tiap kali kode berubah.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV PORT=9000
ENV NODE_ENV=production
EXPOSE 9000

# Tanpa I/O tulis (semua endpoint read-only), jadi tidak perlu direktori writable.
USER bun

# `init: true` di compose melengkapi reaping proses zombie untuk mode multi-proses.
CMD ["bun", "run", "src/index.ts"]
