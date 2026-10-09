/**
 * Square playlist cover: the visualizer's cassette, tilted on a J-card style
 * background in the skin's colours, with the playlist name on its label.
 * Pure Skia (no React Native imports) so tools/preview.tsx can render it.
 */
import { Group, LinearGradient, Rect, RoundedRect, Shadow, rect, vec } from '@shopify/react-native-skia';
import {
  CassetteBase,
  CassetteReels,
  CASSETTE_H,
  CASSETTE_W,
  PACK_MAX,
  PACK_MIN,
  type CassetteFonts,
} from './CassetteArt';
import type { CassetteSkin } from './skins';

const pack = (p: number) => Math.sqrt(PACK_MIN ** 2 + p * (PACK_MAX ** 2 - PACK_MIN ** 2));

type Props = {
  skin: CassetteSkin;
  fonts: CassetteFonts;
  /** Edge of the square, in pixels. */
  size: number;
  title: string;
  subtitle: string;
  /** Model code printed on the label, e.g. "QX 90". */
  model: string;
};

export function CassetteCoverArt({ skin, fonts, size, title, subtitle, model }: Props) {
  const scale = (size * 0.9) / CASSETTE_W;
  const w = CASSETTE_W * scale;
  const h = CASSETTE_H * scale;
  return (
    <Group clip={rect(0, 0, size, size)}>
      <Rect x={0} y={0} width={size} height={size}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(size, size)}
          colors={[skin.shellLight, skin.shell, skin.window[1]]}
        />
      </Rect>
      {/* the foil stripe, running across the card behind the tape */}
      <Group transform={[{ translateX: size / 2 }, { translateY: size / 2 }, { rotate: -0.42 }]}>
        <Rect x={-size} y={-size * 0.09} width={size * 2} height={size * 0.18}>
          <LinearGradient start={vec(-size, 0)} end={vec(size, 0)} colors={skin.stripe} />
        </Rect>
        <Rect x={-size} y={size * 0.11} width={size * 2} height={size * 0.025} color={skin.stripe[1]} opacity={0.7} />
      </Group>
      <Group
        transform={[
          { translateX: size / 2 },
          { translateY: size / 2 },
          { rotate: -0.1 },
          { translateX: -w / 2 },
          { translateY: -h / 2 },
          { scale },
        ]}
      >
        <RoundedRect x={0} y={0} width={CASSETTE_W} height={CASSETTE_H} r={22} color="rgba(0,0,0,0.001)">
          <Shadow dx={0} dy={18} blur={30} color="rgba(0,0,0,0.55)" />
        </RoundedRect>
        <CassetteReels
          skin={skin}
          px={scale}
          hubL={[{ rotate: 0.3 }]}
          hubR={[{ rotate: 1.1 }]}
          packL={pack(0.62)}
          packR={pack(0.38)}
        />
        <CassetteBase
          skin={skin}
          fonts={fonts}
          px={scale}
          title={title}
          artist={subtitle}
          album=""
          caption=""
          side="A"
          model={model}
        />
      </Group>
    </Group>
  );
}
