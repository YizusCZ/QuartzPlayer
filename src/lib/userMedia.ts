/**
 * Your own images and videos (playlist covers, video and GIF visualizers). Picks go
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
  | { kind: 'playlistCover'; id: string }
  | { kind: 'trackVideo'; id: string; title: string }
  | { kind: 'globalVideo' }
  | { kind: 'trackCover'; ids: string[]; label: string };

const PENDING = 'quartz.pendingPick';
/** Lets a closing sheet (an Android Dialog) finish before the picker activity starts. */
const SHEET_CLOSE_MS = 350;

function dir(name: 'covers' | 'videos' | 'stickers'): Directory {
  const d = new Directory(Paths.document, name);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

function keep(
  uri: string,
  folder: 'covers' | 'videos' | 'stickers',
  fallbackExt: string,
  name?: string | null,
): string {
  const src = new File(uri);
  // The original name keeps a GIF a .gif even when the picker's copy has no extension.
  const raw = (name && /\.\w{2,5}$/.exec(name)?.[0]) || src.extension || fallbackExt;
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

const isVideo = (t: PickTarget) => t.kind !== 'playlistCover' && t.kind !== 'trackCover';

/** Backgrounds can be a GIF (or a still picture) as well as a video. */
export const isImageBackground = (uri: string) => /\.(gif|webp|png|jpe?g|heic|avif)$/i.test(uri);

type Picked = { uri: string; mimeType?: string | null; fileName?: string | null };

function backgroundExt(p: Picked) {
  if (p.mimeType === 'image/gif') return '.gif';
  if (p.mimeType?.startsWith('image/')) return '.jpg';
  return '.mp4';
}

function apply(target: PickTarget, asset: Picked) {
  const picked = asset.uri;
  const toast = useUI.getState().showToast;
  if (target.kind === 'trackCover') {
    const uri = keep(picked, 'covers', '.jpg');
    useLibrary.getState().setCustomArtwork(target.ids, uri);
    toast(`Portada cambiada: ${target.label}`);
    return;
  }
  if (target.kind === 'playlistCover') {
    const uri = keep(picked, 'covers', '.jpg');
    const p = useLibrary.getState().playlists.find((x) => x.id === target.id);
    if (!p) return forgetUserFile(uri);
    forgetUserFile(p.cover);
    useLibrary.getState().updatePlaylist(p.id, { cover: uri });
    toast('Imagen de la lista actualizada');
  } else if (target.kind === 'trackVideo') {
    const uri = keep(picked, 'videos', backgroundExt(asset), asset.fileName);
    const m = useMedia.getState();
    forgetUserFile(m.trackVideos[target.id]);
    m.setTrackVideo(target.id, uri);
    toast(`${isImageBackground(uri) ? 'Fondo' : 'Vídeo'} para “${target.title}”`);
  } else {
    const uri = keep(picked, 'videos', backgroundExt(asset), asset.fileName);
    const m = useMedia.getState();
    forgetUserFile(m.globalVideo);
    m.setGlobalVideo(uri);
    toast(`${isImageBackground(uri) ? 'Fondo' : 'Vídeo'} para todas las canciones`);
  }
}

function options(target: PickTarget): ImagePicker.ImagePickerOptions {
  // One tap picks: no multi-select "Done" step and no separate crop screen
  // (covers are centre-cropped to the square when shown).
  return {
    // Backgrounds: videos and GIFs. Quality 1 keeps the file as it is (a GIF stays animated).
    mediaTypes: isVideo(target) ? ['videos', 'images'] : 'images',
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
        if (asset) apply(target, asset);
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
    apply(JSON.parse(raw) as PickTarget, res.assets[0]);
  } catch {
    // nothing to recover
  }
}

/** A picture from the gallery to use as a cassette sticker (copied into Documents/stickers). */
export async function pickStickerImage(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: false,
    selectionLimit: 1,
    quality: 0.85,
  });
  const asset = res.canceled ? undefined : res.assets?.[0];
  return asset ? keep(asset.uri, 'stickers', '.jpg') : null;
}
