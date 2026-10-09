/**
 * State runtime yang dipakai `/healthz` untuk membuktikan konfigurasi clustering dari luar:
 * flag `reusePort` (SO_REUSEPORT) dan index proses anak yang benar-benar dipakai `Bun.serve`.
 *
 * Diisi sekali oleh `src/index.ts` saat server dinyalakan (satu proses = satu nilai), supaya
 * jawaban `/healthz` mencerminkan keadaan sebenarnya - bukan hasil hitung ulang dari env.
 */

export interface ServerInfo {
	reusePort: boolean;
	/** `null` = proses tunggal (bukan anak supervisor). */
	procIndex: number | null;
	accessLog: boolean;
}

export const serverInfo: ServerInfo = {
	reusePort: false,
	procIndex: null,
	accessLog: false
};

export function setServerInfo(info: Partial<ServerInfo>): void {
	Object.assign(serverInfo, info);
}
