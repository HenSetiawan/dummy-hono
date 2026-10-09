/**
 * Keputusan murni env -> rencana proses (diuji tanpa menyalakan server).
 *
 * Mode multi-proses memakai `SO_REUSEPORT`: supervisor men-spawn N anak yang menjalankan file
 * yang sama; semuanya bind `PORT` dengan `Bun.serve({ reusePort: true })` dan kernel membagi
 * koneksi baru ke salah satunya. Catatan penting (sama seperti CORE):
 * - pembagiannya **per koneksi**, bukan per request - satu koneksi keep-alive lengket ke satu
 *   proses, jadi keuntungan baru terasa kalau koneksi bersamaan banyak (persis pola load test);
 * - hanya efektif di Linux (container). Di Windows flag `reusePort` tidak membagi trafik.
 */

export const API_PROCS_ENV = "API_PROCS";
export const API_PROC_INDEX_ENV = "API_PROC_INDEX";
export const REUSE_PORT_ENV = "REUSE_PORT";

/** Batas atas: salah ketik (mis. `API_PROCS=400`) tidak boleh men-spawn proses liar. */
export const MAX_API_PROCS = 64;

export type ApiProcsPlan = { ok: true; procs: number } | { ok: false; message: string };

/**
 * `API_PROCS` kosong/`1` = satu proses (default), `auto`/`0` = jumlah core, angka lain =
 * jumlah itu (dijepit lewat validasi).
 */
export function parseApiProcs(raw: string | undefined, cores: number): ApiProcsPlan {
	const value = (raw ?? "").trim().toLowerCase();
	const maxCores = Math.max(1, Math.min(cores, MAX_API_PROCS));

	if (value === "" || value === "1") return { ok: true, procs: 1 };
	if (value === "auto" || value === "0") return { ok: true, procs: maxCores };

	if (!/^\d+$/.test(value)) {
		return {
			ok: false,
			message: `${API_PROCS_ENV}="${raw}" tidak valid; isi angka 1-${MAX_API_PROCS} atau "auto"`,
		};
	}

	const procs = Number(value);
	if (procs < 1 || procs > MAX_API_PROCS) {
		return {
			ok: false,
			message: `${API_PROCS_ENV}="${raw}" di luar rentang; isi 1-${MAX_API_PROCS} atau "auto"`,
		};
	}

	return { ok: true, procs };
}

/**
 * Index anak dari env internal `API_PROC_INDEX` (di-set supervisor, bukan operator).
 * `null` berarti proses ini bukan anak, jadi dia yang menjalankan supervisor.
 */
export function procIndexFromEnv(
	env: Record<string, string | undefined> = process.env
): number | null {
	const raw = (env[API_PROC_INDEX_ENV] ?? "").trim();
	if (!/^[1-9]\d*$/.test(raw)) return null;

	const index = Number(raw);
	return Number.isSafeInteger(index) ? index : null;
}

export type ReusePortPlan = { ok: true; reusePort: boolean } | { ok: false; message: string };

/**
 * `REUSE_PORT` mengatur flag `Bun.serve({ reusePort })` (= `SO_REUSEPORT`) secara eksplisit.
 *
 * - `auto` (default): menyala kalau `API_PROCS > 1` - satu supervisor + N anak berbagi port.
 * - `1`: selalu menyala. Ini yang dipakai untuk **clustering lintas container**: beberapa
 *   container (mis. `deploy.replicas: 4` dengan `network_mode: host`) masing-masing
 *   `API_PROCS=1` + `REUSE_PORT=1`, lalu kernel membagi koneksi baru ke semuanya.
 *   Konsekuensi yang harus disadari: dengan `REUSE_PORT=1`, proses kedua yang tak sengaja
 *   bind port yang sama **tidak** gagal `EADDRINUSE` - dia ikut melayani.
 * - `0`: selalu mati (single proses, gagal keras kalau port sudah dipakai).
 *
 * Hanya efektif di Linux; di Windows flag ini tidak membagi trafik.
 */
export function parseReusePort(raw: string | undefined, procs: number): ReusePortPlan {
	const value = (raw ?? "").trim().toLowerCase();

	if (value === "" || value === "auto") return { ok: true, reusePort: procs > 1 };
	if (value === "1" || value === "true" || value === "on") return { ok: true, reusePort: true };
	if (value === "0" || value === "false" || value === "off") return { ok: true, reusePort: false };

	return {
		ok: false,
		message: `${REUSE_PORT_ENV}="${raw}" tidak valid; isi auto, 1, atau 0`,
	};
}
