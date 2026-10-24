import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { routeFormat, routeIcon, routeKindLabel, routeName, useAudioRoute, type AudioRoute } from '@/audio/route';
import { khz, LOSSLESS, type AudioFormat } from '@/library/types';
import { tap } from '@/lib/haptics';
import { colors, fonts, radius } from '@/theme';
import { AudioRouteModule } from '../../modules/audio-route';
import { Icon } from './ui/Icon';
import { Txt } from './ui/Txt';

/** Compact "where is this playing" pill for the player's top bar. */
export function AudioRouteChip({ onPress }: { onPress: () => void }) {
  const route = useAudioRoute((s) => s.route);
  if (!route) return null;
  const fmt = routeFormat(route);
  const external = route.kind !== 'speaker';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Salida: ${routeName(route)}${fmt ? `, ${fmt}` : ''}`}
    >
      <View style={[styles.chipIcon, external && { backgroundColor: colors.accentSoft }]}>
        <Icon name={routeIcon(route)} size={12} color={external ? colors.accent : colors.textDim} />
      </View>
      <Txt numberOfLines={1} style={styles.chipName}>
        {routeName(route)}
      </Txt>
      {fmt ? <Txt style={styles.chipFmt}>{fmt}</Txt> : null}
      <Icon name="chevron-down" size={14} color={colors.textMute} />
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.stat}>
      <Txt style={styles.statLabel}>{label}</Txt>
      <Txt style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
    </View>
  );
}

function verdict(route: AudioRoute, file: AudioFormat): string {
  const out = route.codecSampleRate ?? route.sampleRate;
  const src = file.sampleRate;
  if (route.kind === 'bluetooth' || route.kind === 'ble') {
    if (route.codec === 'LDAC' || route.codec === 'aptX HD')
      return `Bluetooth de alta calidad (${route.codec}): se comprime para transmitirse, pero conserva gran parte del detalle.`;
    return 'Bluetooth comprime el audio para transmitirlo. Para la resolución completa usa cable o un DAC USB.';
  }
  if (!out || !src) return 'La salida está activa.';
  if (out === src) return `La salida trabaja a ${khz(out)}, igual que tu archivo: sin conversión.`;
  if (out < src) return `El sistema convierte tu archivo de ${khz(src)} a ${khz(out)}, la frecuencia del dispositivo.`;
  return `Tu archivo de ${khz(src)} se adapta a los ${khz(out)} de la salida.`;
}

/** Full details for the route sheet. */
export function AudioRoutePanel({ format }: { format: AudioFormat }) {
  const route = useAudioRoute((s) => s.route);
  if (!route) return null;
  const lossless = LOSSLESS.includes(format.codec);
  const outRate = route.codecSampleRate ?? route.sampleRate;
  const fileLine = [
    format.codec,
    lossless && format.bitDepth ? `${format.bitDepth}-bit` : null,
    format.sampleRate ? khz(format.sampleRate) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const outLine = [
    route.codec,
    route.codecBitDepth ? `${route.codecBitDepth}-bit` : null,
    outRate ? khz(outRate) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const matches = !!outRate && outRate === format.sampleRate && route.kind !== 'bluetooth' && route.kind !== 'ble';

  return (
    <View style={{ gap: 14 }}>
      {/* the device */}
      <View style={styles.device}>
        <View style={styles.deviceIcon}>
          <Icon name={routeIcon(route)} size={30} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={styles.overline}>REPRODUCIENDO EN</Txt>
          <Txt variant="title" numberOfLines={1}>
            {routeName(route)}
          </Txt>
          {routeKindLabel(route) !== routeName(route) ? <Txt variant="caption">{routeKindLabel(route)}</Txt> : null}
        </View>
      </View>

      {Platform.OS === 'android' ? (
        <Pressable
          onPress={() => {
            tap('select');
            AudioRouteModule.showOutputSwitcher();
          }}
          style={({ pressed }) => [styles.change, pressed && { backgroundColor: colors.surface3 }]}
          accessibilityRole="button"
        >
          <Icon name="swap-horizontal" size={20} color={colors.accent} />
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            Cambiar dispositivo
          </Txt>
          <Icon name="chevron-right" size={18} color={colors.textMute} />
        </Pressable>
      ) : null}

      {/* the signal */}
      <View style={styles.grid}>
        <Stat label="CÓDEC" value={route.codec} />
        <Stat label="FRECUENCIA" value={outRate ? khz(outRate) : null} />
        <Stat label="RESOLUCIÓN" value={route.codecBitDepth ? `${route.codecBitDepth}-bit` : null} />
        <Stat
          label="CANALES"
          value={route.channels ? (route.channels === 2 ? 'Estéreo' : `${route.channels}`) : null}
        />
      </View>

      {/* file → output */}
      <View style={styles.path}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={styles.overline}>TU ARCHIVO</Txt>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {fileLine || '—'}
          </Txt>
        </View>
        <Icon name="arrow-right" size={18} color={matches ? colors.ok : colors.textMute} />
        <View style={{ flex: 1, gap: 2, alignItems: 'flex-end' }}>
          <Txt style={styles.overline}>SALIDA</Txt>
          <Txt variant="bodyStrong" numberOfLines={1} style={matches && { color: colors.ok }}>
            {outLine || '—'}
          </Txt>
        </View>
      </View>
      <Txt variant="caption" style={{ lineHeight: 18, paddingHorizontal: 2 }}>
        {verdict(route, format)}
      </Txt>

      {route.supportedRates.length || route.encodings.length ? (
        <View style={{ gap: 8 }}>
          <Txt style={styles.overline}>EL DISPOSITIVO ADMITE</Txt>
          <View style={styles.pills}>
            {route.supportedRates.map((r) => (
              <Txt key={`r${r}`} style={[styles.pill, r === outRate && styles.pillOn]}>
                {khz(r)}
              </Txt>
            ))}
            {route.encodings.map((e) => (
              <Txt key={`e${e}`} style={styles.pill}>
                {e}
              </Txt>
            ))}
          </View>
        </View>
      ) : null}

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
    gap: 6,
    maxWidth: 240,
    paddingLeft: 3,
    paddingRight: 8,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    marginTop: 4,
  },
  chipIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipName: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.text, flexShrink: 1 },
  chipFmt: { fontFamily: fonts.condensed, fontSize: 11, color: colors.textDim, letterSpacing: 0.4 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  deviceIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  overline: { fontFamily: fonts.condensed, fontSize: 10.5, letterSpacing: 1.4, color: colors.textMute },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.surface2,
    gap: 3,
  },
  statLabel: { fontFamily: fonts.condensed, fontSize: 9.5, letterSpacing: 1.2, color: colors.textMute },
  statValue: { fontFamily: fonts.condensedBold, fontSize: 17, color: colors.text },
  path: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    fontFamily: fonts.condensed,
    fontSize: 11,
    color: colors.textDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  pillOn: { color: colors.accent, backgroundColor: colors.accentSoft },
});
