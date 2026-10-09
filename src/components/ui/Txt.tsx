import { Text, type TextProps } from 'react-native';
import { colors, fonts } from '@/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'mono';

const variants: Record<
  Variant,
  { fontFamily: string; fontSize: number; color: string; letterSpacing?: number; lineHeight?: number }
> = {
  display: { fontFamily: fonts.bold, fontSize: 30, color: colors.text, letterSpacing: -0.4 },
  title: { fontFamily: fonts.semibold, fontSize: 22, color: colors.text, letterSpacing: -0.2 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, color: colors.text, lineHeight: 20 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  caption: { fontFamily: fonts.regular, fontSize: 13, color: colors.textDim },
  label: { fontFamily: fonts.condensed, fontSize: 12, color: colors.textDim, letterSpacing: 1.4 },
  mono: { fontFamily: fonts.medium, fontSize: 12, color: colors.textDim, letterSpacing: 0.3 },
};

export function Txt({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} style={[variants[variant], { fontVariant: ['tabular-nums'] }, style]} />;
}
