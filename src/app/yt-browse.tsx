import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  confirmDeleteDownloads,
  downloadYt,
  useYtDownloads,
  ytInLibrary,
  type YtDownloadItem,
} from '@/catalog/ytDownloads';
import { DownloadsButton } from '@/components/DownloadsSheet';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { friendlyError } from '@/lib/net';
import { useUI } from '@/store/ui';
import { colors, radius, useAccent } from '@/theme';
import { isSong, playYt, SectionView } from '@/youtube/components';
import { browse, type YtPage, type YtSong } from '@/youtube/music';

function DownloadAllButton({ songs, albumTitle }: { songs: YtSong[]; albumTitle?: string }) {
  const items = useYtDownloads((s) => s.items);
  const downloaded = useYtDownloads((s) => s.downloaded);
  const showToast = useUI((s) => s.showToast);

  const status = useMemo(() => {
    let done = 0;
    let busy = 0;
    for (const s of songs) {
      const state = items[s.videoId];
      const inLib = !!(downloaded[s.videoId] || ytInLibrary(s.videoId));
      if (inLib || state?.status === 'done') {
        done++;
      } else if (state?.status === 'downloading' || state?.status === 'resolving' || state?.status === 'queued') {
        busy++;
      }
    }
    return { done, busy, total: songs.length };
  }, [songs, items, downloaded]);

  const allDone = status.done === status.total && status.total > 0;
  const isBusy = status.busy > 0;

  const handlePress = () => {
    if (allDone) {
      const saved = songs.filter((s) => !!ytInLibrary(s.videoId)).map((s) => s.videoId);
      if (!saved.length) return;
      tap('select');
      confirmDeleteDownloads(saved, {
        title:
          saved.length === 1 ? (songs.find((s) => s.videoId === saved[0])?.title ?? '') : (albumTitle ?? 'esta lista'),
        artwork: songs[0]?.thumbnail,
      });
      return;
    }
    if (isBusy) return;

    tap('medium');
    const toDownload: YtDownloadItem[] = songs
      .filter((s) => !ytInLibrary(s.videoId) && items[s.videoId]?.status !== 'done')
      .map((s) => ({
        videoId: s.videoId,
        title: s.title,
        artist: s.artist,
        album: s.album || albumTitle,
        thumbnail: s.thumbnail,
        duration: s.duration,
      }));

    if (toDownload.length) {
      downloadYt(toDownload);
      showToast('Guardando en tu biblioteca local…');
    }
  };

  return (
    <Pressable
      style={[styles.dlBtn, allDone && styles.dlBtnDone, isBusy && styles.dlBtnBusy]}
      onPress={isBusy ? undefined : handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        allDone
          ? 'Eliminar estas canciones de la biblioteca local'
          : 'Guardar todas las canciones en la biblioteca local'
      }
    >
      {isBusy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Icon name={allDone ? 'check-circle' : 'download'} size={18} color={allDone ? colors.accent : colors.text} />
      )}
      <Txt variant="bodyStrong" style={[styles.dlBtnText, allDone && { color: colors.accent }]}>
        {allDone
          ? `En tu biblioteca (${status.total}) · eliminar`
          : isBusy
            ? `Guardando en la biblioteca (${status.busy} pendientes)…`
            : status.done > 0
              ? `Guardar restantes (${status.total - status.done})`
              : `Guardar todo en la biblioteca (${status.total} canciones)`}
      </Txt>
    </Pressable>
  );
}

/** A YouTube Music playlist, album, artist or mood/genre page. */
export default function YtBrowse() {
  useAccent();
  const { browseId, params, title } = useLocalSearchParams<{ browseId: string; params?: string; title?: string }>();
  const [page, setPage] = useState<{ id: string; data?: YtPage; error?: string } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    browse(browseId, params || undefined, ctrl.signal)
      .then((data) => setPage({ id: browseId, data }))
      .catch((e: Error) => !ctrl.signal.aborted && setPage({ id: browseId, error: friendlyError(e) }));
    return () => ctrl.abort();
  }, [browseId, params]);

  const data = page?.id === browseId ? page.data : undefined;
  const header = data?.header;
  // The first shelf of songs is the page's track list; the rest are shelves.
  const main = useMemo(() => data?.sections.find((s) => s.items.filter(isSong).length >= 3), [data]);
  const songs = useMemo(() => {
    const raw = (main?.items.filter(isSong) ?? []) as YtSong[];
    const albumTitle = header?.title;
    const albumArtist = header?.subtitle?.split(' • ')?.[0];
    const albumCover = header?.thumbnail;
    return raw.map((s) => ({
      ...s,
      album: (s.album && s.album !== s.title ? s.album : albumTitle) || undefined,
      artist: s.artist || albumArtist || 'Artista desconocido',
      thumbnail: s.thumbnail || albumCover,
    }));
  }, [main, header]);
  const rest = data?.sections.filter((s) => s !== main) ?? [];
  const pageTitle = header?.title || title || 'YouTube Music';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={pageTitle} right={<DownloadsButton />} />
      {!data ? (
        <View style={styles.center}>
          {page?.error ? (
            <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center' }}>
              {page.error}
            </Txt>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )}
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(s, i) => `${s.title}${i}`}
          renderItem={({ item }) => <SectionView section={item} />}
          contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
          ListHeaderComponent={
            <View>
              {header?.thumbnail || header?.subtitle ? (
                <View style={styles.hero}>
                  {header.thumbnail ? (
                    <Artwork uri={header.thumbnail} seed={header.title} size={200} radius={radius.md} />
                  ) : null}
                  {header.subtitle ? (
                    <Txt variant="caption" style={{ textAlign: 'center' }} numberOfLines={3}>
                      {header.subtitle}
                    </Txt>
                  ) : null}
                </View>
              ) : null}
              {songs.length ? (
                <>
                  <View style={styles.actions}>
                    <Pressable
                      style={[styles.btn, { backgroundColor: colors.accent }]}
                      onPress={() => playYt(songs, 0)}
                      accessibilityRole="button"
                    >
                      <Icon name="play" color={colors.onAccent} />
                      <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
                        Reproducir
                      </Txt>
                    </Pressable>
                    <Pressable
                      style={styles.btn}
                      onPress={() => playYt(songs, Math.floor(Math.random() * songs.length), true)}
                      accessibilityRole="button"
                    >
                      <Icon name="shuffle-variant" />
                      <Txt variant="bodyStrong">Aleatorio</Txt>
                    </Pressable>
                  </View>
                  <DownloadAllButton songs={songs} albumTitle={pageTitle} />
                  {main ? <SectionView section={{ ...main, title: '' }} list /> : null}
                </>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            songs.length ? null : (
              <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center', padding: 32 }}>
                Esta página no tiene canciones.
              </Txt>
            )
          }
        />
      )}
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: 24 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
  },
  dlBtn: {
    marginHorizontal: 16,
    marginBottom: 12,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dlBtnDone: {
    borderColor: colors.accentSoft,
    backgroundColor: colors.surface,
  },
  dlBtnBusy: {
    borderColor: colors.accent,
  },
  dlBtnText: {
    fontSize: 14,
  },
});
