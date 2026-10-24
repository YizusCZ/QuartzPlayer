/**
 * Video visualizer and animated covers.
 *  - Your own video or GIF (per track, or one for every track) always wins. When a video's
 *    length matches the song's (a music video), it follows the playback
 *    position; otherwise it loops.
 *  - Otherwise the Apple Music motion artwork: the tall loop full screen,
 *    or the square one.
 *  - Otherwise the cover drifts slowly (Ken Burns), with a hint to add a video.
 * Videos are always muted and mix with the music, so they never take audio
 * focus away from the player.
 */
import { useEffect, useState, type ReactNode } from 'react';
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
import { isImageBackground } from '@/lib/userMedia';
import { useMotionArt } from '@/media/motion';
import { useMedia } from '@/store/media';
import { YouTubeModule } from '../../../modules/youtube';
import { usePlayer } from '@/store/player';
import { colors, radius as radii } from '@/theme';

/** Videos within this many seconds of the song's length are treated as its music video. */
const SYNC_SLACK = 12;

/** Keeps your own music video on the song's clock (position and speed). */
/**
 * Keeps a muted video on the song's clock. Seeking a streamed video means a
 * rebuffer (a visible stall), so small drift is absorbed by nudging the speed
 * a few percent; only a big jump (a seek in the song) seeks the video.
 */
function followSong(player: VideoPlayer, songDuration: number) {
  const d = player.duration;
  if (!(d > 0) || Math.abs(d - songDuration) > SYNC_SLACK) return;
  // While it buffers its clock stands still: judging drift now would only add seeks.
  if (player.status === 'loading') return;
  const target = Math.min(d - 0.05, playbackTime());
  const drift = target - player.currentTime;
  // A room nudges the audio a few percent to stay with its host: the video
  // ignores those nudges (its own dead band covers them) and only follows
  // real speed changes like Nightcore or Slowed.
  const audioRate = transport.value.rate || 1;
  const rate = Math.abs(audioRate - 1) < 0.09 ? 1 : audioRate;
  if (Math.abs(drift) > 3) {
    player.currentTime = target;
    player.playbackRate = rate;
    return;
  }
  // Every speed change makes the decoder re-time its frames: change it rarely
  // and gently, with a dead band so it settles at exactly the song's speed.
  const nudge = Math.abs(drift) < 0.35 ? 1 : drift > 0 ? 1.03 : 0.97;
  const want = rate * nudge;
  if (Math.abs(player.playbackRate - want) > 0.01) player.playbackRate = want;
}

/** Where a synced video should be right now (the song's position), or null for loops. */
function startAt(songDuration: number | undefined) {
  return songDuration != null ? Math.max(0, playbackTime()) : null;
}

/*
 * Players outlive the views that show them: closing and reopening the player
 * (or flipping between Carátula and Vídeo) re-attaches the same, already
 * buffered player instead of loading the video again. Only a few are kept.
 */
// Each kept player holds a hardware decoder: two is plenty and spares memory.
const POOL_SIZE = 2;
const pool = new Map<string, { player: VideoPlayer; views: number }>();

function acquire(uri: string, at: number | null): VideoPlayer {
  const hit = pool.get(uri);
  if (hit) {
    hit.views += 1;
    pool.delete(uri); // re-insert: most recently used last
    pool.set(uri, hit);
    // Back after a while: jump to the song now, before it starts drawing.
    if (at != null && Math.abs(hit.player.currentTime - at) > 3) hit.player.currentTime = at;
    return hit.player;
  }
  const player = createVideoPlayer({ uri });
  // A bigger cushion against network hiccups, but start as soon as a little is in.
  player.bufferOptions = { preferredForwardBufferDuration: 30, minBufferForPlayback: 1.5 };
  // Synced videos load from the song's current second, not from 0 and then seek
  // (switching to the video minutes into a song used to buffer twice).
  if (at != null && at > 1) player.currentTime = at;
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
  fullScreen,
}: {
  uri: string;
  fit: VideoContentFit;
  /** Set for your own videos: sync to the song when the lengths match. */
  songDuration?: number;
  onReady?: (ready: boolean) => void;
  /**
   * Full screen: a SurfaceView, which the GPU composes directly (smoother, no
   * per-frame copy). It ignores opacity and rounded corners, so the caller
   * covers it until the first frame and small rounded covers keep a TextureView.
   */
  fullScreen?: boolean;
}) {
  const playing = usePlayer((s) => s.playing);
  const [player] = useState(() => acquire(uri, startAt(songDuration)));
  useEffect(() => () => release(uri), [uri]);

  // Shown only once a frame is on the surface: no black flash while it attaches.
  const [shown, setShown] = useState(false);
  const opacity = useSharedValue(0);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const onFirstFrame = () => {
    opacity.set(fullScreen ? 1 : withTiming(1, { duration: 220 }));
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
    const t = setInterval(tick, 2000);
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
        surfaceType={fullScreen ? 'surfaceView' : 'textureView'}
        useExoShutter={false}
        onFirstFrameRender={onFirstFrame}
      />
    </Animated.View>
  );
}

