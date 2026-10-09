import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { MAX_ITEMS, clampSize, currentIsoTime } from "../src/random";

const app = createApp();

describe("GET /healthz", () => {
	test("membalas ok beserta pid proses", async () => {
		const response = await app.request("/healthz");
		const body = (await response.json()) as {
			status: string;
			service: string;
			pid: number;
			reusePort: boolean;
			procIndex: number | null;
		};

		expect(response.status).toBe(200);
		expect(body.status).toBe("ok");
		expect(body.service).toBe("dummy-api-hono");
		expect(body.pid).toBe(process.pid);
		// Test tidak menyalakan server, jadi nilainya default - yang penting field-nya ada
		// supaya clustering (SO_REUSEPORT) bisa diverifikasi dari luar.
		expect(body.reusePort).toBe(false);
		expect(body.procIndex).toBeNull();
	});
});

describe("GET /random/user", () => {
	test("mengembalikan satu user acak dan tidak di-cache", async () => {
		const response = await app.request("/random/user");
		const body = (await response.json()) as { id: string; name: string; email: string };

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(body.id).toMatch(/^usr-/);
		expect(body.name).toContain(" ");
		expect(body.email).toContain("@");
	});
});

describe("GET /random/items", () => {
	test("jumlah item mengikuti ?size dan dijepit ke batas aman", async () => {
		const defaulted = (await (await app.request("/random/items")).json()) as {
			items: unknown[];
			count: number;
		};
		const sized = (await (await app.request("/random/items?size=3")).json()) as {
			items: unknown[];
		};
		const huge = (await (await app.request("/random/items?size=9999")).json()) as {
			items: unknown[];
		};
		const zero = (await (await app.request("/random/items?size=0")).json()) as {
			items: unknown[];
		};

		expect(defaulted.items).toHaveLength(10);
		expect(defaulted.count).toBe(10);
		expect(sized.items).toHaveLength(3);
		expect(huge.items).toHaveLength(MAX_ITEMS);
		expect(zero.items).toHaveLength(1);
	});

	test("size tidak valid jatuh ke default, bukan error", async () => {
		expect(clampSize("abc")).toBe(10);
		expect(clampSize(undefined)).toBe(10);
		expect(clampSize("7.9")).toBe(7);
	});
});

describe("GET /random/stats", () => {
	test("mengembalikan angka metrik dan histogram 12 bucket", async () => {
		const response = await app.request("/random/stats");
		const body = (await response.json()) as {
			requests: number;
			p95Ms: number;
			histogram: number[];
			generatedAt: string;
		};

		expect(response.status).toBe(200);
		expect(body.requests).toBeGreaterThan(0);
		expect(body.p95Ms).toBeGreaterThan(0);
		expect(body.histogram).toHaveLength(12);
		expect(body.generatedAt).toBe(currentIsoTime());
	});
});

describe("rute tidak dikenal", () => {
	test("membalas 404 JSON, bukan halaman HTML", async () => {
		const response = await app.request("/tidak-ada");

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: "E_NOT_FOUND" });
	});
});
