import { memo } from 'react';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { JAM_GEMS, gemFor } from '@/jam/store';

/** Each mineral has its own cut, so people stay apart even when colours look alike. */
const CUTS: Record<string, { body: string; facets?: string; ellipse?: boolean; rect?: boolean }> = {
  // Round brilliant
  brilliant: {
    body: 'M7 4H17L21 9L12 21L3 9Z',
    facets: 'M3 9H21M7 4L9 9L12 4L15 9L17 4M9 9L12 21L15 9',
  },
  // Emerald cut
  emerald: {
    body: 'M8 3H16L20 7V17L16 21H8L4 17V7Z',
    facets:
      'M9 7H15L16 8V16L15 17H9L8 16V8ZM8 3L9 7M16 3L15 7M20 7L16 8M20 17L16 16M16 21L15 17M8 21L9 17M4 17L8 16M4 7L8 8',
  },
  // Hexagonal crystal point
  crystal: {
    body: 'M12 2L18 7V18L12 22L6 18V7Z',
    facets: 'M6 7L12 10L18 7M12 10V22',
  },
  // Trillion
  trillion: {
    body: 'M12 3L21.5 19.5H2.5Z',
    facets: 'M12 8.5L16.6 16.5H7.4ZM12 3V8.5M21.5 19.5L16.6 16.5M2.5 19.5L7.4 16.5',
  },
  // Pear
  pear: {
    body: 'M12 2C15 7 19 11 19 15A7 7 0 0 1 5 15C5 11 9 7 12 2Z',
    facets: 'M12 9L15.5 15L12 19.5L8.5 15ZM12 2V9M5.2 14.5L8.5 15M18.8 14.5L15.5 15M12 22V19.5',
  },
  // Oval cabochon
  oval: { body: '', ellipse: true },
  // Marquise
  marquise: {
    body: 'M12 2C17.5 6 17.5 18 12 22C6.5 18 6.5 6 12 2Z',
    facets: 'M12 6.5L14.6 12L12 17.5L9.4 12ZM12 2V6.5M12 22V17.5M7.9 12H9.4M16.1 12H14.6',
  },
  // Cushion
  cushion: {
    body: '',
    rect: true,
    facets: 'M12 7L17 12L12 17L7 12ZM5.5 5.5L9.5 9.5M18.5 5.5L14.5 9.5M18.5 18.5L14.5 14.5M5.5 18.5L9.5 14.5',
  },
};

/** A small faceted gem: the mineral that stands for someone in a room. */
export const Gem = memo(function Gem({ color, size }: { color: string; size: number }) {
  const gem = gemFor(color);
  const cut = CUTS[gem.cut] ?? CUTS.brilliant;
  const id = `g${JAM_GEMS.indexOf(gem)}`;
  const fill = `url(#${id})`;
  const stroke = 'rgba(255,255,255,0.55)';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gem.light} />
          <Stop offset="0.55" stopColor={gem.color} />
          <Stop offset="1" stopColor={gem.dark} />
        </LinearGradient>
      </Defs>
      <G>
        {cut.ellipse ? (
          <>
            <Ellipse cx="12" cy="12" rx="7.5" ry="10" fill={fill} />
            <Ellipse cx="9.6" cy="8" rx="2.6" ry="3.6" fill="rgba(255,255,255,0.45)" />
          </>
        ) : cut.rect ? (
          <Rect x="3.5" y="3.5" width="17" height="17" rx="5.5" fill={fill} />
        ) : (
          <Path d={cut.body} fill={fill} strokeLinejoin="round" />
        )}
        {cut.facets ? (
          <Path d={cut.facets} stroke={stroke} strokeWidth={0.9} fill="none" strokeLinejoin="round" />
        ) : null}
      </G>
    </Svg>
  );
});
