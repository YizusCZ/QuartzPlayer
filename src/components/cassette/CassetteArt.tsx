/**
 * Quartz cassette, drawn in a fixed 1000×636 design space (the real
 * 100.4 × 63.8 mm proportion, geometry measured from the reference photos).
 *
 * Split in two for speed:
 *  - <CassetteBase> is everything that never moves. It is rasterised once
 *    into an image (see CassetteView) and has transparent cut-outs where the
 *    window pane and hub holes are.
 *  - <CassetteReels> is what moves — tape packs and hubs — drawn beneath
 *    the base every frame. It is a handful of primitives.
 *
 * Only Skia + React are imported here so the same code renders headless in
 * tools/preview.tsx.
 */
import {
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Shader,
  Skia,
  SweepGradient,
  Text,
  rect,
  rrect,
  vec,
  type AnimatedProp,
  type SkFont,
  type Transforms3d,
} from '@shopify/react-native-skia';
import { effects, rgb } from './shaders';
import type { CassetteSkin } from './skins';

export const CASSETTE_W = 1000;
export const CASSETTE_H = 636;
export const HUB_L = { x: 289, y: 272 };
export const HUB_R = { x: 710, y: 272 };
export const HOLE_R = 62;
export const HUB_RING = 49;
/** Tape-pack radius range in design units (bare hub → full reel). */
export const PACK_MIN = 52;
export const PACK_MAX = 190;
const PANE = { x: 376, y: 214, w: 244, h: 118 };
const LABEL = { x: 78, y: 48, w: 866, h: 380 };
const STRIPE_Y = 186;
const BAND_Y = 356;

export type CassetteFonts = {
  brand: SkFont; // Michroma 28 — wordmark on the label
  emboss: SkFont; // Michroma 11 — moulded into the shell
  model: SkFont; // Barlow SemiBold 44
  side: SkFont; // Barlow Regular 56
  label: SkFont; // Barlow Regular 25
  labelSmall: SkFont; // Barlow Regular 17
  tiny: SkFont; // Barlow Medium 10.5
  hand: SkFont; // Caveat 34
  handSmall: SkFont; // Caveat 24
};

export type CassetteText = {
  title: string;
  artist: string;
  album: string;
  caption: string;
  side: 'A' | 'B';
  model: string;
  handwritten?: boolean;
};

/* ───────── helpers ───────── */

/** Advance width; glyph widths work on every Skia backend (measureText is native-only). */
export function textWidth(font: SkFont, text: string): number {
  return font.getGlyphWidths(font.getGlyphIDs(text)).reduce((a, b) => a + b, 0);
}

