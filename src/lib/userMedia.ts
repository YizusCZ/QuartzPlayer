/**
 * Your own images and videos (playlist covers, video visualizers). Picks go
 * through the system photo picker (no storage permission on Android) and are
 * copied into the app's Documents so they survive cache clean-ups.
 *
 * Android may kill Quartz while the gallery is open (it's a big app and the
 * gallery a big activity). Each pick therefore records what it was for before
 * opening the picker, and `recoverPendingPick()` finishes the job on the next
 * launch.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useLibrary } from '@/store/library';
import { useMedia } from '@/store/media';
import { useUI } from '@/store/ui';

export type PickTarget =
  { kind: 'playlistCover'; id: string } | { kind: 'trackVideo'; id: string; title: string } | { kind: 'globalVideo' };

const PENDING = 'quartz.pendingPick';
/** Lets a closing sheet (an Android Dialog) finish before the picker activity starts. */
const SHEET_CLOSE_MS = 350;

function dir(name: 'covers' | 'videos'): Directory {
  const d = new Directory(Paths.document, name);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function keep(uri: string, folder: 'covers' | 'videos', fallbackExt: string): string {
  const src = new File(uri);
  const raw = src.extension || fallbackExt;
  const ext = raw.startsWith('.') ? raw : `.${raw}`;
  const dest = new File(dir(folder), `${Date.now().toString(36)}${ext}`);
  src.copySync(dest);
  return dest.uri;
}

/** Deletes a file we copied in; anything outside our folders is left alone. */
export function forgetUserFile(uri: string | null | undefined) {
  if (!uri || !uri.startsWith(Paths.document.uri)) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

const isVideo = (t: PickTarget) => t.kind !== 'playlistCover';

function apply(target: PickTarget, picked: string) {
  const toast = useUI.getState().showToast;
  if (target.kind === 'playlistCover') {
    const uri = keep(picked, 'covers', '.jpg');
    const p = useLibrary.getState().playlists.find((x) => x.id === target.id);
    if (!p) return forgetUserFile(uri);
    forgetUserFile(p.cover);
    useLibrary.getState().updatePlaylist(p.id, { cover: uri });
    toast('Imagen de la lista actualizada');
  } else if (target.kind === 'trackVideo') {
    const uri = keep(picked, 'videos', '.mp4');
    const m = useMedia.getState();
    forgetUserFile(m.trackVideos[target.id]);
    m.setTrackVideo(target.id, uri);
    toast(`Vídeo para “${target.title}”`);
  } else {
    const uri = keep(picked, 'videos', '.mp4');
    const m = useMedia.getState();
    forgetUserFile(m.globalVideo);
    m.setGlobalVideo(uri);
    toast('Vídeo para todas las canciones');
  }
}

function options(target: PickTarget): ImagePicker.ImagePickerOptions {
  // One tap picks: no multi-select "Done" step and no separate crop screen
  // (covers are centre-cropped to the square when shown).
  return {
    mediaTypes: isVideo(target) ? 'videos' : 'images',
    allowsMultipleSelection: false,
    selectionLimit: 1,
    allowsEditing: false,
    quality: isVideo(target) ? 1 : 0.9,
  };
}

/** Opens the gallery for `target` and stores the result. Call it right after closing a sheet. */
export function pick(target: PickTarget) {
  const toast = useUI.getState().showToast;
  setTimeout(() => {
    void (async () => {
      try {
        await AsyncStorage.setItem(PENDING, JSON.stringify(target));
        const res = await ImagePicker.launchImageLibraryAsync(options(target));
        await AsyncStorage.removeItem(PENDING);
        const asset = res.canceled ? undefined : res.assets?.[0];
        if (asset) apply(target, asset.uri);
      } catch (e) {
        await AsyncStorage.removeItem(PENDING).catch(() => {});
        toast(`No se pudo usar ${isVideo(target) ? 'ese vídeo' : 'esa imagen'}: ${(e as Error).message ?? e}`);
      }
    })();
  }, SHEET_CLOSE_MS);
}

/** Finishes a pick that was interrupted because Android closed the app. Call once at launch. */
export async function recoverPendingPick() {
  if (Platform.OS !== 'android') return;
  try {
    const raw = await AsyncStorage.getItem(PENDING);
    if (!raw) return;
    await AsyncStorage.removeItem(PENDING);
    const res = await ImagePicker.getPendingResultAsync();
    if (!res || !('assets' in res) || res.canceled || !res.assets?.[0]) return;
    await new Promise<void>((resolve) => {
      // Wait for the stores to load before writing into them.
      if (useLibrary.persist.hasHydrated() && useMedia.persist.hasHydrated()) return resolve();
      const check = () => useLibrary.persist.hasHydrated() && useMedia.persist.hasHydrated() && resolve();
      useLibrary.persist.onFinishHydration(check);
      useMedia.persist.onFinishHydration(check);
    });
    apply(JSON.parse(raw) as PickTarget, res.assets[0].uri);
  } catch {
    // nothing to recover
  }
}
