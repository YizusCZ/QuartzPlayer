import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Circle, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { eqSupported } from '@/audio/eq';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { EQ_PRESETS, useEq } from '@/store/eq';
import { colors, radius, useAccent, withAlpha } from '@/theme';
import { EQ_BANDS } from '../../modules/audio-dsp';

const RANGE = 12;
const LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const SLIDER_H = 210;

const fmt = (v: number) => `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}`;

export default function Equalizer() {
  useAccent();
  const { enabled, preamp, gains, preset, set } = useEq();
  const [w, setW] = useState(0);

  const setBand = (i: number, v: number) => {
    const next = gains.slice();
    next[i] = v;
    set({ gains: next, preset: null });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="Ecualizador"
        subtitle={enabled ? 'Activo · 10 bandas' : 'Desactivado'}
        right={
          <Switch
            value={enabled}
            onValueChange={(v) => {
              tap('medium');
              set({ enabled: v });
            }}
            trackColor={{ true: colors.accent, false: colors.surface3 }}
            thumbColor={colors.text}
            accessibilityLabel="Activar ecualizador"
            disabled={!eqSupported}
            style={{ marginRight: 12 }}
          />
        }
      />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}>
        {!eqSupported ? (
          <View style={styles.notice}>
            <Txt variant="bodyStrong">No disponible en este dispositivo</Txt>
            <Txt variant="caption">
              {Platform.OS === 'ios'
                ? 'El ecualizador de Quartz está disponible por ahora en Android.'
                : 'Se necesita Android 9 o superior.'}
            </Txt>
          </View>
        ) : null}

        {/* response curve */}
        <View style={[styles.card, !enabled && { opacity: 0.5 }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          {w > 0 ? <Curve width={w} gains={gains} preamp={preamp} /> : <View style={{ height: 130 }} />}
        </View>

        {/* band sliders */}
        <View style={[styles.card, styles.bands, !enabled && { opacity: 0.5 }]}>
          <View style={styles.scale}>
            {['+12', '+6', '0', '-6', '-12'].map((l) => (
              <Txt key={l} variant="mono" style={{ fontSize: 10 }}>
                {l}
              </Txt>
            ))}
          </View>
          {gains.map((g, i) => (
            <Band key={i} label={LABELS[i]} value={g} onChange={(v) => setBand(i, v)} />
          ))}
        </View>

        {/* preamp */}
        <View style={[styles.card, { gap: 10 }, !enabled && { opacity: 0.5 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt variant="bodyStrong">Preamplificador</Txt>
            <Txt variant="mono" style={{ color: colors.accent }}>
              {fmt(preamp)} dB
            </Txt>
          </View>
          <HSlider min={-12} max={6} value={preamp} onChange={(v) => set({ preamp: v })} />
          <Txt variant="caption" style={{ fontSize: 12 }}>
            Baja el preamplificador cuando subas bandas para conservar margen. Un limitador evita la saturación.
          </Txt>
        </View>

        {/* presets */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Txt variant="label">PRESETS</Txt>
            <Pressable
              onPress={() => set({ gains: EQ_PRESETS[0].gains.slice(), preamp: 0, preset: 'flat' })}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Txt variant="caption" style={{ color: colors.accent }}>
                Restablecer
              </Txt>
            </Pressable>
          </View>
          <View style={styles.presets}>
            {EQ_PRESETS.map((p) => {
              const on = preset === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    tap('select');
                    set({ gains: p.gains.slice(), preamp: p.preamp ?? 0, preset: p.id, enabled: true });
                  }}
                  style={[styles.preset, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                >
                  <Txt variant="bodyStrong" style={[{ fontSize: 14 }, on && { color: colors.onAccent }]}>
                    {p.name}
                  </Txt>
                </Pressable>
              );
            })}
            {preset == null ? (
              <View style={[styles.preset, { borderColor: colors.accent }]}>
                <Txt variant="bodyStrong" style={{ fontSize: 14, color: colors.accent }}>
                  Personalizado
                </Txt>
              </View>
            ) : null}
          </View>
        </View>

        <Txt variant="caption" style={{ fontSize: 12, textAlign: 'center' }}>
          El ecualizador procesa el audio digitalmente; desactívalo para escuchar el archivo sin modificar.
        </Txt>
      </ScrollView>
    </View>
  );
}

/* ───────── response curve ───────── */

function Curve({ width, gains, preamp }: { width: number; gains: number[]; preamp: number }) {
  const h = 130;
  const pad = 14;
  const x = (f: number) =>
    pad + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * (width - pad * 2);
  const y = (db: number) => h / 2 - (Math.max(-RANGE, Math.min(RANGE, db)) / RANGE) * (h / 2 - 10);

  const { line, fill, grid, pts } = useMemo(() => {
    const pts = EQ_BANDS.map((f, i) => ({ x: x(f), y: y(gains[i] + preamp * 0.25) }));
    // Catmull-Rom → cubic Bézier for a smooth, analog-looking response.
    const b = Skia.PathBuilder.Make();
    b.moveTo(pad, pts[0].y);
    b.lineTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      b.cubicTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y,
      );
    }
    b.lineTo(width - pad, pts[pts.length - 1].y);
    const line = b.build();
    const f = Skia.PathBuilder.Make();
    f.addPath(line);
    f.lineTo(width - pad, h / 2);
    f.lineTo(pad, h / 2);
    f.close();
    const g = Skia.PathBuilder.Make();
    for (const db of [-12, -6, 0, 6, 12]) {
      g.moveTo(pad, y(db));
      g.lineTo(width - pad, y(db));
    }
    for (const fr of EQ_BANDS) {
      g.moveTo(x(fr), 6);
      g.lineTo(x(fr), h - 6);
    }
    return { line, fill: f.build(), grid: g.build(), pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, gains, preamp]);

  return (
    <Canvas style={{ width, height: h }}>
      <Path path={grid} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.06)" />
      <Path path={fill}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, h)}
          colors={[withAlpha(colors.accent, 0.35), withAlpha(colors.accent, 0.02), withAlpha(colors.accent, 0.35)]}
        />
      </Path>
      <Path path={line} style="stroke" strokeWidth={2.5} color={colors.accent} />
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={3.5} color={colors.text} />
      ))}
    </Canvas>
  );
}

