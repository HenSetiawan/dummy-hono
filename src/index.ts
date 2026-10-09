import { availableParallelism } from "node:os";
import { app } from "./app.js";
import { setServerInfo } from "./server-info.js";
import {
	API_PROC_INDEX_ENV,
	API_PROCS_ENV,
	REUSE_PORT_ENV,
	parseApiProcs,
	parseReusePort,
	procIndexFromEnv
} from "./procs.js";

/**
 * Titik masuk DUMMY-API.
 *
 * Dua mode:
 * 1. `API_PROCS=1` (default) - satu proses Bun, satu `Bun.serve`.
 * 2. `API_PROCS>1` / `auto` - proses ini jadi supervisor: men-spawn N anak yang menjalankan
 *    file yang sama, semuanya bind `PORT` dengan `SO_REUSEPORT` supaya semua core terpakai.
 *
 * Opsi `Bun.serve` yang berpengaruh ke throughput:
 * - `reusePort` (`SO_REUSEPORT`) dari env `REUSE_PORT` - default `auto`: menyala kalau
 *   `API_PROCS > 1`. Single-proses bisa memaksanya dengan `REUSE_PORT=1` kalau memang ingin
 *   di-cluster lintas container (lihat README bagian Clustering);
 * - `idleTimeout: 30` menahan koneksi keep-alive load test lebih lama dari default 10 detik;
 * - `development: false` mematikan error page/stack trace yang menambah kerja per request.
 * Server dipanggil eksplisit (bukan default export Bun) karena opsi `reusePort` tidak dibaca
 * oleh server default.
 */

function parsePort(raw: string | undefined): number {
	const value = (raw ?? "").trim();
	if (value === "") return 9000;

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		console.error(`[dummy-api] PORT="${raw}" tidak valid; isi angka 1-65535`);
		process.exit(1);
	}

	return port;
}

const cores = availableParallelism?.() ?? 4;
const plan = parseApiProcs(process.env[API_PROCS_ENV], cores);
if (!plan.ok) {
	console.error(`[dummy-api] konfigurasi env tidak valid: ${plan.message}`);
	process.exit(1);
}

const port = parsePort(process.env.PORT);
const procIndex = procIndexFromEnv(process.env);

// Diputuskan di supervisor dan diteruskan ke anak sebagai nilai final (`1`/`0`), supaya
// `REUSE_PORT=auto` tidak berubah arti di anak (di anak `API_PROCS` sudah 1).
const reusePlan = parseReusePort(process.env[REUSE_PORT_ENV], plan.procs);
if (!reusePlan.ok) {
	console.error(`[dummy-api] konfigurasi env tidak valid: ${reusePlan.message}`);
	process.exit(1);
}

if (plan.procs > 1 && procIndex === null) {
	await runSupervisor(plan.procs, reusePlan.reusePort);
} else {
	runServer({ reusePort: reusePlan.reusePort });
}

/** Satu proses yang melayani request (dipakai langsung atau sebagai anak supervisor). */
function runServer(options: { reusePort: boolean }): void {
	setServerInfo({
		reusePort: options.reusePort,
		procIndex,
		accessLog: process.env.ACCESS_LOG === "1"
	});

	const server = Bun.serve({
		port,
		fetch: app.fetch,
		reusePort: options.reusePort,
		idleTimeout: 30,
		development: false
	});

	console.log(
		`[dummy-api] listen :${server.port} pid=${process.pid}` +
			`${procIndex === null ? "" : ` anak=${procIndex}`}` +
			` reusePort=${options.reusePort} accessLog=${process.env.ACCESS_LOG === "1"}`
	);
}

/**
 * Supervisor: spawn N anak, lalu berhenti kalau salah satu anak keluar (kernel tidak punya
 * health-aware removal, jadi lebih baik gagal jelas daripada melayani dengan sebagian proses).
 */
async function runSupervisor(procs: number, reusePort: boolean): Promise<void> {
	const children = new Map<number, Bun.Subprocess>();

	try {
		for (let index = 1; index <= procs; index += 1) {
			const child = Bun.spawn({
				cmd: [process.execPath, import.meta.path],
				env: {
					...process.env,
					[API_PROCS_ENV]: "1",
					[API_PROC_INDEX_ENV]: String(index),
					// Nilai final (bukan `auto`) supaya anak tidak menafsir ulang.
					[REUSE_PORT_ENV]: reusePort ? "1" : "0"
				},
				stdout: "inherit",
				stderr: "inherit"
			});
			children.set(index, child);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[dummy-api] gagal men-spawn proses anak: ${message}`);
		for (const child of children.values()) child.kill("SIGTERM");
		process.exit(1);
	}

	console.log(
		`[dummy-api] supervisor: ${procs} proses di :${port} (reusePort=${reusePort}, ` +
			"SO_REUSEPORT membagi koneksi baru antar proses)"
	);
	if (process.platform !== "linux") {
		console.warn(
			`[dummy-api] ${API_PROCS_ENV}>1 di ${process.platform}: SO_REUSEPORT tidak membagi ` +
				"koneksi antar proses di platform ini; jalankan di container Linux"
		);
	}

	let shuttingDown = false;
	const stopAll = (signal: "SIGTERM" | "SIGINT"): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		for (const child of children.values()) child.kill(signal);
	};

	process.on("SIGTERM", () => stopAll("SIGTERM"));
	process.on("SIGINT", () => stopAll("SIGINT"));

	await Promise.race([...children.values()].map((child) => child.exited));

	if (!shuttingDown) {
		const [index, child] = [...children.entries()].find(([, item]) => item.exitCode !== null) ?? [
			0,
			null
		];
		console.error(
			`[dummy-api] anak ${index} keluar (exit=${child?.exitCode ?? "?"}); menghentikan semua`
		);
		stopAll("SIGTERM");
		process.exit(1);
	}
}
