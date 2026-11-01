import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DownloadsButton } from '@/components/DownloadsSheet';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { TourTarget } from '@/components/tour/Tour';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { friendlyError } from '@/lib/net';
import { colors, fonts, useAccent } from '@/theme';
import { SectionView } from './components';
import { forYou } from './forYou';
import {
  browse,
  home,
  search,
  searchSongs,
  suggestions,
  type SearchKind,
  type YtChip,
  type YtItem,
  type YtSection,
} from './music';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** One request per kind, all in parallel; shown in this order. */
const KINDS: { kind: SearchKind; title: SearchFilter }[] = [
  { kind: 'songs', title: 'Canciones' },
  { kind: 'artists', title: 'Artistas' },
  { kind: 'videos', title: 'Vídeos' },
  { kind: 'albums', title: 'Álbumes' },
  { kind: 'playlists', title: 'Listas de reproducción' },
];

type Found = { query: string; sections: YtSection[]; pending: boolean; error?: string };

/** Recent searches: going back to one (or retyping it) is instant. */
const recent = new Map<string, Found>();
const recentSuggestions = new Map<string, string[]>();
function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  if (map.size > 40) map.delete(map.keys().next().value as string);
}

/** Results of one kind, keeping only what that kind should hold. */
function only(kind: SearchKind, items: YtItem[]): YtItem[] {
  if (kind === 'songs') return items.filter((x) => x.kind === 'song');
  if (kind === 'videos') return items.flatMap((x) => (x.kind === 'song' ? [{ ...x, video: true }] : []));
  return items.filter((x) => x.kind === 'collection');
}

const FILTERS = ['Todo', 'Canciones', 'Artistas', 'Vídeos', 'Álbumes', 'Listas de reproducción'] as const;
export type SearchFilter = (typeof FILTERS)[number];

type Props = {
  /** Inside the home screen's YouTube Music tab: no back button, no own mini player. */
  embedded?: boolean;
  /** Shown above the sections (the shared "Escuchado recientemente" row). */
  listHeader?: ReactElement | null;
  /** Opens straight on a search (e.g. "this artist on YouTube" from the player). */
  initialQuery?: string;
  initialFilter?: SearchFilter;
};