function fit(text: string, font: SkFont, maxWidth: number): string {
  if (!text) return '';
  if (textWidth(font, text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(font, text.slice(0, mid) + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

let geo: ReturnType<typeof buildGeometry> | null = null;
function buildGeometry() {
  const shell = Skia.PathBuilder.Make()
    .addRRect(rrect(rect(0, 0, CASSETTE_W, CASSETTE_H), 22, 22))
    .build();

  // Raised head guard: narrow at the top, flaring toward the bottom edge.
  const guard = Skia.PathBuilder.Make()
    .moveTo(168, CASSETTE_H)
    .lineTo(190, 470)
    .quadTo(193, 452, 212, 452)
    .lineTo(790, 452)
    .quadTo(809, 452, 812, 470)
    .lineTo(834, CASSETTE_H)
    .close()
    .build();

  const pane = rrect(rect(PANE.x, PANE.y, PANE.w, PANE.h), 5, 5);
  const cutout = Skia.PathBuilder.Make()
    .addRRect(pane)
    .addCircle(HUB_L.x, HUB_L.y, HOLE_R)
    .addCircle(HUB_R.x, HUB_R.y, HOLE_R)
    .build();

  const cy = PANE.y + PANE.h / 2;
  const ticks = Skia.PathBuilder.Make();
  ticks.moveTo(PANE.x + 18, cy).lineTo(PANE.x + PANE.w - 18, cy);
  for (let i = -4; i <= 4; i++) {
    const x = PANE.x + PANE.w / 2 + i * 22;
    const h = i === 0 ? 0 : Math.abs(i) % 2 === 0 ? 11 : 7;
    if (h) ticks.moveTo(x, cy - h).lineTo(x, cy + h);
  }

  // Tape guides: the pale wedges at both ends of the pane.
  const guides = Skia.PathBuilder.Make()
    .moveTo(PANE.x, PANE.y + 8)
    .quadTo(PANE.x + 20, cy, PANE.x, PANE.y + PANE.h - 8)
    .close()
    .moveTo(PANE.x + PANE.w, PANE.y + 8)
    .quadTo(PANE.x + PANE.w - 20, cy, PANE.x + PANE.w, PANE.y + PANE.h - 8)
    .close()
    .build();

  const arrow = Skia.PathBuilder.Make()
    .moveTo(478, 386)
    .lineTo(504, 386)
    .lineTo(504, 377)
    .lineTo(524, 391)
    .lineTo(504, 405)
    .lineTo(504, 396)
    .lineTo(478, 396)
    .close()
    .build();

  const slot = Skia.PathBuilder.Make()
    .addRect(rect(-7, -1.3, 14, 2.6))
    .addRect(rect(-1.3, -7, 2.6, 14))
    .build();

  return { shell, guard, pane, cutout, ticks: ticks.build(), guides, arrow, slot };
}
const geometry = () => (geo ??= buildGeometry());

/* ───────── static parts ───────── */

function Screw({ x, y }: { x: number; y: number }) {
  const g = geometry();
  return (
    <Group>
      <Circle cx={x} cy={y + 1} r={12.5} color="rgba(0,0,0,0.55)" />
      <Circle cx={x} cy={y} r={11}>
        <RadialGradient c={vec(x - 4, y - 4)} r={15} colors={['#D8D5CE', '#9A968E', '#5E5A54']} />
      </Circle>
      <Group transform={[{ translateX: x }, { translateY: y }, { rotate: 0.35 }]}>
        <Path path={g.slot} color="rgba(28,26,24,0.8)" />
      </Group>
      <Circle cx={x} cy={y} r={11} style="stroke" strokeWidth={0.8} color="rgba(255,255,255,0.25)" />
    </Group>
  );
}

function GuardHole({ x, y, square }: { x: number; y: number; square?: boolean }) {
  const r = square ? 19 : 20;
  return (
    <Group>
      {square ? (
        <>
          <RoundedRect x={x - r - 3} y={y - r - 3} width={(r + 3) * 2} height={(r + 3) * 2} r={10}>
            <SweepGradient c={vec(x, y)} colors={['#8A857C', '#2E2B27', '#B5B0A6', '#3A3631', '#8A857C']} />
          </RoundedRect>
          <RoundedRect x={x - r} y={y - r} width={r * 2} height={r * 2} r={8} color="#0E0D0C" />
        </>
      ) : (
        <>
          <Circle cx={x} cy={y} r={r + 3} color="rgba(0,0,0,0.45)" />
          <Circle cx={x} cy={y} r={r} color="#0E0D0C" />
        </>
      )}
      <Circle cx={x - 3} cy={y - 4} r={2.6} color="rgba(255,255,255,0.75)" />
    </Group>
  );
}

type BaseProps = CassetteText & { skin: CassetteSkin; fonts: CassetteFonts; px: number };

export function CassetteBase(p: BaseProps) {
  const g = geometry();
  const fx = effects();
  const { skin, fonts } = p;
  const labelFont = p.handwritten ? fonts.hand : fonts.label;
  const albumFont = p.handwritten ? fonts.handSmall : fonts.labelSmall;
  const upper = (s: string) => (p.handwritten ? s : s.toLocaleUpperCase());
  const title = fit(upper(p.title), labelFont, 780);
  const artist = fit(upper(p.artist), labelFont, 780);
  const album = fit(upper(p.album), albumFont, 780);
  const modelW = textWidth(fonts.model, p.model);
  const brandW = textWidth(fonts.brand, 'QUARTZ');
  const embossW = textWidth(fonts.emboss, 'QUARTZ');
  const caption = fit(p.caption, fonts.tiny, 250);

  const shellU = {
    cell: 10.5,
    px: p.px,
    base: rgb(skin.shell),
    light: rgb(skin.shellLight),
    size: [CASSETTE_W, CASSETTE_H],
  };

  return (
    <Group layer>
      {/* soft contact shadow */}
      <RoundedRect x={6} y={14} width={CASSETTE_W - 12} height={CASSETTE_H - 8} r={24} color="rgba(0,0,0,0.5)" />

      {/* ── moulded shell ── */}
      <Group clip={g.shell}>
        <Rect x={0} y={0} width={CASSETTE_W} height={CASSETTE_H}>
          <Shader source={fx.shell} uniforms={shellU} />
        </Rect>

        {/* head guard: same moulding, raised with a lit rim */}
        <Path path={g.guard} color="rgba(255,255,255,0.035)" />
        <Path path={g.guard} style="stroke" strokeWidth={5} color="rgba(0,0,0,0.30)" />
        <Group transform={[{ translateY: 2 }]}>
          <Path path={g.guard} style="stroke" strokeWidth={1.6} color="rgba(255,255,255,0.20)" />
        </Group>

        {skin.rollers
          ? [96, 904].map((x) => (
              <Group key={x}>
                <Circle cx={x} cy={566} r={34} color="rgba(236,228,206,0.75)" />
                <Circle cx={x} cy={566} r={34} style="stroke" strokeWidth={2} color="rgba(120,110,90,0.6)" />
                <Circle cx={x} cy={566} r={12} color="rgba(120,110,90,0.55)" />
              </Group>
            ))
          : null}

        <GuardHole x={248} y={580} />
        <GuardHole x={348} y={561} square />
        <GuardHole x={489} y={512} />
        <GuardHole x={631} y={570} square />
        <GuardHole x={736} y={589} />

        {/* tape crossing the head openings along the bottom edge */}
        <Rect x={190} y={CASSETTE_H - 5} width={620} height={3} color="#3A2A1E" />

        {/* top-right moulded wordmark plate */}
        <RoundedRect x={848} y={12} width={104} height={24} r={4} color="rgba(0,0,0,0.16)" />
        <Text x={900 - embossW / 2 + 0.8} y={29} text="QUARTZ" font={fonts.emboss} color="rgba(0,0,0,0.45)" />
        <Text x={900 - embossW / 2} y={28} text="QUARTZ" font={fonts.emboss} color="rgba(255,255,255,0.20)" />

        {/* broad light falloff */}
        <Rect x={0} y={0} width={CASSETTE_W} height={CASSETTE_H}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, CASSETTE_H)}
            colors={['rgba(255,255,255,0.07)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.16)']}
          />
        </Rect>
      </Group>
      <RoundedRect
        x={1.5}
        y={1.5}
        width={CASSETTE_W - 3}
        height={CASSETTE_H - 3}
        r={21}
        style="stroke"
        strokeWidth={3}
        color="rgba(255,255,255,0.16)"
      />
      <RoundedRect
        x={0}
        y={0}
        width={CASSETTE_W}
        height={CASSETTE_H}
        r={22}
        style="stroke"
        strokeWidth={1.5}
        color="rgba(0,0,0,0.7)"
      />

      {/* ── label recess ── */}
      <RoundedRect
        x={LABEL.x - 10}
        y={LABEL.y - 10}
        width={LABEL.w + 20}
        height={LABEL.h + 20}
        r={14}
        color="rgba(0,0,0,0.26)"
      />
      <RoundedRect
        x={LABEL.x - 9}
        y={LABEL.y - 8}
        width={LABEL.w + 18}
        height={LABEL.h + 17}
        r={13}
        style="stroke"
        strokeWidth={1.2}
        color="rgba(255,255,255,0.14)"
      />

      {/* ── label ── */}
      <Group clip={rrect(rect(LABEL.x, LABEL.y, LABEL.w, LABEL.h), 6, 6)}>
        <Rect x={LABEL.x} y={LABEL.y} width={LABEL.w} height={STRIPE_Y - LABEL.y}>
          <Shader source={fx.paper} uniforms={{ tint: rgb(skin.paper) }} />
        </Rect>
        <Rect x={LABEL.x} y={LABEL.y} width={LABEL.w} height={STRIPE_Y - LABEL.y}>
          <LinearGradient
            start={vec(0, LABEL.y)}
            end={vec(0, STRIPE_Y)}
            colors={['rgba(0,0,0,0.07)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.03)']}
          />
        </Rect>
        <Rect x={LABEL.x} y={98} width={LABEL.w} height={1.3} color="rgba(0,0,0,0.20)" />
        <Rect x={LABEL.x} y={142} width={LABEL.w} height={1.3} color="rgba(0,0,0,0.20)" />
        {album ? <Text x={108} y={88} text={album} font={albumFont} color={skin.inkSoft} /> : null}
        <Text x={108} y={p.handwritten ? 133 : 130} text={title} font={labelFont} color={skin.ink} />
        <Text x={108} y={p.handwritten ? 177 : 174} text={artist} font={labelFont} color={skin.ink} opacity={0.85} />

        {/* foil stripe */}
        <Rect x={LABEL.x} y={STRIPE_Y} width={LABEL.w} height={BAND_Y - STRIPE_Y}>
          <Shader
            source={fx.brushed}
            uniforms={{
              c0: rgb(skin.stripe[0]),
              c1: rgb(skin.stripe[1]),
              origin: [LABEL.x, STRIPE_Y],
              size: [LABEL.w, BAND_Y - STRIPE_Y],
              amount: 0.22,
            }}
          />
        </Rect>
        <Text x={98} y={318} text={p.side} font={fonts.side} color={skin.sideInk} />

        {/* lower band */}
        <Rect x={LABEL.x} y={BAND_Y} width={LABEL.w} height={LABEL.y + LABEL.h - BAND_Y}>
          <Shader
            source={fx.brushed}
            uniforms={{
              c0: rgb(skin.band[0]),
              c1: rgb(skin.band[1]),
              origin: [LABEL.x, BAND_Y],
              size: [LABEL.w, LABEL.h],
              amount: 0.14,
            }}
          />
        </Rect>
        <Rect x={LABEL.x} y={BAND_Y} width={LABEL.w} height={1} color="rgba(0,0,0,0.18)" />
        <Text x={134} y={398} text="QUARTZ" font={fonts.brand} color={skin.brandInk} />
        <Text x={134.7} y={398} text="QUARTZ" font={fonts.brand} color={skin.brandInk} />
        <Text x={134} y={416} text={skin.typeLine.replace(/ /g, '  ')} font={fonts.tiny} color={skin.inkSoft} />
        <Text x={134 + brandW + 18} y={398} text={caption} font={fonts.tiny} color={skin.inkSoft} />
        <Path path={g.arrow} color={skin.arrow} />
        <Text x={846 - modelW} y={410} text={p.model} font={fonts.model} color={skin.modelInk} />
      </Group>

      {/* ── window frame ── */}
      <RoundedRect x={163} y={194} width={692} height={160} r={9} color="rgba(0,0,0,0.35)" />
      <RoundedRect x={165} y={196} width={688} height={156} r={8}>
        <LinearGradient start={vec(0, 196)} end={vec(0, 352)} colors={skin.window} />
      </RoundedRect>
      <RoundedRect
        x={165.5}
        y={196.5}
        width={687}
        height={155}
        r={8}
        style="stroke"
        strokeWidth={1}
        color="rgba(255,255,255,0.12)"
      />

      {/* hub-hole bezels and pane frame */}
      {[HUB_L, HUB_R].map((h) => (
        <Circle key={h.x} cx={h.x} cy={h.y} r={HOLE_R + 5}>
          <SweepGradient c={vec(h.x, h.y)} colors={['#6D665C', '#26221E', '#9B9489', '#2E2A25', '#6D665C']} />
        </Circle>
      ))}
      <RoundedRect x={PANE.x - 4} y={PANE.y - 4} width={PANE.w + 8} height={PANE.h + 8} r={7}>
        <LinearGradient start={vec(0, PANE.y - 4)} end={vec(0, PANE.y + PANE.h + 4)} colors={['#2A251F', '#8B8378']} />
      </RoundedRect>

      {/* cut the openings: reels drawn below show through */}
      <Path path={g.cutout} blendMode="clear" color="black" />

      {/* glass: guides, printed scale, reflections */}
      <Path path={g.guides} color="rgba(235,230,220,0.55)" />
      <Path path={g.ticks} style="stroke" strokeWidth={1.8} color="rgba(248,245,238,0.85)" />
      <Group clip={g.pane}>
        <Rect x={PANE.x} y={PANE.y} width={PANE.w} height={PANE.h}>
          <LinearGradient
            start={vec(PANE.x, PANE.y)}
            end={vec(PANE.x + PANE.w, PANE.y + PANE.h)}
            colors={[
              'rgba(255,255,255,0.14)',
              'rgba(255,255,255,0.0)',
              'rgba(255,255,255,0.06)',
              'rgba(255,255,255,0.0)',
            ]}
            positions={[0, 0.4, 0.62, 1]}
          />
        </Rect>
      </Group>

      <Screw x={26} y={26} />
      <Screw x={974} y={26} />
      <Screw x={26} y={610} />
      <Screw x={974} y={610} />
    </Group>
  );
}

/* ───────── moving parts ───────── */

function Hub({ transform }: { transform: AnimatedProp<Transforms3d> }) {
  return (
    <Group transform={transform}>
      {/* white ring with six inward teeth */}
      <Circle cx={0} cy={0} r={HUB_RING}>
        <RadialGradient c={vec(-14, -16)} r={70} colors={['#FFFFFF', '#E9E6E0', '#B8B3AA']} />
      </Circle>
      <Circle cx={0} cy={0} r={HUB_RING} style="stroke" strokeWidth={1.5} color="rgba(0,0,0,0.35)" />
      <Circle cx={0} cy={0} r={34} color="#1A1714" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Group key={i} transform={[{ rotate: (i * Math.PI) / 3 }]}>
          <RoundedRect x={26} y={-5} width={10} height={10} r={2} color="#E4E0D9" />
        </Group>
      ))}
      {/* three-prong drive spindle */}
      {[0, 1, 2].map((i) => (
        <Group key={i} transform={[{ rotate: (i * 2 * Math.PI) / 3 }]}>
          <RoundedRect x={-4.5} y={-24} width={9} height={24} r={4}>
            <LinearGradient start={vec(-4.5, 0)} end={vec(4.5, 0)} colors={['#8C8984', '#F2F0EC', '#7A7772']} />
          </RoundedRect>
        </Group>
      ))}
      <Circle cx={0} cy={0} r={7} color="#C9C6C0" />
      <Circle cx={0} cy={0} r={3} color="#44413D" />
    </Group>
  );
}

