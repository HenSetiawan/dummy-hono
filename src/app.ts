import { Hono } from "hono";
import { clampSize, currentIsoTime, randomItems, randomStats, randomUser } from "./random.js";
import { serverInfo } from "./server-info.js";

/**
 * App DUMMY-API: **tiga endpoint GET** berisi data acak + `/healthz` untuk healthcheck
 * container. Semuanya stateless, tanpa I/O eksternal, dan tanpa middleware berat - tujuannya
 * jadi target load test (ribuan RPS), bukan aplikasi sungguhan.
 *
 * Contoh:
 *   GET /random/user          -> satu objek user acak (~200 B)
 *   GET /random/items?size=10 -> daftar item acak (size dijepit 1..50)
 *   GET /random/stats         -> angka metrik acak + histogram (~400 B)
 */

export interface AppOptions {
	/** Log satu baris per request (default mati: menyalakannya memotong throughput). */
	accessLog?: boolean;
}

export function createApp(options: AppOptions = {}): Hono {
	const app = new Hono();

	if (options.accessLog === true) {
		app.use("*", async (c, next) => {
			const startedAt = Bun.nanoseconds();
			await next();
			const durationMs = (Bun.nanoseconds() - startedAt) / 1e6;
			console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${durationMs.toFixed(2)}ms`);
		});
	}

	app.get("/healthz", (c) =>
		c.json({
			status: "ok",
			service: "dummy-api-hono",
			pid: process.pid,
			// Cermin konfigurasi clustering yang benar-benar dipakai `Bun.serve`.
			reusePort: serverInfo.reusePort,
			procIndex: serverInfo.procIndex,
			time: currentIsoTime()
		})
	);

	app.get("/random/user", (c) => {
		c.header("cache-control", "no-store");
		return c.json(randomUser());
	});

	app.get("/random/items", (c) => {
		const size = clampSize(c.req.query("size"));
		c.header("cache-control", "no-store");
		return c.json({ count: size, items: randomItems(size), generatedAt: currentIsoTime() });
	});

	app.get("/random/stats", (c) => {
		c.header("cache-control", "no-store");
		return c.json(randomStats());
	});

	app.notFound((c) => c.json({ error: "E_NOT_FOUND", path: c.req.path }, 404));

	return app;
}

export const app = createApp({ accessLog: Bun.env.ACCESS_LOG === "1" });
