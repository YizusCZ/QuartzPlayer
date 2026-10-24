import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Player } from '@/audio/engine';
import { groupTracks, sortTracks, totalDuration, type SortKey } from '@/library/selectors';
import { formatTime, isHiRes, type Track } from '@/library/types';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { HelpButton, TourTarget, useTourRef } from '@/components/tour/Tour';
import { Artwork } from '@/components/ui/Artwork';
import { PlaylistCoverEditor } from '@/components/cassette/PlaylistCoverEditor';
import { FormatBadge } from '@/components/ui/FormatBadge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { TRACK_ROW_HEIGHT, IndexedTrackRow } from '@/components/ui/TrackRow';
import { Txt } from '@/components/ui/Txt';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { useUI } from '@/store/ui';
import { colors, radius, useAccent } from '@/theme';

type Filter = 'all' | 'hires' | 'favorites' | 'recent' | 'top' | 'album' | 'artist' | 'genre' | 'folder' | 'playlist';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Título' },
  { key: 'artist', label: 'Artista' },
  { key: 'album', label: 'Álbum' },
  { key: 'added', label: 'Recientes' },
  { key: 'quality', label: 'Calidad' },
];

export default function Songs() {
  useAccent();
  const {
    filter = 'all',
    value = '',
    title = 'Canciones',
  } = useLocalSearchParams<{ filter?: Filter; value?: string; title?: string }>();
  const tracksMap = useLibrary((s) => s.tracks);
  const remote = useLibrary((s) => s.remote);
  const favorites = useLibrary((s) => s.favorites);
  const plays = useLibrary((s) => s.plays);
  const playlist = useLibrary((s) => (filter === 'playlist' ? s.playlists.find((p) => p.id === value) : undefined));
  const nowId = usePlayer(currentTrackId);
  const playing = usePlayer((s) => s.playing);
  const openActions = useUI((s) => s.openActions);
  const [sort, setSort] = useState<SortKey>(filter === 'hires' ? 'quality' : 'title');

  const sortable =
    filter === 'all' || filter === 'hires' || filter === 'favorites' || filter === 'genre' || filter === 'folder';

  const list = useMemo(() => {
    const all = Object.values(tracksMap);
    switch (filter) {
      case 'hires':
        return sortTracks(
          all.filter((t) => isHiRes(t.format)),
          sort,
        );
      case 'favorites':
        return sortTracks(
          [...all, ...Object.values(remote)].filter((t) => favorites[t.id]),
          sort,
        );
      case 'recent':
        return [...all, ...Object.values(remote)]
          .filter((t) => plays[t.id])
          .sort((a, b) => plays[b.id].last - plays[a.id].last)
          .slice(0, 100);
      case 'top':
        return [...all, ...Object.values(remote)]
          .filter((t) => plays[t.id])
          .sort((a, b) => plays[b.id].count - plays[a.id].count)
          .slice(0, 100);
      case 'album':
      case 'artist':
      case 'genre':
      case 'folder': {
        const kind = ({ album: 'albums', artist: 'artists', genre: 'genres', folder: 'folders' } as const)[filter];
        const g = groupTracks(all, kind).find((x) => x.key === value);
        const tracks = g?.tracks ?? [];
        return sortable ? sortTracks(tracks, sort) : tracks;
      }
      case 'playlist':
        return (playlist?.trackIds ?? []).map((id) => tracksMap[id] ?? remote[id]).filter((t): t is Track => !!t);
      default:
        return sortTracks(all, sort);
    }
  }, [tracksMap, remote, favorites, plays, playlist, filter, value, sort, sortable]);

  const ids = useMemo(() => list.map((t) => t.id), [list]);
  const play = useCallback((i: number) => Player.playTracks(ids, i, { shuffle: false }), [ids]);
  const playlistId = filter === 'playlist' ? playlist?.id : undefined;
  const more = useCallback(
    (index: number, id: string) => openActions(id, playlistId ? { playlistId, index } : undefined),
    [openActions, playlistId],
  );
  const addRef = useTourRef('playlist.add');
  const isAlbum = filter === 'album';

  const header = (
    <View>
      {isAlbum && list[0] ? <AlbumHeader tracks={list} /> : null}
      {playlist ? (
        <View style={styles.album}>
          <TourTarget id="playlist.cover">
            <PlaylistCoverEditor
              playlist={playlist}
              count={list.length}
              duration={list.reduce((a, t) => a + (t.duration ?? 0), 0)}
              size={200}
              radius={radius.md}
            />
          </TourTarget>
          <Pressable
            ref={addRef}
            onPress={() => router.push({ pathname: '/pick-songs', params: { playlist: playlist.id } })}
            style={styles.addSongs}
            accessibilityRole="button"
          >
            <Icon name="playlist-plus" size={20} color={colors.accent} />
            <Txt variant="bodyStrong" style={{ color: colors.accent }}>
              Añadir canciones
            </Txt>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.playRow}>
        <Pressable
          style={[styles.playBtn, { backgroundColor: colors.accent }]}
          onPress={() => Player.playTracks(ids, 0, { shuffle: false })}
          disabled={!ids.length}
          accessibilityRole="button"
        >
          <Icon name="play" size={22} color={colors.onAccent} />
          <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
            Reproducir
          </Txt>
        </Pressable>
        <Pressable
          style={styles.playBtn}
          onPress={() => Player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true })}
          disabled={!ids.length}
          accessibilityRole="button"
        >
          <Icon name="shuffle-variant" size={22} />
          <Txt variant="bodyStrong">Aleatorio</Txt>
        </Pressable>
      </View>
      {sortable ? (
        <View style={styles.sorts}>
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => setSort(s.key)}
              style={[styles.chip, sort === s.key && { backgroundColor: colors.accentSoft }]}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === s.key }}
            >
              <Txt variant="caption" style={sort === s.key && { color: colors.accent }}>
                {s.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={playlist?.name ?? title}
        subtitle={`${list.length} canciones · ${formatTime(totalDuration(list))}`}
        right={
          playlist ? (
            <>
              <HelpButton tour="playlist" />
              <IconButton
                icon="delete-outline"
                label="Eliminar lista"
                onPress={() =>
                  Alert.alert('Eliminar lista', `¿Eliminar “${playlist.name}”? Las canciones no se borran.`, [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Eliminar',
                      style: 'destructive',
                      onPress: () => {
                        useLibrary.getState().deletePlaylist(playlist.id);
                        router.back();
                      },
                    },
                  ])
                }
              />
            </>
          ) : null
        }
      />
      <FlatList
        data={list}
        keyExtractor={(t, i) => `${t.id}:${i}`}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Txt variant="body" style={styles.empty}>
            {filter === 'favorites'
              ? 'Marca canciones con ♥ para verlas aquí.'
              : filter === 'playlist'
                ? 'Añade canciones desde el menú ⋮ de cualquier pista.'
                : 'No hay canciones aquí todavía.'}
          </Txt>
        }
        getItemLayout={(_, i) => ({ length: TRACK_ROW_HEIGHT, offset: TRACK_ROW_HEIGHT * i, index: i })}
        renderItem={({ item, index }) => (
          <IndexedTrackRow
            track={item}
            index={index}
            numbered={isAlbum}
            current={item.id === nowId}
            playing={item.id === nowId && playing}
            onPressAt={play}
            onMoreAt={more}
          />
        )}
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        initialNumToRender={16}
        windowSize={11}
      />
      <MiniPlayer />
    </View>
  );
}

function AlbumHeader({ tracks }: { tracks: Track[] }) {
  const t = tracks[0];
  const best = tracks.reduce((a, b) =>
    (b.format.sampleRate ?? 0) * (b.format.bitDepth ?? 0) > (a.format.sampleRate ?? 0) * (a.format.bitDepth ?? 0)
      ? b
      : a,
  );
  return (
    <View style={styles.album}>
      <Artwork uri={tracks.find((x) => x.artwork)?.artwork} seed={t.album} size={200} radius={radius.md} />
      <Txt variant="title" style={{ textAlign: 'center' }}>
        {t.album}
      </Txt>
      <Txt variant="caption">{[t.albumArtist ?? t.artist, t.year, t.genre].filter(Boolean).join(' · ')}</Txt>
      <FormatBadge format={best.format} />
    </View>
  );
}

const styles = StyleSheet.create({
  playRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  playBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface2,
  },
  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surface },
  empty: { color: colors.textDim, textAlign: 'center', padding: 32 },
  album: { alignItems: 'center', gap: 8, paddingTop: 20, paddingHorizontal: 24 },
  addSongs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    marginTop: 6,
    backgroundColor: colors.accentSoft,
  },
});
