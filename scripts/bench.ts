/**
 * Pengukur RPS sederhana tanpa dependency (memakai `fetch` Bun dengan keep-alive).
 *
 *   bun run bench                                  # 5 dtk, 50 koneksi, ke http://127.0.0.1:9000
 *   bun run bench http://127.0.0.1:9000 10 100     # 10 dtk, 100 koneksi
 *
 * Angka ini mengukur **sisi klien di mesin yang sama** (loopback): berguna untuk memastikan
 * DUMMY-API memang ringan, bukan sebagai angka produksi. Untuk load test sungguhan pakai k6
 * di network yang sama (lihat README).
 */

const target = (process.argv[2] ?? `http://127.0.0.1:${process.env.PORT ?? 9000}`).replace(
	/\/$/,
	""
);
const durationMs = Number(process.argv[3] ?? 5) * 1000;
const connections = Number(process.argv[4] ?? 50);
const paths = ["/random/user", "/random/items?size=10", "/random/stats", "/healthz"];

const latencies: number[] = new Array<number>(1_000_000);
let written = 0;
let errors = 0;
let running = true;

setTimeout(() => (running = false), durationMs);

async function worker(): Promise<void> {
	let index = 0;

	while (running) {
		const path = paths[index++ % paths.length]!;
		const startedAt = Bun.nanoseconds();

		try {
			const response = await fetch(`${target}${path}`);
			await response.arrayBuffer();
			if (!response.ok) errors += 1;
		} catch {
			errors += 1;
		}

		if (written < latencies.length) {
			latencies[written++] = (Bun.nanoseconds() - startedAt) / 1e6;
		}
	}
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: connections }, () => worker()));
const elapsedMs = Date.now() - startedAt;

const samples = latencies.slice(0, written).sort((left, right) => left - right);
const percentile = (value: number): number =>
	samples.length === 0
		? 0
		: Number(samples[Math.min(samples.length - 1, Math.floor(samples.length * value))]!.toFixed(2));
const total = samples.length + errors;

console.log(
	[
		`target          ${target}`,
		`durasi          ${(elapsedMs / 1000).toFixed(2)} dtk, ${connections} koneksi`,
		`request         ${total.toLocaleString("id-ID")} (error ${errors})`,
		`rps             ${Math.round((total / elapsedMs) * 1000).toLocaleString("id-ID")}`,
		`latensi rata2   ${(samples.reduce((sum, item) => sum + item, 0) / (samples.length || 1)).toFixed(2)} ms`,
		`p50 / p95 / p99 ${percentile(0.5)} / ${percentile(0.95)} / ${percentile(0.99)} ms`,
		`max             ${(samples[samples.length - 1] ?? 0).toFixed(2)} ms`
	].join("\n")
);

// Penanda module: skrip ini memakai `await` di top level.
export {};
