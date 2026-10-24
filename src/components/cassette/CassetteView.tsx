/**
 * Animated cassette visualizer.
 *
 * Reel motion follows real tape physics: tape moves at a constant linear
 * speed, so each hub turns at ω = v / r — the nearly-empty reel spins fast,
 * the full one slowly, and the ratio shifts as the song plays. Track changes
 * and seeks visibly wind the tape to its new spot; pausing lets the motor
 * spin down instead of stopping dead.
 *
 * Performance: the static cassette (shell, label, window) is rasterised once
 * per track/size into an image at native pixel density. Each frame only
 * draws that image plus two tape packs and two hubs.
 */
import { useEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, Group, Image, drawAsImage, type SkImage, type Transforms3d } from '@shopify/react-native-skia';
import Animated, {
  type SharedValue,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { playbackTime } from '@/audio/clock';
import { spinKick, transport } from '@/audio/engine';
import { formatLabel, isHiRes, LOSSLESS, type Track } from '@/library/types';
import { useSettings } from '@/store/settings';
import { cassetteFonts, useSkiaFaces } from '../skiaFonts';
import {
  CassetteBase,
  CassetteReels,
  loadStickerImages,
  CASSETTE_H,
  CASSETTE_W,
  PACK_MAX,
  PACK_MIN,
  type CassetteText,
} from './CassetteArt';
import { useSkin } from './customSkins';
import { modelCode, type CassetteSkinId } from './skins';

/** Visual tape speed in design units/s → ~0.9 rev/s on a bare hub. */
const TAPE_V = 300;
/** Winding speed (fraction of the tape per second) for seeks and track changes. */
const WIND_RATE = 0.9;
const WIND_V = 3400;
const SPAN = PACK_MAX * PACK_MAX - PACK_MIN * PACK_MIN;

export function skinFor(track: Track | undefined, mode: 'auto' | 'fixed', fixed: CassetteSkinId): CassetteSkinId {
  if (mode === 'fixed' || !track) return fixed;
  if (isHiRes(track.format)) return 'metal';
  if (LOSSLESS.includes(track.format.codec)) return 'magenta';
  return 'sunset';
}

function layout(width: number, height: number) {
  const portrait = height > width * 1.05;
  const pad = 16;
  const scale = portrait
    ? Math.min((width - pad * 2) / CASSETTE_H, (height - pad * 2) / CASSETTE_W)
    : Math.min((width - pad * 2) / CASSETTE_W, (height - pad * 2) / CASSETTE_H);
  const transform: Transforms3d = portrait
    ? [
        { translateX: width / 2 },
        { translateY: height / 2 },
        { rotate: -Math.PI / 2 },
        { scale },
        { translateX: -CASSETTE_W / 2 },
        { translateY: -CASSETTE_H / 2 },
      ]
    : [
        { translateX: width / 2 },
        { translateY: height / 2 },
        { scale },
        { translateX: -CASSETTE_W / 2 },
        { translateY: -CASSETTE_H / 2 },
      ];
  return { scale, transform };
}

type Props = {
  track: Track | undefined;
  width: number;
  height: number;
  /** Changing the side plays the turn-over animation. */
  side: 'A' | 'B';
  /**
   * Horizontal finger offset while you scrub the tape (px). The cassette
   * follows and tilts with it, and the reels spin with the finger's speed.
   */
  drag?: SharedValue<number>;
};

/** The last few rasterised cassettes, so switching back to this mode is instant. */
const rasters = new Map<string, SkImage>();
const remember = (key: string, img: SkImage) => {
  rasters.delete(key);
  rasters.set(key, img);
  if (rasters.size > 4) rasters.delete(rasters.keys().next().value as string);
};

export function CassetteView({ track, width, height, side: requestedSide, drag }: Props) {
  const faces = useSkiaFaces();
  const fonts = useMemo(() => (faces ? cassetteFonts(faces) : null), [faces]);
  const cassetteSkin = useSettings((s) => s.cassetteSkin);
  const cassetteSkinMode = useSettings((s) => s.cassetteSkinMode);
  const handwritten = useSettings((s) => s.handwrittenLabel);
  const [side, setSide] = useState<'A' | 'B'>(requestedSide);
  const [drawn, setDrawn] = useState<{ key: string; img: SkImage } | null>(null);
  const appear = useSharedValue(0);
  const lastDrag = useSharedValue(0);

  const angleL = useSharedValue(0);
  const angleR = useSharedValue(0);
  const shown = useSharedValue(0);
  const motor = useSharedValue(0);
  const kickT = useSharedValue(0);
  const kickDir = useSharedValue(0);
  const mirror = useSharedValue(1); // 1 on side A, -1 on side B
  const flip = useSharedValue(0);

  useEffect(() => {
    mirror.value = side === 'A' ? 1 : -1;
  }, [side, mirror]);

  useFrameCallback((frame) => {
    'worklet';
    const dt = Math.min(0.05, (frame.timeSincePreviousFrame ?? 16) / 1000);
    const t = transport.value;

    motor.value += ((t.playing ? 1 : 0) - motor.value) * Math.min(1, dt * 5);

    const target = t.duration > 0 ? Math.min(1, Math.max(0, playbackTime() / t.duration)) : 0;

    // Wind toward the target when it jumps (seek / new track).
    const gap = target - shown.value;
    let wind = 0;
    if (Math.abs(gap) > 0.004) {
      shown.value += Math.sign(gap) * Math.min(Math.abs(gap), WIND_RATE * dt);
      wind = Math.sign(gap) * WIND_V;
    } else {
      shown.value = target;
    }

    // Transport button impulses give a short whirr even without a gap.
    if (spinKick.value !== 0) {
      kickDir.value = Math.sign(spinKick.value);
      kickT.value = 0.45;
      spinKick.value = 0;
    }
    if (kickT.value > 0) {
      kickT.value -= dt;
      if (wind === 0) wind = kickDir.value * WIND_V * Math.min(1, kickT.value * 3);
    }

    // Scrubbing: the tape moves with the finger.
    if (drag) {
      const d = drag.value;
      const vel = (d - lastDrag.value) / Math.max(dt, 0.001);
      lastDrag.value = d;
      if (vel !== 0) wind = vel * 6;
    }

    const v = (motor.value * TAPE_V * t.rate + wind) * mirror.value;
    const p = mirror.value > 0 ? shown.value : 1 - shown.value;
    const rL = Math.sqrt(PACK_MIN * PACK_MIN + (1 - p) * SPAN);
    const rR = Math.sqrt(PACK_MIN * PACK_MIN + p * SPAN);
    // Both hubs turn counter-clockwise on side A while tape runs left → right.
    angleL.value -= (v / rL) * dt;
    angleR.value -= (v / rR) * dt;
  });

  const packL = useDerivedValue(() => {
    const p = mirror.value > 0 ? shown.value : 1 - shown.value;
    return Math.sqrt(PACK_MIN * PACK_MIN + (1 - p) * SPAN);
  });
  const packR = useDerivedValue(() => {
    const p = mirror.value > 0 ? shown.value : 1 - shown.value;
    return Math.sqrt(PACK_MIN * PACK_MIN + p * SPAN);
  });
  const hubL = useDerivedValue(() => [{ rotate: angleL.value }]);
  const hubR = useDerivedValue(() => [{ rotate: angleR.value }]);

  useEffect(() => {
    if (requestedSide === side) return;
    const swap = () => setSide(requestedSide);
    flip.value = withSequence(
      withTiming(90, { duration: 220, easing: Easing.in(Easing.quad) }, () => scheduleOnRN(swap)),
      withTiming(-90, { duration: 0 }),
      withTiming(0, { duration: 280, easing: Easing.out(Easing.back(1.4)) }),
    );
  }, [requestedSide, side, flip]);

  const flipStyle = useAnimatedStyle(() => {
    const d = drag ? drag.value : 0;
    return {
      opacity: appear.value,
      transform: [
        { perspective: 1400 },
        { translateX: d * 0.22 },
        { rotateY: `${flip.value + Math.max(-18, Math.min(18, d * 0.06))}deg` },
        { rotateZ: `${Math.max(-4, Math.min(4, d * 0.012))}deg` },
      ],
    };
  });

  const skinId = skinFor(track, cassetteSkinMode, cassetteSkin);
  const skin = useSkin(skinId);
  const { scale, transform } = layout(width, height);
  const ratio = PixelRatio.get();

  const text: CassetteText = useMemo(
    () =>
      side === 'A'
        ? {
            title: track?.title ?? 'Sin cinta',
            artist: track?.artist ?? 'Elige una canción',
            album: track ? [track.album, track.year].filter(Boolean).join(' · ') : '',
            caption: track ? formatLabel(track.format) : '',
            side,
            model: modelCode(skinId, track?.duration ?? 0),
            handwritten,
          }
        : {
            title: track?.album ?? '',
            artist: track ? (track.albumArtist ?? track.artist) : '',
            album: track ? [track.genre, track.year].filter(Boolean).join(' · ') : '',
            caption: track ? formatLabel(track.format) : '',
            side,
            model: modelCode(skinId, track?.duration ?? 0),
            handwritten,
          },
    [track, side, skinId, handwritten],
  );

  const rasterKey = `${skinId}|${JSON.stringify(skin.stickers ?? [])}|${skin.shell}${skin.paper}${skin.stripe.join()}${skin.band.join()}${skin.window.join()}${skin.arrow}${skin.ink}|${JSON.stringify(text)}|${width}x${height}@${ratio}`;
  const base = rasters.get(rasterKey) ?? (drawn?.key === rasterKey ? drawn.img : null);

  // Fade in once the cassette is drawn: it never pops in over an empty frame.
  useEffect(() => {
    appear.set(base ? withTiming(1, { duration: 220 }) : 0);
  }, [base, appear]);

  // Rasterise the static layer whenever its content or size changes.
  useEffect(() => {
    if (!fonts || width <= 0 || height <= 0 || rasters.has(rasterKey)) return;
    let alive = true;
    const { transform: t, scale: s } = layout(width, height);
    const el = (
      <Group transform={[{ scale: ratio }, ...t]}>
        <CassetteBase skin={skin} fonts={fonts} px={s * ratio} {...text} />
      </Group>
    );
    void loadStickerImages(skin.stickers)
      .then(() => drawAsImage(el, { width: Math.round(width * ratio), height: Math.round(height * ratio) }))
      .then((img) => {
        if (!img) return;
        remember(rasterKey, img);
        if (alive) setDrawn({ key: rasterKey, img });
      });
    return () => {
      alive = false;
    };
  }, [fonts, skin, text, width, height, ratio, rasterKey]);

  if (!fonts || width <= 0 || height <= 0) return <View style={{ width, height }} />;

  return (
    <Animated.View
      style={[{ width, height }, flipStyle]}
      accessible
      accessibilityLabel={`Cassette, lado ${side}: ${text.title}, ${text.artist}`}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        {base ? (
          <>
            <Group transform={transform}>
              <CassetteReels skin={skin} px={scale * ratio} hubL={hubL} hubR={hubR} packL={packL} packR={packR} />
            </Group>
            <Image image={base} x={0} y={0} width={width} height={height} fit="fill" />
          </>
        ) : null}
      </Canvas>
    </Animated.View>
  );
}
