import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Gesture,
  GestureDetector,
  type GestureStateManager,
  type GestureTouchEvent,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { acquireAnalyzer, rearmAnalyzer, releaseAnalyzer, type AnalyzerMode } from '@/audio/analyzer';
import { playbackTime } from '@/audio/clock';
import { NIGHTCORE_RATE, Player, SLOWED_RATE, transport } from '@/audio/engine';
import { downloadYt, useYtDownloads, ytInLibrary, type YtDownloadItem } from '@/catalog/ytDownloads';
import { clearFx, FX, FX_PRESETS, fxSupported, toggleFx } from '@/audio/fx';
import { CassetteAOD } from '@/components/cassette/CassetteAOD';
import { CassetteView } from '@/components/cassette/CassetteView';
import { FormatBadge } from '@/components/ui/FormatBadge';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { SeekBar } from '@/components/ui/SeekBar';
import { Sheet, SheetItem, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { ScopeView } from '@/components/visualizers/ScopeView';
import { MotionCover, prefetchYouTubeVideo, VideoStage } from '@/components/visualizers/VideoStage';
import { HelpButton, TourTarget, useTourActive, useTourRef } from '@/components/tour/Tour';
import { useJam } from '@/jam/store';
import { Marquee } from '@/components/ui/Marquee';
import type { SearchFilter } from '@/youtube/YouTubeHome';
import { LyricsView } from '@/components/visualizers/LyricsView';
import { LedView, MirrorView, RadialView, SpectrumView } from '@/components/visualizers/SpectrumView';
import { QualityPanel } from '@/components/QualityPanel';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';
import { AudioRouteChip, AudioRoutePanel } from '@/components/AudioRouteChip';
import { tierOf } from '@/library/quality';
import { formatTime, type Track } from '@/library/types';
import { useSkinList } from '@/components/cassette/customSkins';
import { isBuiltinSkin, type CassetteSkinId } from '@/components/cassette/skins';
import { VUMeterView } from '@/components/visualizers/VUMeterView';
import { tap } from '@/lib/haptics';
import { useAppActive } from '@/lib/useAppActive';
import { trackById, useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { useSettings, VISUALIZERS, type PlayerMode } from '@/store/settings';
import { MODES } from '@/lib/modes';
import { useEq } from '@/store/eq';
import { useUI } from '@/store/ui';
import { useMedia } from '@/store/media';
import { forgetUserFile, pick } from '@/lib/userMedia';
import { colors, fonts, radius, useAccent } from '@/theme';

type Mode = PlayerMode;
const HIDE_AFTER = 4000;
const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
const SLEEP = [15, 30, 45, 60, 90];

function PlayerDownloadButton({ track }: { track: Track }) {
  const videoId = track.uri.replace(/^yt:/, '');
  const dlState = useYtDownloads((s) => s.items[videoId]);
  useYtDownloads((s) => s.downloaded);
  const inLib = !!ytInLibrary(videoId);
  const isDone = inLib || dlState?.status === 'done';
  const isBusy = !inLib && (dlState?.status === 'downloading' || dlState?.status === 'resolving' || dlState?.status === 'queued');
  const showToast = useUI((s) => s.showToast);

  const handlePress = () => {
    if (isDone) {
      showToast('Ya está guardada en tu biblioteca local');
      tap('select');
      return;
    }
    if (isBusy) {
      showToast('Guardando en tu biblioteca local…');
      return;
    }
    tap('medium');
    const item: YtDownloadItem = {
      videoId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      thumbnail: track.artwork,
      duration: track.duration,
    };
    downloadYt([item]);
    showToast('Guardando en tu biblioteca local…');
  };

  if (isBusy) {
    return (
      <Pressable
        onPress={handlePress}
        style={styles.playerDlBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Guardando en tu biblioteca local"
      >
        <ActivityIndicator size="small" color={colors.accent} />
      </Pressable>
    );
  }

  return (
    <IconButton
      icon={isDone ? 'check-circle' : 'download'}
      color={isDone ? colors.accent : colors.text}
      label={isDone ? 'Guardada en tu biblioteca' : 'Guardar en biblioteca local'}
      size={24}
      onPress={handlePress}
    />
  );
}

export default function PlayerScreen() {
  useAccent();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const id = usePlayer(currentTrackId);
  const track = useLibrary((s) => trackById(s, id));
  const fav = useLibrary((s) => (id ? !!s.favorites[id] : false));
  const playing = usePlayer((s) => s.playing);
  const index = usePlayer((s) => s.index);
  const total = usePlayer((s) => s.queue.length);
  const loadSeq = usePlayer((s) => s.loadSeq);
  const lastVisualizer = useSettings((x) => x.lastVisualizer);
  const autoVisualizer = useSettings((x) => x.autoVisualizer);
  const keepAwake = useSettings((x) => x.keepAwake);
  const quickModes = useSettings((x) => x.quickModes);
  const aodEnabled = useSettings((x) => x.cassetteAod);
  const aodDelay = useSettings((x) => x.cassetteAodDelay);
  const coverShape = useSettings((x) => x.coverShape);
  // Warm up the music video while you look at the cover, so Vídeo opens without a wait.
  useEffect(() => prefetchYouTubeVideo(track), [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const jamCode = useJam((s) => (s.status === 'joined' ? s.code : null));
  const rightRef = useTourRef('player.right');
  const stageRef = useTourRef('player.stage');
  const toolsRef = useTourRef('player.tools');

  // `mode`: opened to show something specific (a search result's music video).
  const { mode: startMode } = useLocalSearchParams<{ mode?: Mode }>();
  const [mode, setMode] = useState<Mode>(startMode ?? (playing && autoVisualizer ? lastVisualizer : 'cover'));
  const [side, setSide] = useState<'A' | 'B'>('A');
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<
    'none' | 'speed' | 'sleep' | 'more' | 'quality' | 'modes' | 'route' | 'artist' | 'fx' | 'video' | 'skins'
  >('none');
  const [analyzer, setAnalyzer] = useState<AnalyzerMode>('off');
  const [chromeTick, setChromeTick] = useState(0);
  const chromeOpacity = useSharedValue(1);
  const [aod, setAod] = useState(false);
  /** Pocket mode for the cassette: every touch is ignored until a long press. */
  const [locked, setLocked] = useState(false);
  /** Where the tape will land while you scrub the cassette (s), or null. */
  const [scrubTo, setScrubTo] = useState<number | null>(null);
  const scrubX = useSharedValue(0);
  const scrubStart = useSharedValue(0);
  const scrubSec = useSharedValue(-1);

  const immersive = mode !== 'cover';

  // Enter the visualizer as soon as playback starts; each new track starts on side A.
  // Auto-visualizer fires at most once per opening, only when the user
  // presses play on the same track, and never after a manual mode pick.
  // (Track changes briefly flip `playing`, which used to re-trigger it.)
  const [prev, setPrev] = useState({ playing, id, auto: false });
  if (prev.playing !== playing || prev.id !== id) {
    const trackChanged = prev.id !== id;
    const fire = playing && !prev.playing && !trackChanged && !prev.auto && autoVisualizer && mode === 'cover';
    setPrev({ playing, id, auto: prev.auto || fire });
    if (fire) setMode(lastVisualizer);
    if (trackChanged) setSide('A');
  }

  // Controls fade away while a visualizer plays; any touch brings them back.
  const touring = useTourActive();
  const chromeShown = !locked && (chrome || !immersive || !playing || touring);
  const showChrome = useCallback(() => {
    setChrome(true);
    setChromeTick((t) => t + 1);
  }, []);
  // An open sheet holds the chrome up; the countdown restarts once it closes.
  useEffect(() => {
    if (!chrome || !immersive || !playing || sheet !== 'none') return;
    const t = setTimeout(() => setChrome(false), HIDE_AFTER);
    return () => clearTimeout(t);
  }, [chrome, immersive, playing, chromeTick, sheet]);
  useEffect(() => {
    chromeOpacity.value = withTiming(chromeShown ? 1 : 0, { duration: 280 });
  }, [chromeShown, chromeOpacity]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  // Always-on display: after a stretch without touches the cassette drops to a
  // dim black screen. Any interaction (chromeTick / chrome) restarts the wait.
  const aodAllowed = aodEnabled && mode === 'cassette' && sheet === 'none';
  useEffect(() => {
    if (!aodAllowed || aod) return;
    const t = setTimeout(() => setAod(true), aodDelay * 1000);
    return () => clearTimeout(t);
  }, [aodAllowed, aod, aodDelay, chrome, chromeTick]);
  const aodShown = aod && aodAllowed;
  const wakeFromAod = useCallback(() => {
    setAod(false);
    setChrome(true);
    setChromeTick((t) => t + 1);
    tap('select');
  }, []);

  // Analyzer only runs while a signal-driven visualizer is on screen.
  // Heavy stages (Skia canvases, cassette rasterising, analyzer) wait until the
  // open animation finishes so the slide-up stays at full frame rate.
  const navigation = useNavigation();
  const [ready, setReady] = useState(false);
  // Canvases and the analyzer only run while the app is on screen.
  const active = useAppActive();
  // Nothing on stage changes while the player closes: swapping the video or a
  // visualizer for the still cover mid-slide is what used to flash.
  const live = ready && active;
  useEffect(() => {
    const done = () => setReady(true);
    const unsub = navigation.addListener('transitionEnd' as never, done);
    const fallback = setTimeout(done, 450);
    return () => {
      unsub();
      clearTimeout(fallback);
    };
  }, [navigation]);
  const ambient = useSettings((x) => x.ambientShare);
  // Only the cover and lyrics sit on AmbientShare; every visualizer stays on black.

  const showAmbient = ambient && (mode === 'cover' || mode === 'lyrics');
  const needsAnalyzer = live && (VISUALIZERS.find((v) => v.id === mode)?.needsAnalyzer ?? false);
  useEffect(() => {
    if (!needsAnalyzer) return;
    let alive = true;
    void acquireAnalyzer().then((m) => alive && setAnalyzer(m));
    return () => {
      alive = false;
      releaseAnalyzer();
      setAnalyzer('off');
    };
  }, [needsAnalyzer]);
  useEffect(() => {
    if (needsAnalyzer) rearmAnalyzer();
  }, [loadSeq, needsAnalyzer]);

  useEffect(() => {
    // The always-on display keeps the screen lit even when paused.
    if (!((immersive && keepAwake && playing) || aodShown || locked)) return;
    // Both reject once the activity is gone (closing the player, app backgrounded).
    activateKeepAwakeAsync('quartz-visualizer').catch(() => {});
    return () => void deactivateKeepAwake('quartz-visualizer').catch(() => {});
  }, [immersive, keepAwake, playing, aodShown, locked]);

  const cycleMode = (dir: 1 | -1) => {
    const i = MODES.findIndex((m) => m.id === mode);
    setMode(MODES[(i + dir + MODES.length) % MODES.length].id);
    tap('select');
  };
  const flipSide = () => {
    setSide((s) => (s === 'A' ? 'B' : 'A'));
    tap('medium');
  };

  // The stage sits under the floating chrome in immersive mode. Gesture
  // handler hit-tests past transparent Pressables, so a stage tap would win
  // and cancel the button press: fail stage gestures that start on the chrome.
  // The callbacks are worklets because the state manager only works there;
  // app work hops to JS with scheduleOnRN.
  const [chromeZone, setChromeZone] = useState({ top: 0, bottom: Infinity });
  const zoneTop = chromeZone.top;
  const zoneBottom = chromeZone.bottom;
  const skipChrome = (e: GestureTouchEvent, m: GestureStateManager) => {
    'worklet';
    const y = e.allTouches[0]?.absoluteY;
    if (!immersive || y == null) return;
    if (y < zoneTop || y > zoneBottom) m.fail();
  };
  // Swipe-down to close follows the finger, then slides the rest of the way
  // itself (the native close animation is skipped so nothing jumps).
  const dragY = useSharedValue(0);
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));
  const finishClose = () => {
    navigation.setOptions({ animation: 'none' } as never);
    router.back();
  };
  /** Slides the player away on the UI thread; JS is only told once it is off screen. */
  const slideAway = () => {
    'worklet';
    dragY.set(
      withTiming(height, { duration: 220, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(finishClose);
      }),
    );
  };
  const dismiss = () => slideAway();
  const onDoubleTap = () => {
    if (mode === 'cassette') flipSide();
  };
  const onSingleTap = () => {
    if (!immersive) return;
    if (mode === 'cassette') {
      // Tapping the tape is the play/pause button.
      Player.toggle();
      tap('medium');
      showChrome();
      return;
    }
    if (chromeShown) setChrome(false);
    else showChrome();
  };
  const finishScrub = (to: number) => {
    setScrubTo(null);
    Player.seek(to);
    tap('select');
  };
  const cassetteMode = mode === 'cassette';
  const stageWidth = Math.max(1, stage.w);

  // On the cassette, a sideways drag winds the tape (scrub); elsewhere it changes mode.
  const swipe = Gesture.Pan()
    .onTouchesDown(skipChrome)
    .activeOffsetX(cassetteMode ? [-8, 8] : [-30, 30])
    .failOffsetY([-25, 25])
    .onStart(() => {
      'worklet';
      if (!cassetteMode) return;
      scrubStart.set(playbackTime());
      scrubSec.set(-1);
    })
    .onUpdate((e) => {
      'worklet';
      if (!cassetteMode) return;
      scrubX.set(e.translationX);
      const d = transport.value.duration;
      // A full-width drag winds about 40 % of the song.
      const to = Math.max(0, Math.min(d, scrubStart.value + (e.translationX / stageWidth) * d * 0.4));
      const sec = Math.floor(to);
      if (sec !== scrubSec.value) {
        scrubSec.set(sec);
        scheduleOnRN(setScrubTo, to);
      }
    })
    .onEnd((e) => {
      'worklet';
      if (cassetteMode) {
        const d = transport.value.duration;
        const to = Math.max(0, Math.min(d, scrubStart.value + (e.translationX / stageWidth) * d * 0.4));
        scrubX.set(withSpring(0, { damping: 16, stiffness: 180 }));
        scheduleOnRN(finishScrub, to);
        return;
      }
      if (Math.abs(e.translationX) > 60) scheduleOnRN(cycleMode, e.translationX < 0 ? 1 : -1);
    });
  const drop = Gesture.Pan()
    .onTouchesDown(skipChrome)
    .activeOffsetY(24)
    .failOffsetX([-25, 25])
    .onUpdate((e) => {
      'worklet';
      dragY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      'worklet';
      // Starts right here on the UI thread: no wait for JS before the slide.
      if (e.translationY > 120 || e.velocityY > 900) slideAway();
      else dragY.set(withSpring(0, { damping: 22, stiffness: 260 }));
    });
  const doubleTap = Gesture.Tap()
    .onTouchesDown(skipChrome)
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      scheduleOnRN(onDoubleTap);
    });
  const singleTap = Gesture.Tap()
    .onTouchesDown(skipChrome)
    .onEnd(() => {
      'worklet';
      scheduleOnRN(onSingleTap);
    });
  const stageGesture = Gesture.Race(swipe, drop, Gesture.Exclusive(doubleTap, singleTap));

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setStage((s) => (s.w === w && s.h === h ? s : { w, h }));
  };

  if (!track) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
        <Icon name="cassette" size={64} color={colors.accent} />
        <Txt variant="heading">Nada en reproducción</Txt>
        <IconButton icon="chevron-down" label="Cerrar" onPress={() => router.back()} />
      </View>
    );
  }

  const topBar = (
    <View
      style={[
        styles.topBar,
        { paddingTop: insets.top + 4, paddingLeft: insets.left + 4, paddingRight: insets.right + 4 },
      ]}
    >
      {/* Both sides take the same width so the title and route chip sit on the true centre. */}
      <View style={styles.topSide}>
        <TourTarget id="player.close">
          <IconButton icon="chevron-down" size={28} label="Cerrar reproductor" onPress={dismiss} />
        </TourTarget>
        <HelpButton tour={mode === 'cassette' ? 'cassette' : mode === 'lyrics' ? 'lyrics' : 'player'} />
      </View>
      <View style={styles.topCenter}>
        <View style={styles.statusRow}>
          {jamCode ? (
            <Pressable
              onPress={() => router.push('/jam')}
              style={[styles.roomPill, { backgroundColor: colors.accent }]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Estás en la sala ${jamCode}. Abrir la sala`}
            >
              <Icon name="account-group" size={13} color={colors.onAccent} />
              <Txt style={[styles.roomPillText, { color: colors.onAccent }]}>{jamCode}</Txt>
            </Pressable>
          ) : null}
          <Txt variant="label" numberOfLines={1} style={{ textAlign: 'center', flexShrink: 1 }}>
            {playing ? 'REPRODUCIENDO' : 'EN PAUSA'} · {index + 1}/{total}
          </Txt>
        </View>
        <TourTarget id="player.route">
          <AudioRouteChip onPress={() => setSheet('route')} />
        </TourTarget>
      </View>
      <View ref={rightRef} collapsable={false} style={[styles.topSide, { justifyContent: 'flex-end' }]}>
        <IconButton icon="playlist-play" label="Cola" onPress={() => router.push('/queue')} />
        <IconButton icon="dots-vertical" label="Más" onPress={() => setSheet('more')} />
      </View>
    </View>
  );

  const pickMode = (m: Mode) => {
    setMode(m);
    setPrev((p) => ({ ...p, auto: true }));
    // Remember the last visualizer so the player reopens where you left it.
    if (m !== 'cover') useSettings.getState().set({ lastVisualizer: m });
    showChrome();
    tap('select');
  };
  // Pinned modes, plus the current one if it was picked from "Más".
  const quick = MODES.filter((m) => quickModes.includes(m.id) || m.id === mode);
  const modeChips = (
    <TourTarget id="player.modes">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.modes}
        style={styles.modesScroll}
        accessibilityRole="tablist"
      >
        {quick.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => pickMode(m.id)}
            style={[styles.modeChip, mode === m.id && { backgroundColor: colors.accentSoft }]}
            accessibilityRole="tab"
            accessibilityLabel={m.label}
            accessibilityState={{ selected: mode === m.id }}
          >
            <Icon name={m.icon} size={20} color={mode === m.id ? colors.accent : colors.textDim} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => {
            setSheet('modes');
            tap('select');
          }}
          style={styles.modeChip}
          accessibilityRole="button"
          accessibilityLabel="Todos los visualizadores"
        >
          <Icon name="view-grid-outline" size={20} color={colors.textDim} />
        </Pressable>
      </ScrollView>
    </TourTarget>
  );

  const tier = tierOf(track.format);
  const info = (
    <TourTarget id="player.info" style={{ gap: 6 }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Marquee variant="title" text={track.title} />
          <Pressable
            onPress={() => {
              tap('select');
              setSheet('artist');
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${track.artist}, ${track.album}. Ir al artista o al álbum`}
          >
            <Txt variant="body" numberOfLines={1} style={{ color: colors.textDim }}>
              {track.artist} — {track.album}
            </Txt>
          </Pressable>
        </View>
        {track.source === 'youtube' ? <PlayerDownloadButton track={track} /> : null}
        <IconButton
          icon={fav ? 'heart' : 'heart-outline'}
          color={fav ? colors.accent : colors.textDim}
          label={fav ? 'Quitar de favoritas' : 'Añadir a favoritas'}
          onPress={() => useLibrary.getState().toggleFavorite(track.id)}
        />
      </View>
      <Pressable
        onPress={() => setSheet('quality')}
        style={styles.qualityRow}
        accessibilityRole="button"
        accessibilityLabel={`Calidad: ${tier.name}. Ver detalles`}
      >
        {/* Just the format: tapping it opens the full quality details. */}
        <FormatBadge format={track.format} />
      </Pressable>
    </TourTarget>
  );

  const controls = (
    <TourTarget id="player.controls">
      <Transport onInteract={showChrome} />
    </TourTarget>
  );
  const seekBar = (
    <TourTarget id="player.seek">
      <SeekBar />
    </TourTarget>
  );
  const tools = (
    <Tools
      mode={mode}
      onSheet={setSheet}
      onFlip={flipSide}
      side={side}
      onInteract={showChrome}
      onAod={aodEnabled ? () => (setAod(true), tap('medium')) : undefined}
      onVideo={() => setSheet('video')}
      onLock={() => {
        setLocked(true);
        tap('medium');
      }}
      onSkins={() => setSheet('skins')}
      hasVideo={track.source === 'youtube'}
      onWatch={() => pickMode('video')}
    />
  );

  const coverSize = Math.min(stage.w - 32, stage.h - 16, 520);
  const coverRadius = coverShape === 'round' ? coverSize / 2 : coverShape === 'square' ? 4 : radius.lg;
  const stageView =
    stage.w > 0 ? (
      mode === 'cover' || !live ? (
        <View style={styles.center}>
          <Animated.View entering={FadeIn} style={[styles.coverShadow, { borderRadius: coverRadius }]}>
            <MotionCover track={track} size={coverSize} radius={coverRadius} active={live} />
          </Animated.View>
        </View>
      ) : mode === 'cassette' ? (
        <CassetteView track={track} width={stage.w} height={stage.h} side={side} drag={scrubX} />
      ) : mode === 'lyrics' ? (
        <LyricsView track={track} width={stage.w} height={stage.h} />
      ) : mode === 'video' ? (
        <VideoStage track={track} width={stage.w} height={stage.h} onAdd={() => setSheet('video')} />
      ) : mode === 'spectrum' ? (
        <SpectrumView width={stage.w} height={stage.h} />
      ) : mode === 'led' ? (
        <LedView width={stage.w} height={stage.h} />
      ) : mode === 'mirror' ? (
        <MirrorView width={stage.w} height={stage.h} />
      ) : mode === 'radial' ? (
        <RadialView width={stage.w} height={stage.h} artwork={track.artwork} />
      ) : mode === 'vu' ? (
        <VUMeterView width={stage.w} height={stage.h} />
      ) : (
        <ScopeView width={stage.w} height={stage.h} />
      )
    ) : null;

  const simNote =
    needsAnalyzer && analyzer === 'sim' ? (
      <View style={styles.simNote}>
        <Txt variant="mono" style={{ fontSize: 10 }}>
          SEÑAL SIMULADA
        </Txt>
      </View>
    ) : null;

  /** Leaves the player and opens a library page (after the sheet has closed). */
  const goTo = (params: { filter: string; value: string; title: string }) => {
    setSheet('none');
    setTimeout(() => {
      router.back();
      router.push({ pathname: '/songs', params });
    }, 60);
  };
  const goYouTube = (q: string, filter: SearchFilter) => {
    setSheet('none');
    setTimeout(() => {
      router.back();
      router.push({ pathname: '/youtube', params: { q, filter } });
    }, 60);
  };
  const albumKey = `${track.albumArtist ?? track.artist}\u0000${track.album}`;
  const artistKey = track.albumArtist ?? track.artist;

  const sheets = (
    <>
      <Sheet visible={sheet === 'artist'} onClose={() => setSheet('none')}>
        <SheetTitle sub={track.album}>{track.artist}</SheetTitle>
        {sheet === 'artist' && inLibrary(artistKey) ? (
          <>
            <Txt variant="label" style={styles.sheetLabel}>
              EN TU BIBLIOTECA
            </Txt>
            <SheetItem
              icon="account-music"
              label="Ir al artista"
              detail={artistKey}
              onPress={() => goTo({ filter: 'artist', value: artistKey, title: artistKey })}
            />
            <SheetItem
              icon="album"
              label="Ir al álbum"
              detail={track.album}
              onPress={() => goTo({ filter: 'album', value: albumKey, title: track.album })}
            />
          </>
        ) : null}
        <Txt variant="label" style={styles.sheetLabel}>
          EN YOUTUBE MUSIC
        </Txt>
        <SheetItem
          icon="youtube"
          label="Buscar al artista"
          detail={track.artist}
          onPress={() => goYouTube(track.artist, 'Todo')}
        />
        <SheetItem
          icon="album"
          label="Buscar el álbum"
          detail={track.album}
          onPress={() => goYouTube(`${track.album} ${track.artist}`, 'Álbumes')}
        />
      </Sheet>
      <SpeedSheet visible={sheet === 'speed'} onClose={() => setSheet('none')} onEffects={() => setSheet('fx')} />
      <FxSheet visible={sheet === 'fx'} onClose={() => setSheet('none')} />
      <SkinSheet visible={sheet === 'skins'} onClose={() => setSheet('none')} />
      <VideoSheet visible={sheet === 'video'} onClose={() => setSheet('none')} track={track} />
      <SleepSheet visible={sheet === 'sleep'} onClose={() => setSheet('none')} />
      <Sheet visible={sheet === 'modes'} onClose={() => setSheet('none')}>
        <SheetTitle sub="★ fija el visualizador en la barra">Visualizadores</SheetTitle>
        <ScrollView contentContainerStyle={styles.modeGrid}>
          {MODES.map((m) => {
            const pinned = quickModes.includes(m.id);
            const on = mode === m.id;
            return (
              <View
                key={m.id}
                style={[styles.modeCard, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
              >
                <Pressable
                  onPress={() => {
                    pickMode(m.id);
                    setSheet('none');
                  }}
                  style={styles.modeCardMain}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                >
                  <Icon name={m.icon} size={22} color={on ? colors.accent : colors.text} />
                  <Txt
                    variant="bodyStrong"
                    numberOfLines={1}
                    style={[{ flexShrink: 1 }, on && { color: colors.accent }]}
                  >
                    {m.label}
                  </Txt>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  style={styles.star}
                  onPress={() => {
                    tap('select');
                    const cur = useSettings.getState().quickModes;
                    const next = cur.includes(m.id) ? cur.filter((q) => q !== m.id) : [...cur, m.id];
                    useSettings
                      .getState()
                      .set({ quickModes: MODES.map((x) => x.id).filter((id) => next.includes(id)) });
                  }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: pinned }}
                  accessibilityLabel={
                    pinned ? `Quitar ${m.label} del acceso rápido` : `Fijar ${m.label} en el acceso rápido`
                  }
                >
                  <Icon
                    name={pinned ? 'star' : 'star-outline'}
                    size={22}
                    color={pinned ? colors.accent : colors.textMute}
                  />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </Sheet>
      <Sheet visible={sheet === 'route'} onClose={() => setSheet('none')}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
          <AudioRoutePanel format={track.format} />
        </ScrollView>
      </Sheet>
      <Sheet visible={sheet === 'quality'} onClose={() => setSheet('none')}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4 }}>
          <QualityPanel format={track.format} />
        </ScrollView>
      </Sheet>
      <Sheet visible={sheet === 'more'} onClose={() => setSheet('none')}>
        <SheetTitle sub={track.artist}>{track.title}</SheetTitle>
        {track.source === 'youtube' ? (() => {
          const videoId = track.uri.replace(/^yt:/, '');
          const inLib = !!ytInLibrary(videoId);
          const isDone = inLib || useYtDownloads.getState().items[videoId]?.status === 'done';
          const isBusy =
            !inLib &&
            (useYtDownloads.getState().items[videoId]?.status === 'downloading' ||
              useYtDownloads.getState().items[videoId]?.status === 'resolving' ||
              useYtDownloads.getState().items[videoId]?.status === 'queued');
          return (
            <SheetItem
              icon={isDone ? 'check-circle' : isBusy ? 'progress-download' : 'download'}
              label={
                isDone
                  ? 'Guardada en la biblioteca local'
                  : isBusy
                    ? 'Guardando en la biblioteca…'
                    : 'Guardar en biblioteca local'
              }
              onPress={() => {
                setSheet('none');
                if (isDone) {
                  useUI.getState().showToast('Ya está guardada en tu biblioteca local');
                } else if (!isBusy) {
                  downloadYt([
                    {
                      videoId,
                      title: track.title,
                      artist: track.artist,
                      album: track.album,
                      thumbnail: track.artwork,
                      duration: track.duration,
                    },
                  ]);
                  useUI.getState().showToast('Guardando en tu biblioteca local…');
                }
              }}
            />
          );
        })() : null}
        <SheetItem
          icon="information-outline"
          label="Información técnica"
          onPress={() => (setSheet('none'), router.push({ pathname: '/info', params: { id: track.id } }))}
        />
        <SheetItem
          icon="playlist-plus"
          label="Añadir a una lista…"
          onPress={() => (setSheet('none'), useUI.getState().pickPlaylist([track.id]))}
        />
        <SheetItem
          icon="album"
          label="Ir al álbum"
          onPress={() => goTo({ filter: 'album', value: albumKey, title: track.album })}
        />
        <SheetItem
          icon="image-edit-outline"
          label="Cambiar portada…"
          onPress={() => {
            setSheet('none');
            // Let this sheet finish closing before the next one opens.
            setTimeout(() => useUI.getState().openCover(track.id), 300);
          }}
        />
        <SheetItem
          icon="tune-vertical"
          label="Ecualizador"
          onPress={() => (setSheet('none'), router.push('/equalizer'))}
        />
        <SheetItem
          icon="cog-outline"
          label="Ajustes del visualizador"
          onPress={() => (setSheet('none'), router.push('/settings'))}
        />
      </Sheet>
    </>
  );

  /* ── immersive (visualizer) layout: stage fills the screen, chrome floats ── */
  // While the chrome is hidden its areas only bring it back: touches must not
  // fall through to the invisible buttons or to lyrics lines (which seek).
  const chromeCatcher = chromeShown ? null : (
    <Pressable style={StyleSheet.absoluteFill} onPress={showChrome} accessibilityLabel="Mostrar controles" />
  );
  // The backdrop is the first child of both layouts, so switching between the
  // cover and a visualizer keeps it mounted: it only fades, never restarts.
  const backdrop =
    ambient && active ? (
      <AmbientLayer uri={track.artwork} visible={showAmbient} still={!ready || !showAmbient} />
    ) : null;

  if (immersive && aodShown && live) {
    return <CassetteAOD track={track} side={side} onWake={wakeFromAod} />;
  }
  if (immersive) {
    return (
      <Animated.View style={[styles.screen, dropStyle]}>
        {backdrop}
        <GestureDetector gesture={stageGesture}>
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              },
            ]}
          >
            <View ref={stageRef} style={{ flex: 1 }} onLayout={onStageLayout} collapsable={false}>
              {stageView}
            </View>
          </View>
        </GestureDetector>
        {simNote}
        {scrubTo != null && cassetteMode ? (
          <View style={styles.scrub} pointerEvents="none">
            <Icon
              name={scrubTo >= usePlayer.getState().position ? 'fast-forward' : 'rewind'}
              size={18}
              color={colors.text}
            />
            <Txt variant="title" style={{ fontSize: 20 }}>
              {formatTime(scrubTo)}
            </Txt>
          </View>
        ) : null}
        <Animated.View
          style={[styles.floatTop, chromeStyle]}
          pointerEvents="box-none"
          onLayout={(e) => {
            const top = e.nativeEvent.layout.height;
            setChromeZone((z) => (z.top === top ? z : { ...z, top }));
          }}
        >
          <LinearGradient colors={['rgba(11,11,12,0.92)', 'rgba(11,11,12,0)']} style={StyleSheet.absoluteFill} />
          {topBar}
          {chromeCatcher}
        </Animated.View>
        <Animated.View
          style={[styles.floatBottom, chromeStyle]}
          pointerEvents="box-none"
          onLayout={(e) => {
            const bottom = e.nativeEvent.layout.y;
            setChromeZone((z) => (z.bottom === bottom ? z : { ...z, bottom }));
          }}
        >
          <LinearGradient
            colors={['rgba(11,11,12,0)', 'rgba(11,11,12,0.94)', colors.bg]}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={{
              paddingHorizontal: 20 + Math.max(insets.left, insets.right),
              paddingBottom: insets.bottom + 10,
              paddingTop: 40,
              gap: 10,
              maxWidth: landscape ? 720 : undefined,
              alignSelf: 'center',
              width: '100%',
            }}
          >
            {info}
            {seekBar}
            {controls}
            <View ref={toolsRef} collapsable={false} style={styles.toolsRow}>
              {tools}
            </View>
            {modeChips}
          </View>
          {chromeCatcher}
        </Animated.View>
        {sheets}
        {locked ? <LockOverlay onUnlock={() => setLocked(false)} /> : null}
      </Animated.View>
    );
  }

  /* ── cover layout (Walkman-style now playing) ── */
  return (
    <Animated.View style={[styles.screen, dropStyle]}>
      {backdrop}
      {topBar}
      <View style={[{ flex: 1 }, landscape && { flexDirection: 'row' }]}>
        <GestureDetector gesture={stageGesture}>
          <View ref={stageRef} style={{ flex: landscape ? 1 : 1.25 }} onLayout={onStageLayout} collapsable={false}>
            {stageView}
          </View>
        </GestureDetector>
        <View
          style={[
            styles.panel,
            { paddingBottom: insets.bottom + 12, paddingRight: 20 + insets.right },
            landscape && { flex: 1, justifyContent: 'center' },
          ]}
        >
          {info}
          {seekBar}
          {controls}
          <View ref={toolsRef} collapsable={false} style={styles.toolsRow}>
            {tools}
          </View>
          {modeChips}
        </View>
      </View>
      {sheets}
    </Animated.View>
  );
}

/** Pocket / lock mode: swallows every touch; a long press on the pill unlocks. */
function LockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const hold = useSharedValue(0);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);
  // The button fills from the centre while you hold it.
  const fill = useAnimatedStyle(() => ({ transform: [{ scale: hold.value }], opacity: 0.4 + hold.value * 0.6 }));
  return (
    <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true}>
      <View style={[styles.lockWrap, { bottom: insets.bottom + 28 }]}>
        <Pressable
          onPressIn={() => hold.set(withTiming(1, { duration: 700 }))}
          onPressOut={() => hold.set(withTiming(0, { duration: 150 }))}
          onLongPress={() => {
            tap('medium');
            onUnlock();
          }}
          delayLongPress={700}
          style={styles.lockBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Mantén pulsado para desbloquear"
        >
          <Animated.View style={[styles.lockFill, { backgroundColor: colors.accentSoft }, fill]} />
          <Icon name="lock" size={24} color={colors.accent} />
        </Pressable>
      </View>
    </View>
  );
}

