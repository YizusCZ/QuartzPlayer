import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Player } from '@/audio/engine';
import { download, useDownloads, type DownloadState } from '@/catalog/downloads';
import {
  archiveTracks,
  jamendoAvailable,
  searchArchive,
  searchJamendo,
  type CatalogAlbum,
  type CatalogTrack,
} from '@/catalog/sources';
import { MiniPlayer, MINI_PLAYER_HEIGHT } from '@/components/MiniPlayer';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { formatTime } from '@/library/types';
import { useLibrary } from '@/store/library';
import { colors, fonts, radius, useAccent } from '@/theme';

type Source = 'all' | 'jamendo' | 'archive';
const SOURCES: { id: Source; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'jamendo', label: 'Jamendo' },
  { id: 'archive', label: 'Internet Archive' },
];
const SERVICE_NAME = { jamendo: 'Jamendo', archive: 'Internet Archive' } as const;

type Row =
  | { kind: 'head'; key: string; title: string }
  | { kind: 'track'; key: string; track: CatalogTrack }
  | { kind: 'album'; key: string; album: CatalogAlbum };

/** Catalog key → library track id, for songs already downloaded. */
function useInLibrary(): Record<string, string> {
  const tracks = useLibrary((s) => s.tracks);
  return useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of Object.values(tracks)) if (t.origin?.key) map[t.origin.key] = t.id;
    return map;
  }, [tracks]);
}

