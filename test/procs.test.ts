import { describe, expect, test } from "bun:test";
import { MAX_API_PROCS, parseApiProcs, procIndexFromEnv } from "../src/procs";

describe("parseApiProcs", () => {
	test("kosong atau 1 berarti satu proses", () => {
		expect(parseApiProcs(undefined, 8)).toEqual({ ok: true, procs: 1 });
		expect(parseApiProcs("", 8)).toEqual({ ok: true, procs: 1 });
		expect(parseApiProcs(" 1 ", 8)).toEqual({ ok: true, procs: 1 });
	});

	test("auto/0 memakai jumlah core", () => {
		expect(parseApiProcs("auto", 6)).toEqual({ ok: true, procs: 6 });
		expect(parseApiProcs("0", 6)).toEqual({ ok: true, procs: 6 });
		// Mesin dengan core sangat banyak tetap dijepit pagar.
		expect(parseApiProcs("auto", 512)).toEqual({ ok: true, procs: MAX_API_PROCS });
	});

	test("angka eksplisit dipakai apa adanya", () => {
		expect(parseApiProcs("4", 8)).toEqual({ ok: true, procs: 4 });
	});

	test("nilai tidak valid ditolak dengan pesan env-nya", () => {
		const bad = parseApiProcs("banyak", 8);
		expect(bad.ok).toBe(false);
		expect(bad.ok === false && bad.message).toContain("API_PROCS");

		const tooBig = parseApiProcs("999", 8);
		expect(tooBig.ok).toBe(false);
	});
});

describe("procIndexFromEnv", () => {
	test("hanya menganggap anak kalau index positif", () => {
		expect(procIndexFromEnv({ API_PROC_INDEX: "2" })).toBe(2);
		expect(procIndexFromEnv({ API_PROC_INDEX: "0" })).toBeNull();
		expect(procIndexFromEnv({ API_PROC_INDEX: "-1" })).toBeNull();
		expect(procIndexFromEnv({ API_PROC_INDEX: "anak" })).toBeNull();
		expect(procIndexFromEnv({})).toBeNull();
	});
});
