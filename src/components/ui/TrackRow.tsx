import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatTime, type Track } from '@/library/types';
import { colors, useAccent } from '@/theme';
import { Artwork } from './Artwork';
import { FormatBadge } from './FormatBadge';
import { IconButton } from './IconButton';
import { PlayingBars } from './PlayingBars';
import { Txt } from './Txt';

type Props = {
  track: Track;
  onPress: () => void;
  onMore?: () => void;
  current?: boolean;
  playing?: boolean;
  /** Show the track number instead of artwork (album view). */
  numbered?: boolean;
};

export const TRACK_ROW_HEIGHT = 64;

export const TrackRow = memo(function TrackRow({ track, onPress, onMore, current, playing, numbered }: Props) {
  useAccent();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${track.artist}`}
    >
      {numbered ? (
        <View style={styles.num}>
          {current ? <PlayingBars playing={!!playing} /> : <Txt variant="mono">{track.trackNo ?? '·'}</Txt>}
        </View>
      ) : (
        <View>
          <Artwork uri={track.artwork} seed={track.album} size={46} radius={6} />
          {current ? (
            <View style={styles.overlay}>
              <PlayingBars playing={!!playing} />
            </View>
          ) : null}
        </View>
      )}
      <View style={styles.text}>
        <Txt variant="bodyStrong" numberOfLines={1} style={current && { color: colors.accent }}>
          {track.title}
        </Txt>
        <View style={styles.meta}>
          <FormatBadge format={track.format} compact />
          <Txt variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
            {track.artist}
          </Txt>
        </View>
      </View>
      <Txt variant="mono">{track.duration ? formatTime(track.duration) : ''}</Txt>
      {onMore ? (
        <IconButton icon="dots-vertical" size={20} color={colors.textDim} label="Más opciones" onPress={onMore} />
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    height: TRACK_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    gap: 12,
  },
  num: { width: 28, alignItems: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

type IndexedProps = Omit<Props, 'onPress' | 'onMore'> & {
  index: number;
  onPressAt: (index: number) => void;
  onMoreAt?: (index: number, id: string) => void;
};

/**
 * TrackRow for FlatLists: the callbacks take the row index, so the list can
 * hand every row the same stable functions and the memo actually holds
 * (otherwise each play/pause re-renders every visible row).
 */
export const IndexedTrackRow = memo(function IndexedTrackRow({ index, onPressAt, onMoreAt, ...rest }: IndexedProps) {
  return (
    <TrackRow
      {...rest}
      onPress={() => onPressAt(index)}
      onMore={onMoreAt ? () => onMoreAt(index, rest.track.id) : undefined}
    />
  );
});