const mb = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(bytes > 104857600 ? 0 : 1)} MB` : '');

function DownloadButton({ track, inLibrary }: { track: CatalogTrack; inLibrary?: string }) {
  const state: DownloadState | undefined = useDownloads((s) => s.items[track.key]);
  const id = inLibrary ?? (state?.status === 'done' ? state.trackId : undefined);
  if (id) {
    return (
      <Pressable
        onPress={() => (tap('select'), Player.playTracks([id]))}
        style={[styles.dl, { backgroundColor: colors.accentSoft }]}
        accessibilityRole="button"
        accessibilityLabel={`Reproducir ${track.title}`}
      >
        <Icon name="play" size={20} color={colors.accent} />
      </Pressable>
    );
  }
  if (state?.status === 'downloading' || state?.status === 'queued') {
    const pct = state.status === 'downloading' ? Math.round(state.progress * 100) : 0;
    return (
      <View style={styles.dl} accessibilityLabel={`Descargando ${pct} %`}>
        {state.status === 'queued' || pct === 0 ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Txt variant="mono" style={{ fontSize: 11, color: colors.accent }}>
            {pct}%
          </Txt>
        )}
      </View>
    );
  }
  const failed = state?.status === 'error';
  return (
    <Pressable
      onPress={() => (tap('select'), download([track]))}
      style={styles.dl}
      accessibilityRole="button"
      accessibilityLabel={failed ? `Reintentar ${track.title}` : `Descargar ${track.title}`}
    >
      <Icon name={failed ? 'refresh' : 'download'} size={22} color={failed ? colors.danger : colors.text} />
    </Pressable>
  );
}

const TrackRow = memo(function TrackRow({ track, inLibrary }: { track: CatalogTrack; inLibrary?: string }) {
  return (
    <View style={styles.row}>
      <Artwork uri={track.artwork} seed={track.album} size={48} radius={6} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {track.title}
        </Txt>
        <Txt variant="caption" numberOfLines={1}>
          {track.artist}
          {track.duration ? ` · ${formatTime(track.duration)}` : ''}
        </Txt>
        <View style={styles.tags}>
          <Txt style={[styles.tag, track.ext === 'flac' && { color: colors.hires, borderColor: colors.hires }]}>
            {track.ext.toUpperCase()}
          </Txt>
          <Txt style={styles.tag} numberOfLines={1}>
            {track.origin.license}
          </Txt>
          {track.size ? <Txt style={styles.size}>{mb(track.size)}</Txt> : null}
        </View>
      </View>
      <DownloadButton track={track} inLibrary={inLibrary} />
    </View>
  );
});

function AlbumSheet({ album, onClose }: { album: CatalogAlbum | null; onClose: () => void }) {
  const inLibrary = useInLibrary();
  const [loaded, setLoaded] = useState<{ key: string; list?: CatalogTrack[]; error?: string } | null>(null);

  useEffect(() => {
    if (!album) return;
    const ctrl = new AbortController();
    archiveTracks(album, ctrl.signal)
      .then((list) => setLoaded({ key: album.key, list }))
      .catch((e) => !ctrl.signal.aborted && setLoaded({ key: album.key, error: (e as Error).message }));
    return () => ctrl.abort();
  }, [album]);

  const mine = album && loaded?.key === album.key ? loaded : null;
  const list = mine?.list ?? null;
  const missing = list?.filter((t) => !inLibrary[t.key]) ?? [];
  const total = missing.reduce((a, t) => a + (t.size ?? 0), 0);

  return (
    <Sheet visible={!!album} onClose={onClose}>
      {album ? (
        <>
          <SheetTitle sub={[album.artist, album.year].filter(Boolean).join(' · ')}>{album.title}</SheetTitle>
          {list && missing.length ? (
            <Pressable
              onPress={() => (tap('medium'), download(missing))}
              style={[styles.all, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
            >
              <Icon name="download-multiple" size={20} color={colors.onAccent} />
              <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
                Descargar {missing.length} {missing.length === 1 ? 'canción' : 'canciones'}
                {total ? ` · ${mb(total)}` : ''}
              </Txt>
            </Pressable>
          ) : null}
          {!list ? (
            <View style={styles.center}>
              {mine?.error ? (
                <Txt variant="caption">No se pudo cargar: {mine.error}</Txt>
              ) : (
                <ActivityIndicator color={colors.accent} />
              )}
            </View>
          ) : (
            <FlatList
              data={list}
              keyExtractor={(t) => t.key}
              style={{ maxHeight: 460 }}
              renderItem={({ item }) => <TrackRow track={item} inLibrary={inLibrary[item.key]} />}
              ListEmptyComponent={
                <Txt variant="caption" style={{ padding: 20 }}>
                  Este elemento no tiene audio descargable.
                </Txt>
              }
            />
          )}
          <Pressable onPress={() => void Linking.openURL(album.origin.pageUrl)} style={styles.credit}>
            <Txt variant="caption">
              {album.origin.license} · Ver en {SERVICE_NAME[album.origin.service]}
            </Txt>
            <Icon name="open-in-new" size={14} color={colors.textMute} />
          </Pressable>
        </>
      ) : null}
    </Sheet>
  );
}

/** Search and download free, legally shareable music. */
export default function Discover() {
  useAccent();
  const inLibrary = useInLibrary();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [result, setResult] = useState<{
    query: string;
    tracks: CatalogTrack[];
    albums: CatalogAlbum[];
    error?: string;
  } | null>(null);
  const [album, setAlbum] = useState<CatalogAlbum | null>(null);

  // Wait for a pause in typing before hitting the network.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const ctrl = new AbortController();
    const quiet = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
    void Promise.all([quiet(searchJamendo(query, ctrl.signal)), quiet(searchArchive(query, ctrl.signal))]).then(
      ([tracks, albums]) => {
        if (ctrl.signal.aborted) return;
        setResult({
          query,
          tracks,
          albums,
          error: !tracks.length && !albums.length ? 'Sin conexión o sin resultados.' : undefined,
        });
      },
    );
    return () => ctrl.abort();
  }, [query]);

  const loading = !result || result.query !== query;
  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    const out: Row[] = [];
    if (source !== 'archive' && result.tracks.length) {
      out.push({ kind: 'head', key: 'h-j', title: query ? 'Canciones · Jamendo' : 'Populares en Jamendo' });
      for (const t of result.tracks) out.push({ kind: 'track', key: t.key, track: t });
    }
    if (source !== 'jamendo' && result.albums.length) {
      out.push({
        kind: 'head',
        key: 'h-a',
        title: query ? 'Conciertos y álbumes · Internet Archive' : 'Conciertos más escuchados',
      });
      for (const a of result.albums) out.push({ kind: 'album', key: a.key, album: a });
    }
    return out;
  }, [result, source, query]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Música libre" subtitle="Creative Commons y dominio público" />
      <View style={styles.search}>
        <Icon name="magnify" size={20} color={colors.textDim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Artista, canción, género…"
          placeholderTextColor={colors.textMute}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(q.trim())}
        />
        {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>
      <View style={styles.sources}>
        {SOURCES.filter((s) => s.id !== 'jamendo' || jamendoAvailable).map((s) => (
          <Pressable
            key={s.id}
            onPress={() => (tap('select'), setSource(s.id))}
            style={[styles.source, source === s.id && { backgroundColor: colors.accentSoft }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: source === s.id }}
          >
            <Txt variant="caption" style={source === s.id && { color: colors.accent }}>
              {s.label}
            </Txt>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: MINI_PLAYER_HEIGHT + 60 }}
        initialNumToRender={14}
        windowSize={9}
        renderItem={({ item }) =>
          item.kind === 'head' ? (
            <Txt variant="label" style={styles.head}>
              {item.title.toUpperCase()}
            </Txt>
          ) : item.kind === 'track' ? (
            <TrackRow track={item.track} inLibrary={inLibrary[item.track.key]} />
          ) : (
            <Pressable
              onPress={() => (tap('select'), setAlbum(item.album))}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
              accessibilityRole="button"
              accessibilityLabel={`${item.album.title}, ${item.album.artist}`}
            >
              <Artwork uri={item.album.artwork} seed={item.album.title} size={48} radius={6} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {item.album.title}
                </Txt>
                <Txt variant="caption" numberOfLines={1}>
                  {[item.album.artist, item.album.year].filter(Boolean).join(' · ')}
                </Txt>
                <View style={styles.tags}>
                  <Txt style={styles.tag} numberOfLines={1}>
                    {item.album.origin.license}
                  </Txt>
                </View>
              </View>
              <Icon name="chevron-right" color={colors.textMute} />
            </Pressable>
          )
        }
        ListEmptyComponent={
          loading ? null : (
            <Txt variant="body" style={styles.empty}>
              {result?.error ?? 'Sin resultados.'}
            </Txt>
          )
        }
        ListFooterComponent={
          rows.length ? (
            <Txt variant="caption" style={styles.footer}>
              Cada obra conserva su licencia: si la compartes o la usas, cita al artista y respeta sus condiciones.
            </Txt>
          ) : null
        }
      />
      <AlbumSheet album={album} onClose={() => setAlbum(null)} />
      <MiniPlayer />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.surface2,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  sources: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  source: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  head: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tag: {
    fontFamily: fonts.condensed,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.textDim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    maxWidth: 150,
  },
  size: { fontFamily: fonts.condensed, fontSize: 10, color: colors.textMute },
  dl: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  all: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 23,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  center: { padding: 32, alignItems: 'center' },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 12 },
  empty: { color: colors.textDim, textAlign: 'center', padding: 32 },
  footer: { paddingHorizontal: 16, paddingVertical: 20, textAlign: 'center', lineHeight: 18, borderRadius: radius.sm },
});
