/**
 * One place to create playlists (home, Listas, "Añadir a una lista"): a name
 * that is already filled in, a live preview of the cassette cover and its
 * style. An empty playlist goes straight to picking its songs.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { PlaylistCover, playlistSkin } from '@/components/cassette/PlaylistCover';
import { SKINS, type CassetteSkinId } from '@/components/cassette/skins';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { colors, fonts, radius } from '@/theme';

const SKIN_IDS = Object.keys(SKINS) as CassetteSkinId[];

function suggestedName(): string {
  const taken = new Set(useLibrary.getState().playlists.map((p) => p.name.toLowerCase()));
  for (let n = useLibrary.getState().playlists.length + 1; ; n++) {
    const name = `Mi lista ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function NewPlaylistSheet() {
  const ids = useUI((s) => s.newPlaylist);
  const close = useUI((s) => s.close);
  return (
    <Sheet visible={!!ids} onClose={close}>
      {/* Remounted on every open so the form starts fresh. */}
      {ids ? <Form key={ids.join(',') || 'empty'} ids={ids} onDone={close} /> : null}
    </Sheet>
  );
}

function Form({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [placeholder] = useState(suggestedName);
  const [name, setName] = useState('');
  const [draftId] = useState(() => `draft_${Date.now().toString(36)}`);
  const [skin, setSkin] = useState<CassetteSkinId>(() => playlistSkin({ id: draftId }));
  const title = name.trim() || placeholder;

  const create = () => {
    tap('medium');
    const lib = useLibrary.getState();
    const id = lib.createPlaylist(title, ids);
    lib.updatePlaylist(id, { skin });
    onDone();
    if (ids.length) {
      useUI.getState().showToast(`Añadida a “${title}”`);
    } else {
      // Nothing in it yet: go pick the songs right away.
      setTimeout(() => router.push({ pathname: '/pick-songs', params: { playlist: id } }), 250);
    }
  };

  return (
    <View style={{ paddingBottom: 8 }}>
      <SheetTitle sub={ids.length ? `${ids.length} ${ids.length === 1 ? 'canción' : 'canciones'}` : undefined}>
        Nueva lista
      </SheetTitle>
      <View style={styles.top}>
        <PlaylistCover playlist={{ id: draftId, name: title, skin }} count={ids.length} size={112} radius={radius.md} />
        <View style={{ flex: 1, gap: 10 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={placeholder}
            placeholderTextColor={colors.textMute}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={create}
            maxLength={60}
            accessibilityLabel="Nombre de la lista"
          />
          <Pressable
            onPress={create}
            style={[styles.create, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Crear ${title}`}
          >
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              {ids.length ? 'Crear y añadir' : 'Crear y elegir canciones'}
            </Txt>
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.skins}
        keyboardShouldPersistTaps="handled"
      >
        {SKIN_IDS.map((id) => {
          const on = id === skin;
          return (
            <Pressable
              key={id}
              onPress={() => (tap('select'), setSkin(id))}
              style={[styles.skin, on && { borderColor: colors.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={SKINS[id].name}
            >
              <LinearGradient
                colors={[SKINS[id].shellLight, SKINS[id].shell]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.skinShell}
              >
                <LinearGradient
                  colors={SKINS[id].stripe}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.skinStripe}
                />
              </LinearGradient>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 14 },
  input: {
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    color: colors.text,
    paddingHorizontal: 14,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  create: { height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  skins: { gap: 8, paddingHorizontal: 20, paddingBottom: 8 },
  skin: { padding: 3, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  skinShell: { width: 46, height: 30, borderRadius: 5, justifyContent: 'center', paddingHorizontal: 5 },
  skinStripe: { height: 7, borderRadius: 2 },
});
