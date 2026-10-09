import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { router, useNavigation } from 'expo-router';
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
import { NIGHTCORE_RATE, Player, SLOWED_RATE } from '@/audio/engine';
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
import { MotionCover, VideoStage } from '@/components/visualizers/VideoStage';
import { LyricsView } from '@/components/visualizers/LyricsView';
import { LedView, MirrorView, RadialView, SpectrumView } from '@/components/visualizers/SpectrumView';
import { QualityPanel } from '@/components/QualityPanel';
import { AmbientBackdrop } from '@/components/AmbientBackdrop';
import { AudioRouteChip, AudioRoutePanel } from '@/components/AudioRouteChip';
import { tierOf } from '@/library/quality';
import type { Track } from '@/library/types';
import { VUMeterView } from '@/components/visualizers/VUMeterView';
import { tap } from '@/lib/haptics';
import { useAppActive } from '@/lib/useAppActive';
import { useLibrary } from '@/store/library';
import { currentTrackId, usePlayer } from '@/store/player';
import { useSettings, VISUALIZERS, type PlayerMode } from '@/store/settings';
import { MODES } from '@/lib/modes';
import { useEq } from '@/store/eq';
import { useUI } from '@/store/ui';
import { useMedia } from '@/store/media';
import { forgetUserFile, pick } from '@/lib/userMedia';
import { colors, radius, useAccent } from '@/theme';

type Mode = PlayerMode;
const HIDE_AFTER = 4000;
const RATES = [0.75, 0.9, 1, 1.1, 1.25, 1.5];
const SLEEP = [15, 30, 45, 60, 90];

