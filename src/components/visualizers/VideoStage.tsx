/**
 * Video visualizer and animated covers.
 *  - Your own video (per track, or one for every track) always wins. When its
 *    length matches the song's (a music video), it follows the playback
 *    position; otherwise it loops.
 *  - Otherwise the Apple Music motion artwork: the tall loop full screen,
 *    or the square one.
 *  - Otherwise the cover drifts slowly (Ken Burns), with a hint to add a video.
 * Videos are always muted and mix with the music, so they never take audio
 * focus away from the player.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { createVideoPlayer, VideoView, type VideoContentFit, type VideoPlayer } from 'expo-video';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { playbackTime } from '@/audio/clock';
import { transport } from '@/audio/engine';
import { Artwork } from '@/components/ui/Artwork';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { Track } from '@/library/types';
import { useMotionArt } from '@/media/motion';
import { useMedia } from '@/store/media';
import { usePlayer } from '@/store/player';
import { colors, radius as radii } from '@/theme';

/** Videos within this many seconds of the song's length are treated as its music video. */
const SYNC_SLACK = 12;

/** Keeps your own music video on the song's clock (position and speed). */
function followSong(player: VideoPlayer, songDuration: number) {
  const d = player.duration;
  if (!(d > 0) || Math.abs(d - songDuration) > SYNC_SLACK) return;
  const target = Math.min(d - 0.05, playbackTime());
  if (Math.abs(player.currentTime - target) > 0.6) player.currentTime = target;
  const rate = transport.value.rate || 1;
  if (Math.abs(player.playbackRate - rate) > 0.01) player.playbackRate = rate;
}

/*
 * Players outlive the views that show them: closing and reopening the player
 * (or flipping between Carátula and Vídeo) re-attaches the same, already
 * buffered player instead of loading the video again. Only a few are kept.
 */
const POOL_SIZE = 3;
const pool = new Map<string, { player: VideoPlayer; views: number }>();

function acquire(uri: string): VideoPlayer {
  const hit = pool.get(uri);
  if (hit) {
    hit.views += 1;
    pool.delete(uri); // re-insert: most recently used last
    pool.set(uri, hit);
    return hit.player;
  }
  const player = createVideoPlayer({ uri });
  player.muted = true;
  player.loop = true;
  player.audioMixingMode = 'mixWithOthers';
  player.showNowPlayingNotification = false;
  player.staysActiveInBackground = false;
  pool.set(uri, { player, views: 1 });
  for (const [key, entry] of pool) {
    if (pool.size <= POOL_SIZE) break;
    if (entry.views > 0) continue;
    entry.player.release();
    pool.delete(key);
  }
  return player;
}

function release(uri: string) {
  const entry = pool.get(uri);
  if (!entry) return;
  entry.views = Math.max(0, entry.views - 1);
  // Nobody is looking: stop decoding, but keep the buffer for next time.
  if (entry.views === 0) entry.player.pause();
}

function LoopVideo({
  uri,
  fit,
  songDuration,
  onReady,
}: {
  uri: string;
  fit: VideoContentFit;
  /** Set for your own videos: sync to the song when the lengths match. */
  songDuration?: number;
  onReady?: (ready: boolean) => void;
}) {
  const playing = usePlayer((s) => s.playing);
  const [player] = useState(() => acquire(uri));
  useEffect(() => () => release(uri), [uri]);

  // Shown only once a frame is on the surface: no black flash while it attaches.
  const [shown, setShown] = useState(false);
  const opacity = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const onFirstFrame = () => {
    opacity.set(withTiming(1, { duration: 220 }));
    setShown(true);
  };
  useEffect(() => onReady?.(shown), [shown, onReady]);

  // Motion loops keep moving even when paused (like a lock-screen cover);
  // your own videos follow the music.
  const follows = songDuration != null;
  useEffect(() => {
    if (follows && !playing) player.pause();
    else player.play();
  }, [follows, playing, player]);

  useEffect(() => {
    if (!follows || !shown) return;
    const tick = () => followSong(player, songDuration ?? 0);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [follows, shown, player, songDuration]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={fit}
        nativeControls={false}
        allowsPictureInPicture={false}
        surfaceType="textureView"
        useExoShutter={false}
        onFirstFrameRender={onFirstFrame}
      />
    </Animated.View>
  );
}

/** Cover art that slowly pans and zooms. */
function DriftingCover({ track, width, height }: { track: Track; width: number; height: number }) {
  const k = useSharedValue(0);
  useEffect(() => {
    k.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [k]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { scale: 1.08 + k.value * 0.14 },
      { translateX: (k.value - 0.5) * 24 },
      { translateY: (0.5 - k.value) * 16 },
    ],
  }));
  const side = Math.max(width, height);
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { overflow: 'hidden' }]}>
      {track.artwork ? (
        <Animated.View style={[{ width: side, height: side }, style]}>
          <Image source={{ uri: track.artwork }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={2} />
        </Animated.View>
      ) : (
        <Artwork seed={track.album} size={Math.min(width, height) * 0.7} radius={radii.lg} />
      )}
    </View>
  );
}

export function useTrackVideo(track: Track | undefined): { own: string | null } {
  const perTrack = useMedia((s) => (track ? s.trackVideos[track.id] : undefined));
  const global = useMedia((s) => s.globalVideo);
  return { own: perTrack ?? global ?? null };
}

type StageProps = { track: Track; width: number; height: number; onAdd: () => void };

export function VideoStage({ track, width, height, onAdd }: StageProps) {
  const { own } = useTrackVideo(track);
  const motion = useMotionArt(track);
  const uri = own ?? motion?.tall ?? motion?.square ?? null;
  const [ready, setReady] = useState(false);

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {!uri || !ready ? <DriftingCover track={track} width={width} height={height} /> : null}
      {uri ? (
        <LoopVideo
          key={uri}
          uri={uri}
          fit={own || motion?.tall ? 'cover' : 'contain'}
          songDuration={own ? track.duration : undefined}
          onReady={setReady}
        />
      ) : null}
      {/* keeps the floating controls readable over bright videos */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
        locations={[0, 0.2, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      {!uri ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="box-none">
          <Pressable onPress={onAdd} style={styles.add} accessibilityRole="button" accessibilityLabel="Añadir un vídeo">
            <Icon name="movie-plus-outline" size={22} color={colors.text} />
            <Txt variant="bodyStrong">Añadir un vídeo</Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The cover for the "Carátula" mode: animated when Apple Music has a loop for
 * it. The still cover stays mounted underneath, so opening the player never
 * swaps images or shows black while the video attaches.
 */
export function MotionCover({
  track,
  size,
  radius,
  active,
}: {
  track: Track;
  size: number;
  radius: number;
  /** False while the player is still sliding in (keeps the open animation smooth). */
  active: boolean;
}) {
  const motion = useMotionArt(track);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}>
      <Artwork uri={track.artwork} seed={track.album} size={size} radius={radius} transition={0} />
      {active && motion?.square ? <LoopVideo key={motion.square} uri={motion.square} fit="cover" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(20,20,22,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
});
