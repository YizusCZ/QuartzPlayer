import { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Canvas, Circle, LinearGradient, Path, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import { LinearGradient as Gradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { eqSupported } from '@/audio/eq';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Sheet, SheetTitle } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { tap } from '@/lib/haptics';
import { EQ_GROUPS, EQ_PRESETS, useEq, type EqPreset } from '@/store/eq';
import { colors, fonts, radius, useAccent, withAlpha } from '@/theme';
import { EQ_BANDS } from '../../modules/audio-dsp';

const RANGE = 12;
const LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const SLIDER_H = 190;
const CURVE_H = 150;
/** Bands moved together by the quick tone controls. */
const TONES = [
  { name: 'Graves', bands: [0, 1, 2] },
  { name: 'Medios', bands: [3, 4, 5, 6] },
  { name: 'Agudos', bands: [7, 8, 9] },
];

/** Nivelador strengths. */
const LEVELS = [
  { name: 'No', value: 0 },
  { name: 'Suave', value: 0.35 },
  { name: 'Medio', value: 0.65 },
  { name: 'Fuerte', value: 1 },
];
const PRESET_GAP = 8;

const fmt = (v: number) => `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}`;
const clamp = (v: number) => Math.max(-RANGE, Math.min(RANGE, v));
const half = (v: number) => Math.round(v * 2) / 2;

export default function Equalizer() {
  useAccent();
  const { enabled, preamp, gains, preset, custom, balance, leveling, autoGain, set } = useEq();
  const [w, setW] = useState(0);
  const { width: screenW } = useWindowDimensions();
  // Three presets per row, every one in view: no sideways scrolling.
  const cardW = Math.floor((screenW - 32 - PRESET_GAP * 2) / 3);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const setGains = (next: number[]) => set({ gains: next, preset: null, enabled: true });
  const setBand = (i: number, v: number) => {
    if (gains[i] === v) return;
    const next = gains.slice();
    next[i] = v;
    setGains(next);
  };
  const presets = [...EQ_PRESETS, ...custom];
  const current = presets.find((p) => p.id === preset);
  // Boosting bands without lowering the preamp eats the headroom.
  const peak = autoGain ? 0 : Math.max(...gains) + preamp;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Ecualizador" subtitle="10 bandas · presets · balance · nivelador" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
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

        {/* power */}
        <Pressable
          disabled={!eqSupported}
          onPress={() => (tap('medium'), set({ enabled: !enabled }))}
          style={styles.power}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
        >
          {enabled ? (
            <Gradient
              colors={[withAlpha(colors.accent, 0.35), withAlpha(colors.accent, 0.05)]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[styles.powerIcon, { backgroundColor: enabled ? colors.accent : colors.surface3 }]}>
            <Icon name="power" size={24} color={enabled ? colors.onAccent : colors.textDim} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading">{enabled ? 'Ecualizador activo' : 'Ecualizador apagado'}</Txt>
            <Txt variant="caption">
              {enabled
                ? current
                  ? `Preset: ${current.name}`
                  : 'Ajuste personalizado'
                : 'Escuchas el audio sin modificar'}
            </Txt>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => (tap('medium'), set({ enabled: v }))}
            trackColor={{ true: colors.accent, false: colors.surface3 }}
            thumbColor={colors.text}
            accessibilityLabel="Activar ecualizador"
            disabled={!eqSupported}
          />
        </Pressable>

        {/* response curve: draw on it */}
        <View style={[styles.card, !enabled && styles.off]} onLayout={(e) => setW(e.nativeEvent.layout.width - 24)}>
          <View style={styles.cardHead}>
            <Txt variant="label">RESPUESTA</Txt>
            <Txt variant="caption" style={{ fontSize: 12 }}>
              Desliza el dedo para dibujarla
            </Txt>
          </View>
          {w > 0 ? (
            <Curve width={w} gains={gains} preamp={preamp} onBand={setBand} />
          ) : (
            <View style={{ height: CURVE_H }} />
          )}
          <View style={styles.freqs}>
            {['20', '100', '1k', '10k', '20k'].map((l) => (
              <Txt key={l} variant="mono" style={{ fontSize: 10, color: colors.textMute }}>
                {l}
              </Txt>
            ))}
          </View>
          {peak > 3 ? (
            <Pressable
              onPress={() => (tap('select'), set({ preamp: Math.max(-12, half(preamp - (peak - 1))) }))}
              style={styles.warn}
              accessibilityRole="button"
            >
              <Icon name="alert-outline" size={16} color={colors.hires} />
              <Txt variant="caption" style={{ flex: 1, color: colors.hires, fontSize: 12 }}>
                Las bandas altas pueden saturar. Toca para bajar el preamplificador.
              </Txt>
            </Pressable>
          ) : null}
        </View>

        {/* presets: all at once, grouped */}
        <View style={{ gap: 12 }}>
          <View style={styles.rowBetween}>
            <Txt variant="label">PRESETS</Txt>
            <Pressable
              onPress={() => (tap('select'), set({ gains: EQ_PRESETS[0].gains.slice(), preamp: 0, preset: 'flat' }))}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Txt variant="caption" style={{ color: colors.accent }}>
                Restablecer
              </Txt>
            </Pressable>
          </View>
          {[
            { id: 'mine', name: 'Tuyos', items: custom },
            ...EQ_GROUPS.map((g) => ({ ...g, items: EQ_PRESETS.filter((p) => p.group === g.id) })),
          ].map((g) => (
            <View key={g.id} style={{ gap: 8 }}>
              <Txt variant="caption" style={styles.groupName}>
                {g.name}
              </Txt>
              <View style={styles.presetGrid}>
                {g.id === 'mine' ? (
                  <Pressable
                    onPress={() => (tap('select'), setName(''), setNaming(true))}
                    style={[styles.presetCard, styles.saveCard, { width: cardW }]}
                    accessibilityRole="button"
                    accessibilityLabel="Guardar el ajuste actual"
                  >
                    <Icon name="content-save-outline" size={22} color={colors.accent} />
                    <Txt variant="bodyStrong" style={{ fontSize: 12, color: colors.accent, textAlign: 'center' }}>
                      Guardar actual
                    </Txt>
                  </Pressable>
                ) : null}
                {g.items.map((p) => (
                  <PresetCard
                    key={p.id}
                    width={cardW}
                    preset={p}
                    on={preset === p.id}
                    onPress={() => {
                      tap('select');
                      set({ gains: p.gains.slice(), preamp: p.preamp ?? 0, preset: p.id, enabled: true });
                    }}
                    onLongPress={
                      p.id.startsWith('user_')
                        ? () =>
                            Alert.alert('Eliminar preset', `¿Eliminar “${p.name}”?`, [
                              { text: 'Cancelar', style: 'cancel' },
                              {
                                text: 'Eliminar',
                                style: 'destructive',
                                onPress: () => useEq.getState().removeCustom(p.id),
                              },
                            ])
                        : undefined
                    }
                  />
                ))}
              </View>
              {g.id === 'mine' && custom.length ? (
                <Txt variant="caption" style={{ fontSize: 12 }}>
                  Mantén pulsado uno tuyo para eliminarlo.
                </Txt>
              ) : null}
            </View>
          ))}
        </View>

        {/* quick tone */}
        <View style={[styles.card, { gap: 14 }, !enabled && styles.off]}>
          <Txt variant="label">TONO RÁPIDO</Txt>
          {TONES.map((t) => {
            const avg = half(t.bands.reduce((a, i) => a + gains[i], 0) / t.bands.length);
            return (
              <View key={t.name} style={{ gap: 4 }}>
                <View style={styles.rowBetween}>
                  <Txt variant="bodyStrong">{t.name}</Txt>
                  <Txt variant="mono" style={avg !== 0 && { color: colors.accent }}>
                    {fmt(avg)} dB
                  </Txt>
                </View>
                <HSlider
                  min={-RANGE}
                  max={RANGE}
                  value={avg}
                  onChange={(v) => {
                    if (v === avg) return;
                    const next = gains.slice();
                    for (const i of t.bands) next[i] = half(clamp(gains[i] + v - avg));
                    setGains(next);
                  }}
                />
              </View>
            );
          })}
        </View>

        {/* band sliders */}
        <View style={[styles.card, !enabled && styles.off]}>
          <View style={styles.cardHead}>
            <Txt variant="label">BANDAS</Txt>
            <Txt variant="caption" style={{ fontSize: 12 }}>
              Toca el valor para volver a 0
            </Txt>
          </View>
          <View style={styles.bands}>
            <View pointerEvents="none" style={styles.gridLines}>
              {[RANGE, RANGE / 2, 0, -RANGE / 2, -RANGE].map((db) => (
                <View
                  key={db}
                  style={[
                    styles.gridLine,
                    { top: ((RANGE - db) / (RANGE * 2)) * SLIDER_H },
                    db === 0 && { backgroundColor: colors.textMute, opacity: 0.6 },
                  ]}
                />
              ))}
            </View>
            {gains.map((g, i) => (
              <Band key={i} label={LABELS[i]} value={g} onChange={(v) => setBand(i, v)} />
            ))}
          </View>
        </View>

        {/* preamp */}
        <View style={[styles.card, { gap: 10 }, !enabled && styles.off]}>
          <View style={styles.rowBetween}>
            <Txt variant="bodyStrong">Preamplificador</Txt>
            <Txt variant="mono" style={{ color: colors.accent }}>
              {fmt(preamp)} dB
            </Txt>
          </View>
          <HSlider min={-12} max={6} value={preamp} onChange={(v) => v !== preamp && set({ preamp: v })} />
          <Txt variant="caption" style={{ fontSize: 12 }}>
            Bájalo cuando subas bandas para conservar margen. Un limitador evita la saturación.
          </Txt>
        </View>

        {/* more */}
        <View style={[styles.card, { gap: 14 }, !enabled && styles.off]}>
          <Txt variant="label">MÁS OPCIONES</Txt>
          <View style={{ gap: 4 }}>
            <View style={styles.rowBetween}>
              <Txt variant="bodyStrong">Balance</Txt>
              <Txt variant="mono" style={balance !== 0 && { color: colors.accent }}>
                {balance === 0 ? 'Centro' : `${balance < 0 ? 'Izq.' : 'Der.'} ${Math.round(Math.abs(balance) * 100)} %`}
              </Txt>
            </View>
            <HSlider
              min={-1}
              max={1}
              step={0.05}
              value={balance}
              onChange={(v) => v !== balance && set({ balance: v })}
            />
            <View style={styles.rowBetween}>
              <Txt variant="caption" style={{ fontSize: 11 }}>
                I
              </Txt>
              <Pressable onPress={() => (tap('select'), set({ balance: 0 }))} hitSlop={8} accessibilityRole="button">
                <Txt variant="caption" style={{ fontSize: 11, color: colors.accent }}>
                  Centrar
                </Txt>
              </Pressable>
              <Txt variant="caption" style={{ fontSize: 11 }}>
                D
              </Txt>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <View style={{ gap: 2 }}>
              <Txt variant="bodyStrong">Nivelador de volumen</Txt>
              <Txt variant="caption" style={{ fontSize: 12 }}>
                Acerca las partes suaves y las fuertes: ideal de noche, en el auto o con ruido.
              </Txt>
            </View>
            <View style={styles.segment}>
              {LEVELS.map((l) => {
                const on = Math.abs(leveling - l.value) < 0.01;
                return (
                  <Pressable
                    key={l.name}
                    onPress={() => (tap('select'), set({ leveling: l.value }))}
                    style={[styles.segmentItem, on && { backgroundColor: colors.accent }]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Txt variant="bodyStrong" style={[{ fontSize: 13 }, on && { color: colors.onAccent }]}>
                      {l.name}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong">Margen automático</Txt>
              <Txt variant="caption" style={{ fontSize: 12 }}>
                Baja el preamplificador lo que suba la banda más alta, para que nada sature.
              </Txt>
            </View>
            <Switch
              value={autoGain}
              onValueChange={(v) => (tap('select'), set({ autoGain: v }))}
              trackColor={{ true: colors.accent, false: colors.surface3 }}
              thumbColor={colors.text}
              accessibilityLabel="Margen automático"
            />
          </View>
        </View>
      </ScrollView>

      <Sheet visible={naming} onClose={() => setNaming(false)}>
        <SheetTitle sub="Guarda la curva y el preamplificador actuales">Nuevo preset</SheetTitle>
        <View style={{ paddingHorizontal: 20, gap: 12, paddingBottom: 8 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nombre del preset"
            placeholderTextColor={colors.textMute}
            style={styles.input}
            autoFocus
            maxLength={24}
          />
          <Pressable
            disabled={!name.trim()}
            onPress={() => {
              tap('medium');
              useEq.getState().saveCustom(name.trim());
              setNaming(false);
            }}
            style={[styles.saveBtn, { backgroundColor: colors.accent }, !name.trim() && { opacity: 0.4 }]}
            accessibilityRole="button"
          >
            <Txt variant="bodyStrong" style={{ color: colors.onAccent }}>
              Guardar
            </Txt>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

/* ───────── curves ───────── */

function curvePath(gains: number[], width: number, h: number, pad: number, shift = 0) {
  const x = (f: number) =>
    pad + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * (width - pad * 2);
  const y = (db: number) => h / 2 - (clamp(db) / RANGE) * (h / 2 - pad);
  const pts = EQ_BANDS.map((f, i) => ({ x: x(f), y: y(gains[i] + shift) }));
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
  return { line, fill: f.build(), pts, x, y };
}

function Curve({
  width,
  gains,
  preamp,
  onBand,
}: {
  width: number;
  gains: number[];
  preamp: number;
  onBand: (i: number, v: number) => void;
}) {
  const h = CURVE_H;
  const pad = 12;
  const shift = preamp * 0.25;
  const { line, fill, grid, pts, xs } = useMemo(() => {
    const c = curvePath(gains, width, h, pad, shift);
    const g = Skia.PathBuilder.Make();
    for (const db of [-12, -6, 0, 6, 12]) {
      g.moveTo(pad, c.y(db));
      g.lineTo(width - pad, c.y(db));
    }
    for (const fr of EQ_BANDS) {
      g.moveTo(c.x(fr), 4);
      g.lineTo(c.x(fr), h - 4);
    }
    return { ...c, grid: g.build() as SkPath, xs: EQ_BANDS.map((f) => c.x(f)) };
  }, [gains, width, h, shift]);

  // Each touch moves the band nearest to the finger, so a swipe draws the curve.
  const touch = (px: number, py: number) => {
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    const db = ((h / 2 - py) / (h / 2 - pad)) * RANGE - shift;
    onBand(best, half(clamp(db)));
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => touch(e.x, e.y))
    .onUpdate((e) => touch(e.x, e.y));

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width, height: h }}>
        <Path path={grid} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.06)" />
        <Path path={fill}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, h)}
            colors={[withAlpha(colors.accent, 0.4), withAlpha(colors.accent, 0.02), withAlpha(colors.accent, 0.4)]}
          />
        </Path>
        <Path path={line} style="stroke" strokeWidth={6} color={withAlpha(colors.accent, 0.18)} />
        <Path path={line} style="stroke" strokeWidth={2.5} color={colors.accent} />
        {pts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={5} color={colors.bg} />
        ))}
        {pts.map((p, i) => (
          <Circle key={`r${i}`} cx={p.x} cy={p.y} r={5} color={colors.text} style="stroke" strokeWidth={2} />
        ))}
      </Canvas>
    </GestureDetector>
  );
}

function PresetCard({
  preset,
  width,
  on,
  onPress,
  onLongPress,
}: {
  preset: EqPreset;
  width: number;
  on: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const W = width - 18;
  const H = 28;
  const { line, fill } = useMemo(() => curvePath(preset.gains, W, H, 3), [preset.gains, W]);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.presetCard, { width }, on && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={preset.name}
    >
      <Canvas style={{ width: W, height: H }}>
        <Path path={fill} color={withAlpha(on ? colors.accent : colors.text, 0.12)} />
        <Path path={line} style="stroke" strokeWidth={2} color={on ? colors.accent : colors.textDim} />
      </Canvas>
      <Txt
        variant="bodyStrong"
        numberOfLines={1}
        style={[{ fontSize: 12, alignSelf: 'stretch', textAlign: 'center' }, on && { color: colors.accent }]}
      >
        {preset.name}
      </Txt>
    </Pressable>
  );
}

/* ───────── sliders ───────── */

function Band({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [active, setActive] = useState(false);
  const toValue = (py: number) => half(RANGE - (Math.max(0, Math.min(SLIDER_H, py)) / SLIDER_H) * RANGE * 2);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      setActive(true);
      onChange(toValue(e.y));
    })
    .onUpdate((e) => onChange(toValue(e.y)))
    .onFinalize(() => setActive(false));
  const top = ((RANGE - value) / (RANGE * 2)) * SLIDER_H;
  const zero = SLIDER_H / 2;

  return (
    <View style={styles.band}>
      <Pressable
        onPress={() => (tap('select'), onChange(0))}
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
          onAccessibilityAction={(e) => onChange(clamp(value + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))}
        >
          <View style={styles.rail} />
          <Gradient
            colors={
              value >= 0
                ? [colors.accent, withAlpha(colors.accent, 0.35)]
                : [withAlpha(colors.accent, 0.35), colors.accent]
            }
            style={[styles.fill, { top: Math.min(top, zero), height: Math.max(2, Math.abs(top - zero)) }]}
          />
          <View
            style={[
              styles.knob,
              { top: top - 12, borderColor: value !== 0 || active ? colors.accent : colors.surface3 },
              active && { transform: [{ scale: 1.15 }] },
            ]}
          />
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
  step = 0.5,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [w, setW] = useState(1);
  const toValue = (px: number) => {
    const v = Math.round((min + (Math.max(0, Math.min(w, px)) / w) * (max - min)) / step) * step;
    return Math.abs(v) < step / 2 ? 0 : Number(v.toFixed(3));
  };
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
        <View style={[styles.hZero, { left: `${zero * 100}%` }]} />
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
        <View style={[styles.hKnob, { left: `${frac * 100}%`, borderColor: colors.accent }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: 14, gap: 4 },
  power: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  powerIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 12, gap: 8 },
  off: { opacity: 0.55 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  freqs: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.hires, 0.12),
  },
  bands: { flexDirection: 'row', justifyContent: 'space-between' },
  gridLines: { position: 'absolute', left: 0, right: 0, top: 26, height: SLIDER_H },
  gridLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  band: { alignItems: 'center', flex: 1 },
  bandVal: { fontSize: 10, height: 18 },
  bandLabel: { fontSize: 10, marginTop: 8 },
  track: { height: SLIDER_H, width: 30, alignItems: 'center', marginTop: 8 },
  rail: { position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3, backgroundColor: colors.surface3 },
  fill: { position: 'absolute', width: 6, borderRadius: 3 },
  knob: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.text,
    borderWidth: 4,
  },
  hTrack: { height: 32, justifyContent: 'center' },
  hRail: { height: 6, borderRadius: 3, backgroundColor: colors.surface3 },
  hZero: { position: 'absolute', width: 2, height: 12, marginLeft: -1, backgroundColor: colors.textMute },
  hFill: { position: 'absolute', height: 6, borderRadius: 3 },
  hKnob: {
    position: 'absolute',
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: 12,
    backgroundColor: colors.text,
    borderWidth: 4,
  },
  groupName: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textDim, paddingHorizontal: 2 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: PRESET_GAP },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 999, backgroundColor: colors.surface2 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  presetCard: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  saveCard: { justifyContent: 'center', borderStyle: 'dashed', borderColor: colors.accent },
  input: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 16,
    backgroundColor: colors.surface3,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  saveBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 999 },
});
