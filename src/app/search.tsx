import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Player } from '@/audio/engine';
import { searchTracks } from '@/library/selectors';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { IndexedTrackRow, TRACK_ROW_HEIGHT } from '@/components/ui/TrackRow';
import { Txt } from '@/components/ui/Txt';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { useUI } from '@/store/ui';
import { colors, fonts, useAccent } from '@/theme';

export default function Search() {
  useAccent();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const tracksMap = useLibrary((s) => s.tracks);
  // Typing stays responsive in big libraries: the search runs on a deferred copy of the query.
  const query = useDeferredValue(q);
  const all = useMemo(() => Object.values(tracksMap), [tracksMap]);
  const results = useMemo(() => searchTracks(all, query).slice(0, 200), [all, query]);
  const ids = useMemo(() => results.map((t) => t.id), [results]);
  const nowId = usePlayer(currentTrackId);
  const playing = usePlayer((s) => s.playing);
  const openActions = useUI((s) => s.openActions);
  const play = useCallback((i: number) => Player.playTracks(ids, i, { shuffle: false }), [ids]);
  const more = useCallback((_: number, id: string) => openActions(id), [openActions]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + 4 }}>
      <View style={styles.bar}>
        <IconButton icon="chevron-left" size={28} label="Atrás" onPress={() => router.back()} />
        <View style={styles.field}>
          <Icon name="magnify" size={20} color={colors.textDim} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Canciones, artistas, álbumes"
            placeholderTextColor={colors.textMute}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
          />
          {q ? <IconButton icon="close" size={18} label="Borrar búsqueda" onPress={() => setQ('')} /> : null}
        </View>
      </View>
      <FlatList
        data={results}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        getItemLayout={(_, i) => ({ length: TRACK_ROW_HEIGHT, offset: TRACK_ROW_HEIGHT * i, index: i })}
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        ListEmptyComponent={
          q ? (
            <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center', padding: 32 }}>
              Sin resultados para “{q}”.
            </Txt>
          ) : null
        }
        renderItem={({ item, index }) => (
          <IndexedTrackRow
            track={item}
            index={index}
            current={item.id === nowId}
            playing={item.id === nowId && playing}
            onPressAt={play}
            onMoreAt={more}
          />
        )}
      />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingRight: 12, paddingBottom: 8 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    paddingLeft: 14,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 16, height: 44 },
});
