/**
 * Global downloads centre: a header icon with a live badge, and a sheet that
 * lists every YouTube save — in progress, finished or failed — with a progress
 * ring, a cancel/retry/delete control per row and a "clear finished" action.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import {
  cancelYtDownload,
  confirmDeleteDownloads,
  downloadYt,
  useYtDownloads,
  type YtDownloadState,
} from '@/catalog/ytDownloads';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { useUI } from '@/store/ui';
import { colors } from '@/theme';

type Entry = YtDownloadState & { videoId: string };

const isActive = (s: YtDownloadState) =>
  s.status === 'queued' || s.status === 'resolving' || s.status === 'downloading';

/** Active first, then finished, then failed; newest attempt first within a group. */
const RANK: Record<YtDownloadState['status'], number> = {
  downloading: 0,
  resolving: 1,
  queued: 2,
  done: 3,
  error: 4,
};

/** Header button that opens the downloads centre; shows a badge while saves run. */
export function DownloadsButton() {
  const [open, setOpen] = useState(false);
  // Plain numbers: this icon lives on every screen and progress updates must not re-render it.
  const active = useYtDownloads((s) => {
    let n = 0;
    for (const k in s.items) if (isActive(s.items[k])) n++;
    return n;
  });
  const any = useYtDownloads((s) => Object.keys(s.items).length > 0);

  // Nothing ever downloaded and nothing running: keep the header uncluttered.
  if (!any) return null;

  return (
    <>
      <View>
        <IconButton
          icon={active ? 'progress-download' : 'download-circle-outline'}
          label="Descargas"
          color={active ? colors.accent : undefined}
          onPress={() => setOpen(true)}
        />
        {active ? (
          <View style={styles.badge} pointerEvents="none">
            <Txt style={styles.badgeText}>{active}</Txt>
          </View>
        ) : null}
      </View>
      {open ? <DownloadsSheet visible onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DownloadsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const items = useYtDownloads((s) => s.items);
  const clearCompleted = useYtDownloads((s) => s.clearCompleted);
  const showToast = useUI((s) => s.showToast);

  const list = useMemo<Entry[]>(
    () =>
      Object.entries(items)
        .map(([videoId, s]) => ({ ...s, videoId }))
        .sort((a, b) => RANK[a.status] - RANK[b.status] || (b.startedAt ?? 0) - (a.startedAt ?? 0)),
    [items],
  );
  const active = list.filter((e) => isActive(e)).length;
  const finished = list.filter((e) => e.status === 'done' || e.status === 'error').length;

  const sub = active
    ? `${active} ${active === 1 ? 'descarga en curso' : 'descargas en curso'}`
    : list.length
      ? 'Todo listo'
      : 'Sin descargas';

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.titleRow}>
        <SheetTitle sub={sub}>Descargas</SheetTitle>
        {finished ? (
          <Pressable
            onPress={() => (tap('select'), clearCompleted())}
            hitSlop={8}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Limpiar descargas finalizadas"
          >
            <Txt variant="caption" style={{ color: colors.accent }}>
              Limpiar
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {list.length ? (
        <FlatList
          data={list}
          keyExtractor={(e) => e.videoId}
          style={{ maxHeight: 440 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          renderItem={({ item }) => <Row entry={item} showToast={showToast} />}
        />
      ) : (
        <View style={styles.empty}>
          <Icon name="download-off-outline" size={40} color={colors.textMute} />
          <Txt variant="body" style={{ color: colors.textDim, textAlign: 'center' }}>
            Aún no has guardado canciones de YouTube en tu biblioteca local.
          </Txt>
        </View>
      )}
    </Sheet>
  );
}

function Row({ entry, showToast }: { entry: Entry; showToast: (m: string) => void }) {
  const { status, videoId, title, artist, thumbnail } = entry;
  const pct = status === 'downloading' && entry.progress != null ? Math.round(entry.progress * 100) : null;

  const statusText =
    status === 'queued'
      ? 'En cola'
      : status === 'resolving'
        ? 'Preparando…'
        : status === 'downloading'
          ? pct != null
            ? `Descargando · ${pct}%`
            : 'Descargando…'
          : status === 'done'
            ? 'En tu biblioteca local'
            : entry.message || 'Error de descarga';

  const cancel = () => {
    tap('select');
    cancelYtDownload(videoId);
  };
  const retry = () => {
    tap('medium');
    downloadYt([{ videoId, title, artist, thumbnail }]);
    showToast('Reintentando descarga…');
  };
  const remove = () => {
    tap('select');
    confirmDeleteDownloads([videoId], { title, artwork: thumbnail });
  };

  return (
    <View style={styles.row}>
      <Artwork uri={thumbnail} seed={title} size={44} radius={6} />
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="caption" numberOfLines={1} style={status === 'error' && { color: colors.danger }}>
          {artist ? `${artist} · ` : ''}
          {statusText}
        </Txt>
        {status === 'downloading' ? (
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${pct ?? 0}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.action}>
        {isActive(entry) ? (
          <>
            {status === 'downloading' && pct == null ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            <IconButton icon="close" size={20} label="Cancelar descarga" color={colors.textDim} onPress={cancel} />
          </>
        ) : status === 'done' ? (
          <IconButton
            icon="trash-can-outline"
            size={20}
            label="Eliminar de la biblioteca"
            color={colors.textDim}
            onPress={remove}
          />
        ) : (
          <IconButton icon="refresh" size={20} label="Reintentar descarga" color={colors.accent} onPress={retry} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  clear: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.accentSoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.surface3, marginTop: 2 },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  action: { flexDirection: 'row', alignItems: 'center' },
  empty: { alignItems: 'center', gap: 12, padding: 32 },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onAccent, fontSize: 10, fontWeight: '700' },
});
