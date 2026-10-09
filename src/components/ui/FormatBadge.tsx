import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { formatLabel, isHiRes, khz, LOSSLESS, type AudioFormat } from '@/library/types';
import { colors, fonts } from '@/theme';
import { Txt } from './Txt';

/** Quartz's own quality mark: a gold pill for Hi-Res, neutral for the rest. */
export function HiResMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const small = size === 'sm';
  return (
    <LinearGradient
      colors={['#F1D68C', colors.hires, '#A7812E']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hr, small && styles.hrSmall]}
      accessibilityLabel="Alta resolución"
    >
      <Txt style={[styles.hrText, small && { fontSize: 9 }]}>HI·RES</Txt>
    </LinearGradient>
  );
}

export function FormatBadge({ format, compact }: { format: AudioFormat; compact?: boolean }) {
  const hr = isHiRes(format);
  const lossless = LOSSLESS.includes(format.codec);
  if (compact) {
    return (
      <View style={styles.row}>
        {hr ? <HiResMark size="sm" /> : null}
        <Txt variant="mono" numberOfLines={1} style={{ fontSize: 11, color: hr ? colors.hires : colors.textMute }}>
          {lossless && format.bitDepth && format.sampleRate
            ? `${format.codec} ${format.bitDepth}/${khz(format.sampleRate).replace('kHz', '')}`
            : format.codec}
        </Txt>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {hr ? <HiResMark /> : null}
      <View style={[styles.chip, hr && { borderColor: 'rgba(217,180,90,0.45)' }]}>
        <Txt variant="mono" style={{ color: hr ? colors.hires : colors.textDim }}>
          {formatLabel(format)}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hr: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  hrSmall: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  hrText: { fontFamily: fonts.condensedBold, fontSize: 11, color: '#231A06', letterSpacing: 0.8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