export default function PlayerScreen() {
  useAccent();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const id = usePlayer(currentTrackId);
  const track = useLibrary((s) => (id ? s.tracks[id] : undefined));
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

  const [mode, setMode] = useState<Mode>(playing && autoVisualizer ? lastVisualizer : 'cover');
  const [side, setSide] = useState<'A' | 'B'>('A');
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<
    'none' | 'speed' | 'sleep' | 'more' | 'quality' | 'modes' | 'route' | 'artist' | 'fx' | 'video'
  >('none');
  const [analyzer, setAnalyzer] = useState<AnalyzerMode>('off');
  const [chromeTick, setChromeTick] = useState(0);
  const chromeOpacity = useSharedValue(1);
  const [aod, setAod] = useState(false);

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
  const chromeShown = chrome || !immersive || !playing;
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
  // The moment the player starts closing, everything that animates stops, so
  // the slide down to the mini player runs on an idle UI thread.
  const [closing, setClosing] = useState(false);
  useEffect(() => navigation.addListener('beforeRemove', () => setClosing(true)), [navigation]);
  const live = ready && active && !closing;
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
    if (!((immersive && keepAwake && playing) || aodShown)) return;
    // Both reject once the activity is gone (closing the player, app backgrounded).
    activateKeepAwakeAsync('quartz-visualizer').catch(() => {});
    return () => void deactivateKeepAwake('quartz-visualizer').catch(() => {});
  }, [immersive, keepAwake, playing, aodShown]);

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
  const dismiss = () => {
    setClosing(true);
    dragY.set(
      withTiming(height, { duration: 240, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(finishClose);
      }),
    );
  };
  const onDoubleTap = () => {
    if (mode === 'cassette') flipSide();
  };
  const onSingleTap = () => {
    if (!immersive) return;
    if (chromeShown) setChrome(false);
    else showChrome();
  };

  const swipe = Gesture.Pan()
    .onTouchesDown(skipChrome)
    .activeOffsetX([-30, 30])
    .failOffsetY([-25, 25])
    .onEnd((e) => {
      'worklet';
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
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(dismiss);
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
        <IconButton icon="chevron-down" size={28} label="Cerrar reproductor" onPress={dismiss} />
      </View>
      <View style={styles.topCenter}>
        <Txt variant="label" numberOfLines={1} style={{ textAlign: 'center' }}>
          {playing ? 'REPRODUCIENDO' : 'EN PAUSA'} · {index + 1}/{total}
        </Txt>
        <AudioRouteChip onPress={() => setSheet('route')} />
      </View>
      <View style={[styles.topSide, { justifyContent: 'flex-end' }]}>
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
  );

  const tier = tierOf(track.format);
  const info = (
    <View style={{ gap: 6 }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" numberOfLines={1}>
            {track.title}
          </Txt>
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
        <FormatBadge format={track.format} />
        <Txt variant="caption" numberOfLines={1} style={{ color: tier.color, flexShrink: 1 }}>
          {tier.name}
        </Txt>
        <Icon name="chevron-right" size={16} color={colors.textMute} />
      </Pressable>
    </View>
  );

  const controls = <Transport onInteract={showChrome} />;
  const tools = (
    <Tools
      mode={mode}
      onSheet={setSheet}
      onFlip={flipSide}
      side={side}
      onInteract={showChrome}
      onAod={aodEnabled ? () => (setAod(true), tap('medium')) : undefined}
      onVideo={() => setSheet('video')}
    />
  );

  const stageView =
    stage.w > 0 ? (
      mode === 'cover' || !live ? (
        <View style={styles.center}>
          <Animated.View entering={FadeIn} style={styles.coverShadow}>
            <MotionCover
              track={track}
              size={Math.min(stage.w - 32, stage.h - 16, 520)}
              radius={radius.lg}
              active={live}
            />
          </Animated.View>
        </View>
      ) : mode === 'cassette' ? (
        <CassetteView track={track} width={stage.w} height={stage.h} side={side} />
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
  const albumKey = `${track.albumArtist ?? track.artist}\u0000${track.album}`;
  const artistKey = track.albumArtist ?? track.artist;

  const sheets = (
    <>
      <Sheet visible={sheet === 'artist'} onClose={() => setSheet('none')}>
        <SheetTitle sub={track.album}>{track.artist}</SheetTitle>
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
      </Sheet>
      <SpeedSheet visible={sheet === 'speed'} onClose={() => setSheet('none')} onEffects={() => setSheet('fx')} />
      <FxSheet visible={sheet === 'fx'} onClose={() => setSheet('none')} />
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
  if (immersive && aodShown && live) {
    return <CassetteAOD track={track} side={side} onWake={wakeFromAod} />;
  }
  if (immersive) {
    return (
      <Animated.View style={[styles.screen, showAmbient && { backgroundColor: 'transparent' }, dropStyle]}>
        {showAmbient && active ? <AmbientBackdrop uri={track.artwork} still={!ready || closing} /> : null}
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
            <View style={{ flex: 1 }} onLayout={onStageLayout} collapsable={false}>
              {stageView}
            </View>
          </View>
        </GestureDetector>
        {simNote}
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
            <SeekBar />
            {controls}
            <View style={styles.toolsRow}>{tools}</View>
            {modeChips}
          </View>
          {chromeCatcher}
        </Animated.View>
        {sheets}
      </Animated.View>
    );
  }

  /* ── cover layout (Walkman-style now playing) ── */
  return (
    <Animated.View style={[styles.screen, showAmbient && { backgroundColor: 'transparent' }, dropStyle]}>
      {showAmbient && active ? <AmbientBackdrop uri={track.artwork} still={!ready || closing} /> : null}
      {topBar}
      <View style={[{ flex: 1 }, landscape && { flexDirection: 'row' }]}>
        <GestureDetector gesture={stageGesture}>
          <View style={{ flex: landscape ? 1 : 1.25 }} onLayout={onStageLayout} collapsable={false}>
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
          <SeekBar />
          {controls}
          <View style={styles.toolsRow}>{tools}</View>
          {modeChips}
        </View>
      </View>
      {sheets}
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
}: {
  mode: Mode;
  side: 'A' | 'B';
  onSheet: (s: 'speed' | 'sleep' | 'fx') => void;
  onFlip: () => void;
  onInteract: () => void;
  /** Present when the always-on display is enabled. */
  onAod?: () => void;
  onVideo: () => void;
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
        <IconButton
          icon="rotate-3d-variant"
          size={20}
          label={`Voltear al lado ${side === 'A' ? 'B' : 'A'}`}
          onPress={onFlip}
        />
      ) : null}
      {mode === 'cassette' && onAod ? (
        <IconButton icon="power-sleep" size={20} label="Pantalla siempre activa" onPress={onAod} />
      ) : null}
      {mode === 'video' ? (
        <IconButton icon="movie-edit-outline" size={20} label="Elegir vídeo" onPress={onVideo} />
      ) : null}
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
      <IconButton
        icon="speedometer"
        size={20}
        active={rate !== 1 && !nightcore && !slowed}
        label={`Velocidad ${rate}×`}
        onPress={() => onSheet('speed')}
      />
      <IconButton icon="auto-fix" size={20} active={fxOn} label="Efectos de sonido" onPress={() => onSheet('fx')} />
      <IconButton
        icon="timer-outline"
        size={20}
        active={sleepOn}
        label="Temporizador de apagado"
        onPress={() => onSheet('sleep')}
      />
      <IconButton
        icon="tune-vertical"
        size={20}
        active={eqOn}
        label="Ecualizador"
        onPress={() => router.push('/equalizer')}
      />
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

function VideoSheet({ visible, onClose, track }: { visible: boolean; onClose: () => void; track: Track }) {
  const own = useMedia((s) => s.trackVideos[track.id]);
  const global = useMedia((s) => s.globalVideo);
  const choose = (forAll: boolean) => {
    onClose();
    pick(forAll ? { kind: 'globalVideo' } : { kind: 'trackVideo', id: track.id, title: track.title });
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle sub="Si dura lo mismo que la canción, se sincroniza con ella">Vídeo del visualizador</SheetTitle>
      <SheetItem
        icon="movie-plus-outline"
        label={own ? 'Cambiar el vídeo de esta canción' : 'Elegir vídeo para esta canción'}
        onPress={() => choose(false)}
      />
      <SheetItem
        icon="movie-open-cog-outline"
        label={global ? 'Cambiar el vídeo para todas' : 'Usar un vídeo para todas'}
        detail={global ? 'Activo' : undefined}
        onPress={() => choose(true)}
      />
      {own ? (
        <SheetItem
          icon="movie-remove-outline"
          label="Quitar el vídeo de esta canción"
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
          label="Quitar el vídeo para todas"
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