/** YouTube Music: home, moods, new releases, charts, genres and search. Streaming only. */
export function YouTubeHome({ embedded, listHeader, initialQuery, initialFilter }: Props) {
  useAccent();
  const insets = useSafeAreaInsets();
  const [chip, setChip] = useState<YtChip | null>(null);
  const [filter, setFilter] = useState<SearchFilter>(initialFilter ?? 'Todo');
  const [page, setPage] = useState<{ key: string; chips: YtChip[]; sections: YtSection[]; error?: string } | null>(
    null,
  );
  const [searching, setSearching] = useState(!!initialQuery);
  const [q, setQ] = useState(initialQuery ?? '');
  const [query, setQuery] = useState(initialQuery ?? '');
  const [found, setFound] = useState<Found | null>(null);
  const [suggested, setSuggested] = useState<{ q: string; items: string[] } | null>(null);
  const [chips, setChips] = useState<YtChip[]>([]);
  const [personal, setPersonal] = useState<YtSection | null>(null);
  const key = chip ? chip.title : 'all';

  // Yours, on top of what YouTube suggests to everyone. Waits for the home page: it is the extra.
  const homeReady = !!page;
  useEffect(() => {
    if (!homeReady) return;
    const ctrl = new AbortController();
    forYou(ctrl.signal)
      .then((items) => {
        if (!ctrl.signal.aborted && items.length)
          setPersonal({ title: 'Para ti', strapline: 'Según lo que escuchas', items });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [homeReady]);

  useEffect(() => {
    const ctrl = new AbortController();
    const extras = chip
      ? Promise.resolve([] as YtSection[])
      : Promise.all(
          ['FEmusic_new_releases', 'FEmusic_charts', 'FEmusic_moods_and_genres'].map((id) =>
            browse(id, undefined, ctrl.signal)
              .then((p) => p.sections)
              .catch(() => [] as YtSection[]),
          ),
        ).then((all) => all.flat());
    home(chip ?? undefined, ctrl.signal)
      .then(async (h) => {
        if (!chip && h.chips.length) setChips(h.chips);
        // Home first, the rest as it arrives.
        setPage({ key, chips: h.chips, sections: h.sections });
        const more = await extras;
        if (!ctrl.signal.aborted && more.length) setPage({ key, chips: h.chips, sections: [...h.sections, ...more] });
      })
      .catch((e: Error) => !ctrl.signal.aborted && setPage({ key, chips: [], sections: [], error: friendlyError(e) }));
    return () => ctrl.abort();
  }, [chip, key]);

  // Search after a short pause in typing (Enter or a suggestion search at once).
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Suggestions as you type: a tiny request, answered in about 150 ms.
  useEffect(() => {
    const input = q.trim();
    if (!searching || !input) return;
    if (recentSuggestions.has(input.toLowerCase())) return; // read straight from the cache below
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      suggestions(input, ctrl.signal)
        .then((items) => {
          remember(recentSuggestions, input.toLowerCase(), items);
          if (!ctrl.signal.aborted) setSuggested({ q: input, items });
        })
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, searching]);

  // Every kind is searched at once and shown as it arrives; songs lead, so the
  // list never jumps when they land.
  useEffect(() => {
    if (!query) return;
    const key = query.toLowerCase();
    if (recent.has(key)) return; // read straight from the cache below
    const ctrl = new AbortController();
    const parts = new Map<SearchKind, YtItem[]>();
    let left = KINDS.length;
    let songsDone = false;
    let failure: Error | undefined;
    const publish = () => {
      if (ctrl.signal.aborted || !songsDone) return;
      const sections = KINDS.flatMap((k) => {
        const items = parts.get(k.kind);
        return items?.length ? [{ title: k.title, items }] : [];
      });
      const done = left === 0;
      const next: Found = {
        query,
        sections,
        pending: !done,
        error: done && !sections.length && failure ? friendlyError(failure) : undefined,
      };
      if (done && !failure) remember(recent, key, next);
      setFound(next);
    };
    for (const k of KINDS) {
      const run: Promise<YtItem[]> =
        k.kind === 'songs' ? searchSongs(query, ctrl.signal) : search(query, k.kind, ctrl.signal);
      run
        .then((items) => parts.set(k.kind, only(k.kind, items)))
        .catch((e: Error) => {
          failure = e;
        })
        .finally(() => {
          left -= 1;
          if (k.kind === 'songs') songsDone = true;
          publish();
        });
    }
    return () => ctrl.abort();
  }, [query]);

  const cached = query ? recent.get(query.toLowerCase()) : undefined;
  const results = cached ?? found;
  const typed = q.trim();
  const hints = recentSuggestions.get(typed.toLowerCase()) ?? (suggested?.q === typed ? suggested.items : []);

  const sections = useMemo(() => {
    if (!(searching && query)) {
      const shelves = page?.key === key ? page.sections : [];
      return personal && !chip && shelves.length ? [personal, ...shelves] : shelves;
    }
    const all = results?.sections ?? [];
    return filter === 'Todo' ? all : all.filter((x) => x.title === filter);
  }, [searching, query, results, page, key, filter, personal, chip]);
  // The last results stay up while the next ones load: no blank flashes.
  const stale = !!query && results?.query.toLowerCase() !== query.toLowerCase();
  const busy = searching && !!query && (stale || !!results?.pending);
  const loading = searching && query ? !results?.sections.length && (stale || !!results?.pending) : page?.key !== key;
  const error = searching && query ? results?.error : page?.error;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: embedded ? 0 : insets.top + 4 }}>
      <View style={[styles.header, embedded && { paddingLeft: 16 }]}>
        {embedded ? null : <IconButton icon="chevron-left" size={28} label="Atrás" onPress={() => router.back()} />}
        {searching ? (
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
              onSubmitEditing={() => setQuery(q.trim())}
              autoCorrect={false}
            />
            {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <Txt variant="caption" numberOfLines={1}>
              {greeting()}
            </Txt>
            <Txt variant="title" numberOfLines={1} style={embedded && { fontSize: 19 }}>
              {embedded ? 'Explora YouTube Music' : 'YouTube Music'}
            </Txt>
          </View>
        )}
        {embedded ? null : <DownloadsButton />}
        <TourTarget id="yt.search">
          <IconButton
            icon={searching ? 'close' : 'magnify'}
            label={searching ? 'Cerrar búsqueda' : 'Buscar'}
            onPress={() => {
              setSearching((v) => !v);
              setQ('');
              setQuery('');
            }}
          />
        </TourTarget>
      </View>

      {!searching && chips.length ? (
        <TourTarget id="yt.chips">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.chips}
          >
            {[null, ...chips].map((c) => {
              const on = (c?.title ?? null) === (chip?.title ?? null);
              return (
                <Pressable
                  key={c?.title ?? 'all'}
                  onPress={() => (tap('select'), setChip(c))}
                  style={[styles.chip, on && { backgroundColor: colors.accent }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Txt variant="bodyStrong" style={[{ fontSize: 14 }, on && { color: colors.onAccent }]}>
                    {c?.title ?? 'Todo'}
                  </Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        </TourTarget>
      ) : null}

      {searching && typed && hints.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.hints}
          keyboardShouldPersistTaps="handled"
        >
          {hints
            .filter((x) => x.toLowerCase() !== query.toLowerCase())
            .slice(0, 6)
            .map((x) => (
              <Pressable
                key={x}
                onPress={() => {
                  tap('select');
                  Keyboard.dismiss();
                  setQ(x);
                  setQuery(x);
                }}
                style={styles.suggestion}
                accessibilityRole="button"
                accessibilityLabel={`Buscar ${x}`}
              >
                <Icon name="magnify" size={16} color={colors.textDim} />
                <Txt variant="body" style={{ fontSize: 14 }} numberOfLines={1}>
                  {x}
                </Txt>
              </Pressable>
            ))}
        </ScrollView>
      ) : null}

      {searching && query ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <Pressable
                key={f}
                onPress={() => (tap('select'), setFilter(f))}
                style={[styles.chip, on && { backgroundColor: colors.accent }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Txt variant="bodyStrong" style={[{ fontSize: 14 }, on && { color: colors.onAccent }]}>
                  {f === 'Listas de reproducción' ? 'Listas' : f}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <FlatList
        data={sections}
        keyExtractor={(s, i) => `${s.title}${i}`}
        renderItem={({ item }) => (
          <SectionView
            // With a filter on, the chip already names the shelf.
            section={searching && filter !== 'Todo' ? { ...item, title: '' } : item}
            list={searching && (item.title === 'Canciones' || item.title === 'Vídeos' || filter !== 'Todo')}
          />
        )}
        ListHeaderComponent={searching ? null : listHeader}
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        initialNumToRender={4}
        windowSize={7}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: 48 }} color={colors.accent} />
          ) : (
            <Txt variant="body" style={styles.empty}>
              {error ? error : searching && !query ? 'Busca una canción, un artista o un álbum.' : 'Sin resultados.'}
            </Txt>
          )
        }
      />
      {embedded ? null : <MiniPlayer />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingBottom: 8 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 12,
    backgroundColor: colors.surface2,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  // A horizontal ScrollView grows to fill the column by default (flexGrow: 1),
  // stealing height from the results below: these strips keep their own size.
  strip: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  hints: { gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14 },
  filters: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    maxWidth: 260,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chip: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  empty: { color: colors.textDim, textAlign: 'center', padding: 32 },
});