/** Quick switch between cassette styles, plus the editor. */
function SkinSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const list = useSkinList();
  const mode = useSettings((s) => s.cassetteSkinMode);
  const current = useSettings((s) => s.cassetteSkin);
  const mine = mode === 'fixed' ? list.find((sk) => sk.id === current && !isBuiltinSkin(sk.id)) : undefined;
  const pick = (patch: Partial<{ cassetteSkinMode: 'auto' | 'fixed'; cassetteSkin: CassetteSkinId }>) => {
    tap('select');
    useSettings.getState().set(patch);
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle sub="Se aplica al momento">Estilo del cassette</SheetTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.skinStrip}>
        <Pressable
          onPress={() => pick({ cassetteSkinMode: 'auto' })}
          style={[styles.skinCard, mode === 'auto' && { borderColor: colors.accent }]}
          accessibilityRole="radio"
          accessibilityState={{ checked: mode === 'auto' }}
        >
          <View style={[styles.skinThumb, styles.center, { backgroundColor: colors.surface3 }]}>
            <Icon name="auto-fix" size={26} color={colors.accent} />
          </View>
          <Txt variant="caption" numberOfLines={1}>
            Automático
          </Txt>
        </Pressable>
        {list.map((sk) => {
          const on = mode === 'fixed' && current === sk.id;
          return (
            <Pressable
              key={sk.id}
              onPress={() => pick({ cassetteSkinMode: 'fixed', cassetteSkin: sk.id })}
              onLongPress={() => {
                if (!sk.id.startsWith('custom_')) return;
                onClose();
                router.push({ pathname: '/cassette-maker', params: { id: sk.id } });
              }}
              style={[styles.skinCard, on && { borderColor: colors.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={sk.name}
            >
              <LinearGradient
                colors={[sk.shellLight, sk.shell]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.skinThumb}
              >
                <View style={[styles.skinPaper, { backgroundColor: sk.paper }]}>
                  <LinearGradient
                    colors={sk.stripe}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.skinStripe}
                  />
                </View>
              </LinearGradient>
              <Txt variant="caption" numberOfLines={1} style={on && { color: colors.accent }}>
                {sk.name.split(' · ')[0]}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
      {mine ? (
        <SheetItem
          icon="pencil-outline"
          label={`Editar “${mine.name}”`}
          detail="Cambia el que estás usando"
          onPress={() => {
            onClose();
            router.push({ pathname: '/cassette-maker', params: { id: mine.id } });
          }}
        />
      ) : null}
      <SheetItem
        icon="palette-outline"
        label="Crea tu cassette"
        detail="Uno nuevo: colores, degradados y stickers"
        onPress={() => {
          onClose();
          router.push('/cassette-maker');
        }}
      />
    </Sheet>
  );
}

function AmbientLayer({ uri, visible, still }: { uri?: string; visible: boolean; still: boolean }) {
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.set(withTiming(visible ? 1 : 0, { duration: 320 }));
  }, [visible, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <AmbientBackdrop uri={uri} still={still} />
    </Animated.View>
  );
}

function Transport({ onInteract }: { onInteract: () => void }) {
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const act = (fn: () => void) => () => {
    fn();
    onInteract();
  };
  return (
    <View style={styles.transport}>
      <IconButton
        icon={shuffle ? 'shuffle-variant' : 'shuffle-disabled'}
        active={shuffle}
        label="Aleatorio"
        onPress={act(Player.toggleShuffle)}
      />
      <IconButton
        icon="skip-previous"
        size={36}
        label="Anterior"
        onPress={act(Player.prev)}
        onLongPress={act(() => Player.seekBy(-15))}
      />
      <IconButton
        icon={playing ? 'pause' : 'play'}
        size={40}
        filled
        label={playing ? 'Pausar' : 'Reproducir'}
        onPress={act(Player.toggle)}
        style={[styles.playBtn, { shadowColor: colors.accent }]}
      />
      <IconButton
        icon="skip-next"
        size={36}
        label="Siguiente"
        onPress={act(Player.next)}
        onLongPress={act(() => Player.seekBy(15))}
      />
      <IconButton
        icon={repeat === 'one' ? 'repeat-once' : repeat === 'all' ? 'repeat' : 'repeat-off'}
        active={repeat !== 'off'}
        label={`Repetir: ${repeat === 'one' ? 'una' : repeat === 'all' ? 'todas' : 'no'}`}
        onPress={act(Player.cycleRepeat)}
      />
    </View>
  );
}

function Tools({
  mode,
  side,
  onSheet,
  onFlip,
  onInteract,
  onAod,
  onVideo,
  onLock,
  onSkins,
  hasVideo,
  onWatch,
}: {
  mode: Mode;
  side: 'A' | 'B';
  onSheet: (s: 'speed' | 'sleep' | 'fx') => void;
  onFlip: () => void;
  onInteract: () => void;
  /** Present when the always-on display is enabled. */
  onAod?: () => void;
  onVideo: () => void;
  onLock: () => void;
  onSkins: () => void;
  /** The YouTube song has a music video: offer a shortcut to watch it. */
  hasVideo: boolean;
  onWatch: () => void;
}) {
  const rate = usePlayer((s) => s.rate);
  const nightcore = usePlayer((s) => s.nightcore);
  const slowed = usePlayer((s) => s.slowed);
  const fxOn = usePlayer((s) => s.fx.length > 0 || s.nightcore || s.slowed);
  const eqOn = useEq((s) => s.enabled);
  const sleepOn = usePlayer((s) => !!s.sleepAt || s.sleepEndOfTrack);
  const abA = usePlayer((s) => s.abA);
  const abB = usePlayer((s) => s.abB);
  return (
    <View style={styles.tools}>
      {mode === 'cassette' ? (
        <TourTarget id="tool.flip">
          <IconButton
            icon="rotate-3d-variant"
            size={20}
            label={`Voltear al lado ${side === 'A' ? 'B' : 'A'}`}
            onPress={onFlip}
          />
        </TourTarget>
      ) : null}
      {mode === 'cassette' ? (
        <>
          <TourTarget id="tool.skins">
            <IconButton icon="palette-swatch-outline" size={20} label="Estilo del cassette" onPress={onSkins} />
          </TourTarget>
          <TourTarget id="tool.lock">
            <IconButton icon="lock-outline" size={20} label="Bloquear pantalla" onPress={onLock} />
          </TourTarget>
        </>
      ) : null}
      {mode === 'cassette' && onAod ? (
        <TourTarget id="tool.aod">
          <IconButton icon="power-sleep" size={20} label="Pantalla siempre activa" onPress={onAod} />
        </TourTarget>
      ) : null}
      {mode === 'video' ? (
        <TourTarget id="tool.video">
          <IconButton icon="movie-edit-outline" size={20} label="Elegir vídeo" onPress={onVideo} />
        </TourTarget>
      ) : hasVideo ? (
        <TourTarget id="tool.watch">
          <IconButton icon="youtube" size={20} active label="Ver el videoclip" onPress={onWatch} />
        </TourTarget>
      ) : null}
      <TourTarget id="tool.ab">
        <Pressable
          onPress={() => {
            Player.markAB();
            onInteract();
            tap('select');
          }}
          style={[styles.abBtn, abA != null && { borderColor: colors.hires }]}
          accessibilityRole="button"
          accessibilityLabel="Repetición A-B"
        >
          <Txt variant="mono" style={{ color: abA != null ? colors.hires : colors.textDim, fontSize: 11 }}>
            {abA == null ? 'A-B' : abB == null ? 'A→' : 'A↔B'}
          </Txt>
        </Pressable>
      </TourTarget>
      <TourTarget id="tool.speed">
        <IconButton
          icon="speedometer"
          size={20}
          active={rate !== 1 && !nightcore && !slowed}
          label={`Velocidad ${rate}×`}
          onPress={() => onSheet('speed')}
        />
      </TourTarget>
      <TourTarget id="tool.fx">
        <IconButton icon="auto-fix" size={20} active={fxOn} label="Efectos de sonido" onPress={() => onSheet('fx')} />
      </TourTarget>
      <TourTarget id="tool.sleep">
        <IconButton
          icon="timer-outline"
          size={20}
          active={sleepOn}
          label="Temporizador de apagado"
          onPress={() => onSheet('sleep')}
        />
      </TourTarget>
      <TourTarget id="tool.eq">
        <IconButton
          icon="tune-vertical"
          size={20}
          active={eqOn}
          label="Ecualizador"
          onPress={() => router.push('/equalizer')}
        />
      </TourTarget>
    </View>
  );
}

function SpeedSheet({ visible, onClose, onEffects }: { visible: boolean; onClose: () => void; onEffects: () => void }) {
  const rate = usePlayer((s) => s.rate);
  const nightcore = usePlayer((s) => s.nightcore);
  const slowed = usePlayer((s) => s.slowed);
  const pitched = nightcore || slowed;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle sub={nightcore ? 'Nightcore activo' : slowed ? 'Slowed activo' : 'Mantiene el tono original'}>
        Velocidad
      </SheetTitle>
      <View style={styles.rates}>
        {RATES.map((r) => {
          const on = !pitched && rate === r;
          return (
            <Pressable
              key={r}
              onPress={() => {
                tap('select');
                Player.setRate(r);
              }}
              style={[styles.rate, on && { backgroundColor: colors.accent }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Txt variant="bodyStrong" style={on && { color: colors.onAccent }}>
                {`${r}×`}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <SheetItem icon="auto-fix" label="Nightcore, Slowed y efectos…" onPress={onEffects} />
    </Sheet>
  );
}

function FxSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const nightcore = usePlayer((s) => s.nightcore);
  const slowed = usePlayer((s) => s.slowed);
  const fx = usePlayer((s) => s.fx);
  const any = nightcore || slowed || fx.length > 0;
  const preset = FX_PRESETS.find(
    (p) =>
      (p.pitch === 'nightcore') === nightcore &&
      (p.pitch === 'slowed') === slowed &&
      p.fx.length === fx.length &&
      p.fx.every((f) => fx.includes(f)),
  );
  const applyPreset = (p: (typeof FX_PRESETS)[number]) => {
    tap('medium');
    if (p.pitch === 'nightcore') Player.setNightcore(true);
    else if (p.pitch === 'slowed') Player.setSlowed(true);
    else Player.setRate(usePlayer.getState().rate);
    usePlayer.setState({ fx: p.fx });
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle sub={preset ? preset.name : any ? 'Mezcla personalizada' : 'Sonido original'}>Efectos</SheetTitle>
      <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
        <Txt variant="label" style={styles.fxHead}>
          TONO · ELIGE UNO
        </Txt>
        <View style={styles.fxRow}>
          <FxChip
            icon="weather-night"
            label="Nightcore"
            detail={`${NIGHTCORE_RATE}× · más agudo`}
            on={nightcore}
            onPress={() => (tap('select'), Player.setNightcore(!nightcore))}
          />
          <FxChip
            icon="snail"
            label="Slowed"
            detail={`${SLOWED_RATE}× · más grave`}
            on={slowed}
            onPress={() => (tap('select'), Player.setSlowed(!slowed))}
          />
        </View>
        <Txt variant="label" style={styles.fxHead}>
          EFECTOS · COMBÍNALOS
        </Txt>
        {fxSupported ? (
          <View style={styles.fxRow}>
            {FX.map((f) => (
              <FxChip
                key={f.id}
                icon={f.icon}
                label={f.name}
                detail={f.detail}
                on={fx.includes(f.id)}
                onPress={() => (tap('select'), toggleFx(f.id))}
              />
            ))}
          </View>
        ) : (
          <Txt variant="caption" style={{ paddingHorizontal: 20 }}>
            Los efectos necesitan Android con el motor de audio de Quartz.
          </Txt>
        )}
        {fx.includes('lofi') || fx.includes('radio') ? (
          <Txt variant="caption" style={{ paddingHorizontal: 20, paddingTop: 6 }}>
            Lo-fi y Radio son filtros distintos: al activar uno se apaga el otro.
          </Txt>
        ) : null}
        <Txt variant="label" style={styles.fxHead}>
          COMBINACIONES
        </Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>
          {FX_PRESETS.filter((p) => fxSupported || p.fx.length === 0).map((p) => {
            const on = preset?.id === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => applyPreset(p)}
                style={[styles.preset, on && { backgroundColor: colors.accent }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Txt variant="bodyStrong" style={on && { color: colors.onAccent }}>
                  {p.name}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        {any ? (
          <SheetItem
            icon="restore"
            label="Volver al sonido original"
            onPress={() => {
              tap('medium');
              clearFx();
              if (nightcore) Player.setNightcore(false);
              if (slowed) Player.setSlowed(false);
            }}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function FxChip({
  icon,
  label,
  detail,
  on,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  detail: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fxChip, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${label}. ${detail}`}
    >
      <Icon name={icon} size={22} color={on ? colors.accent : colors.text} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="bodyStrong" numberOfLines={1} style={on && { color: colors.accent }}>
          {label}
        </Txt>
        <Txt variant="caption" numberOfLines={2} style={{ fontSize: 11, lineHeight: 14 }}>
          {detail}
        </Txt>
      </View>
    </Pressable>
  );
}

/** Whether your files have anything by this artist (otherwise only YouTube is offered). */
function inLibrary(artist: string) {
  return Object.values(useLibrary.getState().tracks).some((t) => (t.albumArtist ?? t.artist) === artist);
}

function VideoSheet({ visible, onClose, track }: { visible: boolean; onClose: () => void; track: Track }) {
  const own = useMedia((s) => s.trackVideos[track.id]);
  const global = useMedia((s) => s.globalVideo);
  const choose = (forAll: boolean) => {
    onClose();
    pick(forAll ? { kind: 'globalVideo' } : { kind: 'trackVideo', id: track.id, title: track.title });
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle sub="Un vídeo o un GIF. Si el vídeo dura lo mismo que la canción, se sincroniza con ella">
        Fondo del visualizador
      </SheetTitle>
      <SheetItem
        icon="movie-plus-outline"
        label={own ? 'Cambiar el fondo de esta canción' : 'Vídeo o GIF para esta canción'}
        onPress={() => choose(false)}
      />
      <SheetItem
        icon="movie-open-cog-outline"
        label={global ? 'Cambiar el fondo para todas' : 'Vídeo o GIF para todas'}
        detail={global ? 'Activo' : undefined}
        onPress={() => choose(true)}
      />
      {own ? (
        <SheetItem
          icon="movie-remove-outline"
          label="Quitar el fondo de esta canción"
          danger
          onPress={() => {
            forgetUserFile(own);
            useMedia.getState().setTrackVideo(track.id, null);
            onClose();
          }}
        />
      ) : null}
      {global ? (
        <SheetItem
          icon="movie-remove-outline"
          label="Quitar el fondo para todas"
          danger
          onPress={() => {
            forgetUserFile(global);
            useMedia.getState().setGlobalVideo(null);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

function SleepSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const sleepAt = usePlayer((s) => s.sleepAt);
  const endOfTrack = usePlayer((s) => s.sleepEndOfTrack);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!visible || !sleepAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [visible, sleepAt]);
  const left = sleepAt && now ? Math.max(0, Math.round((sleepAt - now) / 60000)) : 0;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle
        sub={sleepAt ? `Se detendrá en ${left} min` : endOfTrack ? 'Se detendrá al terminar la pista' : 'Desactivado'}
      >
        Temporizador de apagado
      </SheetTitle>
      {SLEEP.map((m) => (
        <SheetItem
          key={m}
          icon="timer-outline"
          label={`${m} minutos`}
          onPress={() => (Player.setSleepTimer(m), onClose())}
        />
      ))}
      <SheetItem
        icon="timer-sand"
        label="Al terminar la pista"
        selected={endOfTrack}
        onPress={() => (Player.setSleepEndOfTrack(true), onClose())}
      />
      {sleepAt || endOfTrack ? (
        <SheetItem icon="close" label="Desactivar" danger onPress={() => (Player.setSleepTimer(null), onClose())} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
  topSide: { width: 96, flexDirection: 'row', alignItems: 'center' },
  topCenter: { flex: 1, alignItems: 'center', minWidth: 0 },
  sheetLabel: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 2, fontSize: 11 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  roomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  roomPillText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 },
  fxHead: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  fxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  fxChip: {
    width: '48%',
    flexGrow: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  presets: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  preset: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
    borderRadius: radius.lg,
  },
  panel: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playerDlBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playBtn: { shadowOpacity: 0.45, shadowRadius: 14, elevation: 8 },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  modeCard: {
    width: '48%',
    flexGrow: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  modeCardMain: { flex: 1, height: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14 },
  star: { width: 44, height: '100%', alignItems: 'center', justifyContent: 'center' },
  rates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
  rate: {
    flexGrow: 1,
    minWidth: 64,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  toolsRow: { flexDirection: 'row', justifyContent: 'center' },
  qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  modesScroll: { flexGrow: 0, alignSelf: 'stretch' },
  modes: { flexGrow: 1, flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 2 },
  modeChip: {
    width: 44,
    height: 36,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  tools: { flexDirection: 'row', alignItems: 'center' },
  abBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginHorizontal: 6,
  },
  floatTop: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 24 },
  floatBottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrub: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(11,11,12,0.75)',
  },
  lockWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  lockFill: { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, borderRadius: 32 },
  lockBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,22,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  skinStrip: { gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  skinCard: {
    width: 84,
    gap: 6,
    alignItems: 'center',
    padding: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  skinThumb: { width: 72, height: 46, borderRadius: 7, padding: 5, justifyContent: 'center' },
  skinPaper: { flex: 1, borderRadius: 3, justifyContent: 'center', paddingHorizontal: 3 },
  skinStripe: { height: 9, borderRadius: 2 },
  simNote: {
    position: 'absolute',
    right: 16,
    top: 90,
    backgroundColor: colors.surface2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
