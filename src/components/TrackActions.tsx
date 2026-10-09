import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Player } from '@/audio/engine';
import { deleteImported } from '@/library/scanner';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { colors, fonts, useAccent } from '@/theme';
import { Artwork } from './ui/Artwork';
import { FormatBadge } from './ui/FormatBadge';
import { Sheet, SheetItem, SheetTitle } from './ui/Sheet';
import { Txt } from './ui/Txt';

/** Global sheets driven by `useUI`: per-track actions and "add to playlist". */
export function TrackActions() {
  useAccent();
  const { actionsFor, actionsCtx, addToPlaylist, close, pickPlaylist, showToast } = useUI();
  const track = useLibrary((s) => (actionsFor ? s.tracks[actionsFor] : undefined));
  const fav = useLibrary((s) => (actionsFor ? !!s.favorites[actionsFor] : false));
  const playlists = useLibrary((s) => s.playlists);

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
              icon="information-outline"
              label="Información técnica"
              onPress={act(() => router.push({ pathname: '/info', params: { id: track.id } }))}
            />
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
