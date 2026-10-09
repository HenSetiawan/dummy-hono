/**
 * Sumber data acak DUMMY-API.
 *
 * Semua pool (nama, kota, kategori) disiapkan sekali saat module load, sehingga tiap request
 * hanya melakukan indeks array + `Math.random()` - tanpa alokasi besar, tanpa I/O. Ini yang
 * membuat endpoint bisa melayani ribuan request/detik (lihat `scripts/bench.ts`).
 *
 * `currentIsoTime()` sengaja mengembalikan string yang di-cache per detik: `new Date()
 * .toISOString()` per request terukur jauh lebih mahal daripada satu timer 1 detik, sementara
 * nilai yang dikirim tetap masuk akal (presisi detik).
 */

const FIRST_NAMES = [
	"Budi",
	"Siti",
	"Agus",
	"Dewi",
	"Rizky",
	"Putri",
	"Bayu",
	"Intan",
	"Fajar",
	"Lestari",
	"Yoga",
	"Maya",
	"Rangga",
	"Nadia",
	"Eko",
	"Tiara",
	"Galih",
	"Ratna",
	"Dimas",
	"Sari"
];

const LAST_NAMES = [
	"Santoso",
	"Wijaya",
	"Pratama",
	"Nugroho",
	"Hidayat",
	"Saputra",
	"Kusuma",
	"Maulana",
	"Permata",
	"Halim",
	"Firmansyah",
	"Anggraini"
];

const CITIES = [
	"Jakarta",
	"Bandung",
	"Surabaya",
	"Yogyakarta",
	"Medan",
	"Makassar",
	"Denpasar",
	"Semarang",
	"Balikpapan",
	"Batam"
];

const DOMAINS = ["contoh.com", "example.test", "dummy.local", "mail.test", "sandbox.io"];

const CATEGORIES = [
	"electronics",
	"groceries",
	"furniture",
	"beauty",
	"fragrances",
	"kitchen",
	"sports",
	"toys"
];

const TAGS = ["promo", "baru", "terlaris", "diskon", "preorder", "lokal", "import", "hemat"];

const STATUS_CLASSES = ["success", "fail", "exception"] as const;

/** Batas `size` endpoint daftar; menjaga respons tetap kecil (dan tidak bisa dipakai DoS). */
export const MAX_ITEMS = 50;
export const DEFAULT_ITEMS = 10;

function pick<T>(pool: readonly T[]): T {
	return pool[(Math.random() * pool.length) | 0]!;
}

function randomInt(min: number, max: number): number {
	return min + ((Math.random() * (max - min + 1)) | 0);
}

function randomId(prefix: string): string {
	return `${prefix}-${randomInt(100000, 999999).toString(36)}${randomInt(100, 999).toString(36)}`;
}

let cachedIsoTime = new Date().toISOString();

setInterval(() => {
	cachedIsoTime = new Date().toISOString();
}, 1000);

/** Waktu ISO-8601 UTC, presisi detik (di-cache, bukan diformat tiap request). */
export function currentIsoTime(): string {
	return cachedIsoTime;
}

export interface RandomUser {
	id: string;
	name: string;
	email: string;
	city: string;
	active: boolean;
	score: number;
	createdAt: string;
}

export function randomUser(): RandomUser {
	const first = pick(FIRST_NAMES);
	const last = pick(LAST_NAMES);

	return {
		id: randomId("usr"),
		name: `${first} ${last}`,
		email: `${first.toLowerCase()}.${last.toLowerCase()}@${pick(DOMAINS)}`,
		city: pick(CITIES),
		active: Math.random() > 0.2,
		score: randomInt(0, 1000),
		createdAt: cachedIsoTime
	};
}

export interface RandomItem {
	id: string;
	name: string;
	category: string;
	price: number;
	stock: number;
	rating: number;
	tags: string[];
}

export function randomItem(index: number): RandomItem {
	return {
		id: `itm-${index + 1}`,
		name: `${pick(CATEGORIES)} ${pick(TAGS)} ${randomInt(1, 99)}`,
		category: pick(CATEGORIES),
		price: randomInt(1000, 5_000_000),
		stock: randomInt(0, 500),
		rating: randomInt(1, 50) / 10,
		tags: Math.random() > 0.5 ? [pick(TAGS), pick(TAGS)] : [pick(TAGS)]
	};
}

export function randomItems(size: number): RandomItem[] {
	const items: RandomItem[] = new Array(size);
	for (let index = 0; index < size; index += 1) items[index] = randomItem(index);
	return items;
}

export interface RandomStats {
	window: string;
	requests: number;
	success: number;
	fail: number;
	exception: number;
	status: (typeof STATUS_CLASSES)[number];
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	histogram: number[];
	generatedAt: string;
}

export function randomStats(): RandomStats {
	const success = randomInt(1_000, 90_000);
	const fail = randomInt(0, 2_000);
	const exception = randomInt(0, 200);
	const p50 = randomInt(3, 40);

	return {
		window: "1m",
		requests: success + fail + exception,
		success,
		fail,
		exception,
		status: pick(STATUS_CLASSES),
		p50Ms: p50,
		p95Ms: p50 + randomInt(10, 200),
		p99Ms: p50 + randomInt(200, 800),
		histogram: Array.from({ length: 12 }, () => randomInt(0, 5_000)),
		generatedAt: cachedIsoTime
	};
}

/** `?size=` -> jumlah item yang valid (default `DEFAULT_ITEMS`, dijepit 1..`MAX_ITEMS`). */
export function clampSize(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_ITEMS;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_ITEMS;

	return Math.min(Math.max(Math.trunc(parsed), 1), MAX_ITEMS);
}