/* ───────── sliders ───────── */

function Band({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const toValue = (py: number) => {
    const v = RANGE - (Math.max(0, Math.min(SLIDER_H, py)) / SLIDER_H) * RANGE * 2;
    return Math.round(v * 2) / 2;
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => onChange(toValue(e.y)))
    .onUpdate((e) => {
      const v = toValue(e.y);
      if (v !== value) onChange(v);
    });
  const top = ((RANGE - value) / (RANGE * 2)) * SLIDER_H;
  const zero = SLIDER_H / 2;

  return (
    <View style={styles.band}>
      <Pressable
        onPress={() => {
          tap('select');
          onChange(0);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Restablecer ${label} a 0`}
      >
        <Txt variant="mono" style={[styles.bandVal, value !== 0 && { color: colors.accent }]}>
          {fmt(value)}
        </Txt>
      </Pressable>
      <GestureDetector gesture={pan}>
        <View
          style={styles.track}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${label} hercios`}
          accessibilityValue={{ text: `${fmt(value)} decibeles` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            onChange(Math.max(-RANGE, Math.min(RANGE, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))
          }
        >
          <View style={styles.rail} />
          <View
            style={[
              styles.fill,
              { backgroundColor: colors.accent, top: Math.min(top, zero), height: Math.abs(top - zero) },
            ]}
          />
          <View style={styles.zeroTick} />
          <View style={[styles.knob, { top: top - 11 }]} />
        </View>
      </GestureDetector>
      <Txt variant="mono" style={styles.bandLabel}>
        {label}
      </Txt>
    </View>
  );
}

function HSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [w, setW] = useState(1);
  const toValue = (px: number) => Math.round((min + (Math.max(0, Math.min(w, px)) / w) * (max - min)) * 2) / 2;
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => onChange(toValue(e.x)))
    .onUpdate((e) => onChange(toValue(e.x)));
  const frac = (value - min) / (max - min);
  const zero = (0 - min) / (max - min);
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.hTrack} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
        <View style={styles.hRail} />
        <View
          style={[
            styles.hFill,
            {
              backgroundColor: colors.accent,
              left: `${Math.min(frac, zero) * 100}%`,
              width: `${Math.abs(frac - zero) * 100}%`,
            },
          ]}
        />
        <View style={[styles.hKnob, { left: `${frac * 100}%` }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: 14, gap: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
  bands: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  scale: { height: SLIDER_H, marginTop: 26, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 2 },
  band: { alignItems: 'center', flex: 1 },
  bandVal: { fontSize: 10, height: 18 },
  bandLabel: { fontSize: 10, marginTop: 8 },
  track: { height: SLIDER_H, width: 30, alignItems: 'center', marginTop: 8 },
  rail: { position: 'absolute', top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: colors.surface3 },
  fill: { position: 'absolute', width: 4, borderRadius: 2 },
  zeroTick: { position: 'absolute', top: SLIDER_H / 2 - 0.5, width: 14, height: 1, backgroundColor: colors.textMute },
  knob: {
    position: 'absolute',
    width: 26,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.text,
    borderWidth: 3,
    borderColor: colors.surface3,
  },
  hTrack: { height: 32, justifyContent: 'center' },
  hRail: { height: 4, borderRadius: 2, backgroundColor: colors.surface3 },
  hFill: { position: 'absolute', height: 4, borderRadius: 2 },
  hKnob: {
    position: 'absolute',
    width: 22,
    height: 22,
    marginLeft: -11,
    borderRadius: 11,
    backgroundColor: colors.text,
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
});
