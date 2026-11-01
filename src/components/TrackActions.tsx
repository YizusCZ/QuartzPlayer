import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Player } from '@/audio/engine';
import {
  confirmDeleteDownloads,
  downloadYt,
  useYtDownloads,
  ytInLibrary,
  type YtDownloadItem,
} from '@/catalog/ytDownloads';
import { deleteImported } from '@/library/scanner';
import type { Track } from '@/library/types';
import { pick } from '@/lib/userMedia';
import { trackById, useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { colors, fonts, useAccent } from '@/theme';
import { Artwork } from './ui/Artwork';
import { FormatBadge } from './ui/FormatBadge';
import { Sheet, SheetItem, SheetTitle } from './ui/Sheet';
import { Txt } from './ui/Txt';

/** Global sheets driven by `useUI`: per-track actions and "add to playlist". */
export function TrackActions() {
  useAccent();
  const { actionsFor, actionsCtx, addToPlaylist, close, pickPlaylist, showToast, openCover } = useUI();
  const track = useLibrary((s) => trackById(s, actionsFor ?? undefined));
  const fav = useLibrary((s) => (actionsFor ? !!s.favorites[actionsFor] : false));
  const playlists = useLibrary((s) => s.playlists);
  const ytDlState = useYtDownloads((s) => {
    if (!track || track.source !== 'youtube') return undefined;
    const videoId = track.uri.slice(3);
    return s.items[videoId];
  });
  const coverId = useUI((s) => s.coverFor);
  const coverFor = useLibrary((s) => trackById(s, coverId ?? undefined)) ?? null;
  const setCoverFor = (t: Track | null) => openCover(t?.id ?? null);

  /** Every song of the same album (your files and streamed ones). */
  const albumIds = (t: Track) => {
    const { tracks, remote } = useLibrary.getState();
    const artist = t.albumArtist ?? t.artist;
    return [...Object.values(tracks), ...Object.values(remote)]
      .filter((x) => x.album === t.album && (x.albumArtist ?? x.artist) === artist)
      .map((x) => x.id);
  };

  const act = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <Sheet visible={!!track} onClose={close}>
        {track ? (
          <ScrollView bounces={false}>
            <View style={styles.head}>
              <Artwork uri={track.artwork} seed={track.album} size={56} radius={8} />
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="heading" numberOfLines={1}>
                  {track.title}
                </Txt>
                <Txt variant="caption" numberOfLines={1}>
                  {track.artist} — {track.album}
                </Txt>
                <FormatBadge format={track.format} compact />
              </View>
            </View>
            <SheetItem
              icon="skip-next"
              label="Reproducir a continuación"
              onPress={act(() => (Player.playNext(track.id), showToast('Se reproducirá a continuación')))}
            />
            <SheetItem
              icon="playlist-play"
              label="Añadir a la cola"
              onPress={act(() => (Player.enqueue([track.id]), showToast('Añadida a la cola')))}
            />
            <SheetItem icon="playlist-plus" label="Añadir a una lista…" onPress={() => pickPlaylist([track.id])} />
            {actionsCtx ? (
              <SheetItem
                icon="playlist-remove"
                label="Quitar de esta lista"
                onPress={act(() => {
                  useLibrary.getState().removeFromPlaylist(actionsCtx.playlistId, actionsCtx.index);
                  showToast('Quitada de la lista');
                })}
              />
            ) : null}
            <SheetItem
              icon={fav ? 'heart' : 'heart-outline'}
              label={fav ? 'Quitar de favoritas' : 'Añadir a favoritas'}
              onPress={act(() => useLibrary.getState().toggleFavorite(track.id))}
            />
            <SheetItem
              icon="album"
              label="Ir al álbum"
              onPress={act(() =>
                router.push({
                  pathname: '/songs',
                  params: {
                    filter: 'album',
                    value: `${track.albumArtist ?? track.artist}\u0000${track.album}`,
                    title: track.album,
                  },
                }),
              )}
            />
            <SheetItem
              icon="account-music"
              label="Ir al artista"
              onPress={act(() =>
                router.push({
                  pathname: '/songs',
                  params: {
                    filter: 'artist',
                    value: track.albumArtist ?? track.artist,
                    title: track.albumArtist ?? track.artist,
                  },
                }),
              )}
            />
            <SheetItem
              icon="image-edit-outline"
              label="Cambiar portada…"
              onPress={() => {
                const t = track;
                close();
                setTimeout(() => setCoverFor(t), 300);
              }}
            />
            <SheetItem
              icon="information-outline"
              label="Información técnica"
              onPress={act(() => router.push({ pathname: '/info', params: { id: track.id } }))}
            />
            {track.source === 'youtube'
              ? (() => {
                  const videoId = track.uri.slice(3);
                  const inLib = !!ytInLibrary(videoId);
                  const dlDone = inLib || ytDlState?.status === 'done';
                  const dlBusy =
                    !inLib &&
                    (ytDlState?.status === 'downloading' ||
                      ytDlState?.status === 'resolving' ||
                      ytDlState?.status === 'queued');
                  const dlErr = !inLib && ytDlState?.status === 'error';
                  const progressPct =
                    ytDlState?.status === 'downloading' && ytDlState.progress != null
                      ? Math.round(ytDlState.progress * 100)
                      : null;
                  return (
                    <SheetItem
                      icon={dlDone ? 'check-circle' : dlBusy ? 'progress-download' : dlErr ? 'refresh' : 'download'}
                      label={
                        dlDone
                          ? 'En tu biblioteca local'
                          : dlBusy
                            ? 'Guardando en la biblioteca…'
                            : dlErr
                              ? 'Reintentar guardado'
                              : 'Guardar en biblioteca local'
                      }
                      detail={
                        dlDone
                          ? 'Eliminar'
                          : dlBusy && progressPct != null
                            ? `${progressPct}%`
                            : dlErr
                              ? ytDlState?.message
                              : undefined
                      }
                      selected={dlDone}
                      onPress={
                        dlDone
                          ? () => {
                              const t = track;
                              close();
                              // Let this sheet finish closing before the dialog opens.
                              setTimeout(
                                () => confirmDeleteDownloads([videoId], { title: t.title, artwork: t.artwork }),
                                300,
                              );
                            }
                          : dlBusy
                            ? () => {}
                            : act(() => {
                                const item: YtDownloadItem = {
                                  videoId,
                                  title: track.title,
                                  artist: track.artist,
                                  album: track.album,
                                  thumbnail: track.artwork,
                                  duration: track.duration,
                                };
                                downloadYt([item]);
                                showToast('Guardando en tu biblioteca local…');
                              })
                      }
                    />
                  );
                })()
              : null}
            {track.source === 'imported' ? (
              <SheetItem
                icon="delete-outline"
                label="Eliminar archivo importado"
                danger
                onPress={act(() =>
                  Alert.alert(
                    'Eliminar archivo',
                    `¿Eliminar “${track.title}” de Quartz? El archivo importado se borrará.`,
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Eliminar', style: 'destructive', onPress: () => deleteImported(track) },
                    ],
                  ),
                )}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </Sheet>

      <Sheet visible={!!coverFor} onClose={() => setCoverFor(null)}>
        {coverFor ? (
          <>
            <SheetTitle sub="Solo en Quartz: Discord sigue mostrando la portada original">Cambiar portada</SheetTitle>
            <SheetItem
              icon="music-note"
              label="Solo esta canción"
              detail={coverFor.title}
              onPress={() => {
                setCoverFor(null);
                pick({ kind: 'trackCover', ids: [coverFor.id], label: coverFor.title });
              }}
            />
            <SheetItem
              icon="album"
              label="Todo el álbum"
              detail={coverFor.album}
              onPress={() => {
                setCoverFor(null);
                pick({ kind: 'trackCover', ids: albumIds(coverFor), label: coverFor.album });
              }}
            />
            {coverFor.customArtwork ? (
              <SheetItem
                icon="restore"
                label="Restaurar la original"
                onPress={() => {
                  const ids = albumIds(coverFor).filter((id) => trackById(useLibrary.getState(), id)?.customArtwork);
                  useLibrary.getState().setCustomArtwork(ids.length ? ids : [coverFor.id], null);
                  setCoverFor(null);
                  showToast('Portada original restaurada');
                }}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={!!addToPlaylist} onClose={close}>
        <SheetTitle sub={`${addToPlaylist?.length ?? 0} ${addToPlaylist?.length === 1 ? 'canción' : 'canciones'}`}>
          Añadir a lista
        </SheetTitle>
        <SheetItem
          icon="playlist-plus"
          label="Nueva lista…"
          onPress={() => {
            const ids = addToPlaylist ?? [];
            close();
            // Let this sheet finish closing before the next one opens.
            setTimeout(() => useUI.getState().openNewPlaylist(ids), 300);
          }}
        />
        <ScrollView style={{ maxHeight: 320 }}>
          {playlists.map((p) => (
            <SheetItem
              key={p.id}
              icon="playlist-music"
              label={p.name}
              detail={`${p.trackIds.length}`}
              onPress={() => {
                if (addToPlaylist) useLibrary.getState().addToPlaylist(p.id, addToPlaylist);
                close();
                showToast(`Añadida a “${p.name}”`);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 },
  newRow: { paddingHorizontal: 20, paddingBottom: 8 },
  input: {
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    color: colors.text,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
});