function CoverVeil({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(withTiming(hidden ? 0 : 1, { duration: hidden ? 320 : 0 }));
  }, [hidden, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {children}
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

/** Music-video URLs per YouTube id (they expire after a few hours). */
const ytVideos = new Map<string, { url: string; at: number }>();
const YT_VIDEO_TTL = 4 * 3600_000;

/** Resolves a song's own music video ahead of time, so switching to Vídeo starts at once. */
export function prefetchYouTubeVideo(track: Track | undefined) {
  if (!track || track.source !== 'youtube' || !track.video) return;
  const id = track.uri.slice(3);
  const hit = ytVideos.get(id);
  if (hit && Date.now() - hit.at < YT_VIDEO_TTL) return;
  YouTubeModule.resolveVideo(id)
    .then((v) => ytVideos.set(id, { url: v.url, at: Date.now() }))
    .catch(() => {});
}

/** The YouTube music video of a streamed song, when it has one. */
function useYouTubeVideo(track: Track): string | null {
  const id = track.source === 'youtube' ? track.uri.slice(3) : null;
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    const hit = ytVideos.get(id);
    if (hit && Date.now() - hit.at < YT_VIDEO_TTL) return;
    let alive = true;
    // Art-track songs have no picture of their own: look for the official video.
    const source = track.video ? Promise.resolve(id) : findMusicVideo(track);
    source
      .then((vid) => (vid ? YouTubeModule.resolveVideo(vid) : Promise.reject(new Error('sin videoclip'))))
      .then((v) => {
        ytVideos.set(id, { url: v.url, at: Date.now() });
        if (alive) setLoaded({ id, url: v.url });
      })
      .catch(() => alive && setLoaded({ id, url: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one lookup per song
  }, [id]);
  if (!id) return null;
  const cached = ytVideos.get(id);
  if (cached) return cached.url;
  return loaded?.id === id ? loaded.url : null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The music video matching a song (same title, and its artist in the video's title or channel). */
async function findMusicVideo(track: Track): Promise<string | null> {
  const results = await YouTubeModule.search(`${track.artist} ${track.title}`, 'music_videos').catch(() => []);
  const title = norm(track.title);
  const artist = norm(track.artist);
  const hit = results.find((r) => {
    if (r.type !== 'song') return false;
    const t = norm(r.title);
    return t.includes(title) && (t.includes(artist) || norm(r.artist ?? '').includes(artist) || title.length > 6);
  });
  return hit && hit.type === 'song' ? hit.videoId : null;
}

export function VideoStage({ track, width, height, onAdd }: StageProps) {
  const { own } = useTrackVideo(track);
  const ytVideo = useYouTubeVideo(track);
  const motion = useMotionArt(track);
  // Your video, then the song's music video (YouTube), then the motion cover.
  const still = !!own && isImageBackground(own);
  const uri = own ?? ytVideo ?? motion?.tall ?? motion?.square ?? null;
  const synced = !still && !!(own || ytVideo);
  const [ready, setReady] = useState(false);

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      {still && own ? (
        <Image
          source={{ uri: own }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          autoplay
          transition={200}
          onDisplay={() => setReady(true)}
        />
      ) : uri ? (
        <LoopVideo
          key={uri}
          uri={uri}
          fit={own || motion?.tall ? 'cover' : 'contain'}
          songDuration={synced ? track.duration : undefined}
          onReady={setReady}
          fullScreen
        />
      ) : null}
      {/* Over the video until its first frame, then fades away (the video surface can't fade itself). */}
      <CoverVeil key={uri ?? 'none'} hidden={!!uri && ready}>
        <DriftingCover track={track} width={width} height={height} />
      </CoverVeil>
      {/* keeps the floating controls readable over bright videos */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
        locations={[0, 0.2, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      {!uri ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="box-none">
          <Pressable
            onPress={onAdd}
            style={styles.add}
            accessibilityRole="button"
            accessibilityLabel="Añadir un vídeo o un GIF"
          >
            <Icon name="movie-plus-outline" size={22} color={colors.text} />
            <Txt variant="bodyStrong">Añadir vídeo o GIF</Txt>
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
