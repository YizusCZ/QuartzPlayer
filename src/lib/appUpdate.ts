/**
 * Updates from Quartz's GitHub releases, without sending APKs around.
 *
 * A little after launch (at most every 6 h, or on demand from Ajustes) the
 * latest release of the repo is checked; when its version is newer than the
 * installed one and it carries an .apk, a sheet offers it. The APK downloads
 * into the cache and Android's own installer takes over: the user confirms,
 * and Android only accepts it if it is signed with the same key as the
 * installed app (see plugins/withReleaseSigning.js).
 *
 * Publishing an update = a GitHub release tagged `v<version>` with the APK
 * attached (scripts/release.mjs does all of it).
 */
import { AppState } from 'react-native';
import { cacheDirectory, createDownloadResumable, deleteAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppUpdateModule } from '../../modules/app-update';
import { persistStorage } from '@/store/storage';

const REPO = 'YizusCZ/QuartzPlayer';
const CHECK_EVERY_MS = 6 * 3600_000;
const FIRST_CHECK_DELAY_MS = 8000;

export type UpdateInfo = { version: string; notes: string; url: string; size: number; page: string };

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';

type UpdateState = {
  status: UpdateStatus;
  info: UpdateInfo | null;
  /** 0…1 while downloading. */
  progress: number;
  error: string | null;
  /** The sheet is showing. */
  open: boolean;
  /** Downloaded APK, waiting for the installer. */
  file: string | null;
  // kept between launches
  lastCheck: number;
  /** "Más tarde" on this version: not offered again by itself. */
  skipped: string | null;
};

export const useAppUpdate = create<UpdateState>()(
  persist(
    (): UpdateState => ({
      status: 'idle',
      info: null,
      progress: 0,
      error: null,
      open: false,
      file: null,
      lastCheck: 0,
      skipped: null,
    }),
    {
      name: 'quartz.update',
      storage: persistStorage(),
      partialize: (s) => ({ lastCheck: s.lastCheck, skipped: s.skipped }) as UpdateState,
    },
  ),
);

const set = useAppUpdate.setState;

/** The installed version ("1.0.4"). */
export function installedVersion(): string {
  try {
    return AppUpdateModule?.installed().version ?? '';
  } catch {
    return '';
  }
}

/** -1, 0 or 1, comparing "1.2.10" style versions number by number. */
export function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = b
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

type Release = {
  tag_name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string; size: number }[];
};

/** Asks GitHub for the latest release. `manual`: from Ajustes (always shows the result). */
export async function checkForUpdate(manual = false) {
  if (!AppUpdateModule) return;
  const s = useAppUpdate.getState();
  if (s.status === 'checking' || s.status === 'downloading') return;
  set({ status: 'checking', error: null });
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    // No release published yet: nothing to offer.
    if (res.status === 404) return set({ status: 'latest', lastCheck: Date.now() });
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    const r = (await res.json()) as Release;
    const version = (r.tag_name ?? '').replace(/^v/i, '');
    const apk = r.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
    const newer = !!version && compareVersions(version, installedVersion()) > 0;
    if (!newer || !apk || r.draft || r.prerelease) return set({ status: 'latest', lastCheck: Date.now() });
    const info: UpdateInfo = {
      version,
      notes: (r.body ?? '').trim(),
      url: apk.browser_download_url,
      size: apk.size,
      page: r.html_url ?? `https://github.com/${REPO}/releases/latest`,
    };
    set({
      status: 'available',
      info,
      lastCheck: Date.now(),
      open: manual || useAppUpdate.getState().skipped !== version,
    });
  } catch (e) {
    set({
      status: 'error',
      error: (e as Error).message || 'Sin conexión',
      lastCheck: manual ? s.lastCheck : Date.now(),
    });
  }
}

/** "Más tarde": this version is not offered again on its own (Ajustes still shows it). */
export function postponeUpdate() {
  const v = useAppUpdate.getState().info?.version ?? null;
  set({ open: false, skipped: v });
}

export const openUpdateSheet = () => set({ open: true });

/** Downloads the APK (with progress) and opens the installer. */
export async function downloadUpdate() {
  const { info, status, file } = useAppUpdate.getState();
  if (!info || !AppUpdateModule || status === 'downloading') return;
  if (status === 'ready' && file) return install();
  const dir = `${cacheDirectory}updates/`;
  const dest = `${dir}Quartz-${info.version}.apk`;
  set({ status: 'downloading', progress: 0, error: null });
  try {
    await deleteAsync(dir, { idempotent: true });
    await makeDirectoryAsync(dir, { intermediates: true });
    const task = createDownloadResumable(info.url, dest, {}, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : info.size;
      if (total > 0) set({ progress: Math.min(1, p.totalBytesWritten / total) });
    });
    const done = await task.downloadAsync();
    if (!done || done.status >= 400) throw new Error('La descarga falló');
    set({ status: 'ready', progress: 1, file: done.uri });
    install();
  } catch (e) {
    set({ status: 'error', error: (e as Error).message || 'La descarga falló' });
  }
}

let waitingPermission = false;

/** Hands the APK to Android's installer (asking for the permission first, once). */
export function install() {
  const { file } = useAppUpdate.getState();
  if (!file || !AppUpdateModule) return;
  if (!AppUpdateModule.canInstall()) {
    // Android asks once: "Permitir de esta fuente". Coming back, the installer opens.
    waitingPermission = true;
    AppUpdateModule.openInstallPermission();
    return;
  }
  try {
    AppUpdateModule.install(file);
  } catch {
    set({ status: 'error', error: 'No se pudo abrir el instalador' });
  }
}

let started = false;

/** From app start: one quiet check a little after launch, and on returning after a long while. */
export function startUpdateChecks() {
  if (started || !AppUpdateModule) return;
  started = true;
  const due = () => Date.now() - useAppUpdate.getState().lastCheck > CHECK_EVERY_MS;
  setTimeout(() => due() && void checkForUpdate(), FIRST_CHECK_DELAY_MS);
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    if (waitingPermission) {
      waitingPermission = false;
      if (AppUpdateModule?.canInstall()) install();
      return;
    }
    if (due()) void checkForUpdate();
  });
}
