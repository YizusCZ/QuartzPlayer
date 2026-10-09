import { Pressable, StyleSheet, View } from 'react-native';
import { routeFormat, routeIcon, routeKindLabel, routeName, useAudioRoute, type AudioRoute } from '@/audio/route';
import { khz, LOSSLESS, type AudioFormat } from '@/library/types';
import { colors, fonts, radius } from '@/theme';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Txt';

/** Compact "where is this playing" pill for the player's top bar. */
export function AudioRouteChip({ onPress }: { onPress: () => void }) {
  const route = useAudioRoute((s) => s.route);
  if (!route) return null;
  const fmt = routeFormat(route);
  return (
    <Pressable
      onPress={onPress}
      style={styles.chip}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Salida: ${routeName(route)}${fmt ? `, ${fmt}` : ''}`}
    >
      <Icon name={routeIcon(route)} size={14} color={route.kind === 'speaker' ? colors.textDim : colors.accent} />
      <Txt variant="mono" numberOfLines={1} style={styles.text}>
        {routeName(route)}
        {fmt ? ` · ${fmt}` : ''}
      </Txt>
    </Pressable>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return (
    <View style={styles.row}>
      <Txt variant="caption" style={{ width: 150 }}>
        {k}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1 }}>
        {v}
      </Txt>
    </View>
  );
}

function verdict(route: AudioRoute, file: AudioFormat): string {
  const out = route.codecSampleRate ?? route.sampleRate;
  const src = file.sampleRate;
  if (route.kind === 'bluetooth' || route.kind === 'ble') {
    if (route.codec === 'LDAC' || route.codec === 'aptX HD')
      return `Bluetooth de alta calidad (${route.codec}). Se comprime para transmitirse, pero conserva gran parte del detalle.`;
    return 'Bluetooth comprime el audio para transmitirlo; para escuchar la resolución completa usa cable o un DAC USB.';
  }
  if (!out || !src) return 'La salida está activa.';
  if (out === src) return `La salida trabaja a ${khz(out)}, igual que tu archivo.`;
  if (out < src)
    return `Tu archivo es de ${khz(src)} y la salida trabaja a ${khz(out)}: el sistema lo convierte a la frecuencia del dispositivo.`;
  return `La salida trabaja a ${khz(out)}; tu archivo (${khz(src)}) se adapta a esa frecuencia.`;
}

/** Full details for the route sheet. */
export function AudioRoutePanel({ format }: { format: AudioFormat }) {
  const route = useAudioRoute((s) => s.route);
  if (!route) return null;
  const lossless = LOSSLESS.includes(format.codec);
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.hero}>
        <View style={styles.iconBox}>
          <Icon name={routeIcon(route)} size={34} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" numberOfLines={1}>
            {routeName(route)}
          </Txt>
          <Txt variant="caption">{routeKindLabel(route)}</Txt>
        </View>
      </View>
      <View style={styles.card}>
        <Row k="Códec Bluetooth" v={route.codec} />
        <Row k="Resolución del enlace" v={route.codecBitDepth ? `${route.codecBitDepth}-bit` : null} />
        <Row
          k="Frecuencia de salida"
          v={route.codecSampleRate ? khz(route.codecSampleRate) : route.sampleRate ? khz(route.sampleRate) : null}
        />
        <Row k="Canales" v={route.channels ? (route.channels === 2 ? 'Estéreo' : `${route.channels}`) : null} />
        <Row
          k="Frecuencias admitidas"
          v={route.supportedRates.length ? route.supportedRates.map((r) => khz(r)).join(', ') : null}
        />
        <Row k="Formatos admitidos" v={route.encodings.length ? route.encodings.join(', ') : null} />
        <Row
          k="Tu archivo"
          v={[
            format.codec,
            lossless && format.bitDepth ? `${format.bitDepth}-bit` : null,
            format.sampleRate ? khz(format.sampleRate) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </View>
      <Txt variant="caption" style={{ lineHeight: 18 }}>
        {verdict(route, format)}
      </Txt>
      {route.kind === 'bluetooth' && !route.codec ? (
        <Txt variant="caption" style={{ color: colors.textMute }}>
          {route.needsPermission
            ? 'Concede el permiso de dispositivos cercanos para ver el códec.'
            : 'Este teléfono no informa el códec Bluetooth a las apps.'}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 220,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginTop: 3,
  },
  text: { fontSize: 11, flexShrink: 1, fontFamily: fonts.medium },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconBox: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
});