type ReelProps = {
  skin: CassetteSkin;
  px: number;
  hubL: AnimatedProp<Transforms3d>;
  hubR: AnimatedProp<Transforms3d>;
  packL: AnimatedProp<number>;
  packR: AnimatedProp<number>;
};

export function CassetteReels({ skin, px, hubL, hubR, packL, packR }: ReelProps) {
  const fx = effects();
  const inside = { cell: 5, px, base: rgb(skin.pane), light: rgb(skin.pane), size: [CASSETTE_W, CASSETTE_H] };
  return (
    <Group>
      {/* far wall of the shell, seen through the openings */}
      <Rect x={PANE.x - 150} y={PANE.y - 60} width={PANE.w + 300} height={PANE.h + 120}>
        <Shader source={fx.shell} uniforms={inside} />
      </Rect>
      <Circle cx={HUB_L.x} cy={HUB_L.y} r={packL}>
        <Shader source={fx.tape} uniforms={{ c: [HUB_L.x, HUB_L.y], r: PACK_MAX }} />
      </Circle>
      <Circle cx={HUB_R.x} cy={HUB_R.y} r={packR}>
        <Shader source={fx.tape} uniforms={{ c: [HUB_R.x, HUB_R.y], r: PACK_MAX }} />
      </Circle>
      <Circle cx={HUB_L.x} cy={HUB_L.y} r={packL} style="stroke" strokeWidth={3} color="#6E5645" />
      <Circle cx={HUB_R.x} cy={HUB_R.y} r={packR} style="stroke" strokeWidth={3} color="#6E5645" />
      <Group transform={[{ translateX: HUB_L.x }, { translateY: HUB_L.y }]}>
        <Hub transform={hubL} />
      </Group>
      <Group transform={[{ translateX: HUB_R.x }, { translateY: HUB_R.y }]}>
        <Hub transform={hubR} />
      </Group>
    </Group>
  );
}
