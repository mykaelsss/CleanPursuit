import { useMemo } from "react";
import { StyleSheet } from "react-native";
import Svg, {
  ClipPath,
  Defs,
  G,
  Image,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg";

import { useTheme } from "@/hooks/use-theme";

type PosterPaperProps = {
  width: number;
  height: number;
};

// How far the torn top and bottom edges reach into the paper, in pixels.
// Content on the paper should keep at least this much space from those edges.
export const TEAR_DEPTH = 16;

// The paper behind the wanted poster: tea dyed, crumpled and torn off a board.
// Drawn in pixels rather than stretched, so the tear keeps its shape at any size.
// Everything is seeded, so the paper looks the same on every render.
export default function PosterPaper({ width, height }: PosterPaperProps) {
  const theme = useTheme();
  const w = Math.round(width);
  const h = Math.round(height);
  const art = useMemo(() => drawPaper(w, h), [w, h]);

  if (w <= 0 || h <= 0) return null;

  // The canvas reaches past the poster on every side so the shadow fits.
  return (
    <Svg
      width={w + BLEED * 2}
      height={h + BLEED * 2}
      viewBox={`${-BLEED} ${-BLEED} ${w + BLEED * 2} ${h + BLEED * 2}`}
      style={styles.paper}
      pointerEvents="none"
    >
      <Defs>
        <ClipPath id="poster-paper">
          <Path d={art.paper} />
        </ClipPath>
        {/* A soft blotch, darkest in the middle, where tea soaked in. */}
        <RadialGradient id="poster-blotch" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={theme.posterStain} stopOpacity={0.55} />
          <Stop offset="0.6" stopColor={theme.posterStain} stopOpacity={0.25} />
          <Stop offset="1" stopColor={theme.posterStain} stopOpacity={0} />
        </RadialGradient>
        {/* A puddle that dried from the outside in, leaving a darker rim. */}
        <RadialGradient id="poster-tide" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={theme.posterStain} stopOpacity={0.04} />
          <Stop offset="0.8" stopColor={theme.posterStain} stopOpacity={0.14} />
          <Stop offset="1" stopColor={theme.posterStain} stopOpacity={0.3} />
        </RadialGradient>
        {/* Faded paper, lighter where it caught less tea. */}
        <RadialGradient id="poster-fade" cx="50%" cy="45%" r="60%">
          <Stop offset="0" stopColor={theme.posterFiber} stopOpacity={0.45} />
          <Stop offset="1" stopColor={theme.posterFiber} stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* The paper lifts off the board a little, so it casts a soft shadow.
          Wider, fainter strokes around the shape blur its edge. */}
      <G transform={`translate(${SHADOW_OFFSET[0]} ${SHADOW_OFFSET[1]})`}>
        <Path d={art.fibers} fill="#000" opacity={0.14} />
        {SHADOW_BLUR.map(([strokeWidth, opacity]) => (
          <Path
            key={`shadow-${strokeWidth}`}
            d={art.fibers}
            fill="none"
            stroke="#000"
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            strokeLinejoin="round"
          />
        ))}
      </G>

      {/* Pale fibers show along the tear, where the paper split. */}
      <Path d={art.fibers} fill={theme.posterFiber} />
      <Path d={art.fibers} fill={theme.posterStain} opacity={0.12} />

      <G clipPath="url(#poster-paper)">
        <Path d={art.paper} fill={theme.poster} />
        <Path d={art.paper} fill="url(#poster-fade)" />

        {art.blotches.map((blotch, i) => (
          <Path
            key={`blotch-${i}`}
            d={blotch.d}
            fill="url(#poster-blotch)"
            opacity={blotch.opacity}
          />
        ))}

        {art.tides.map((tide, i) => (
          <Path
            key={`tide-${i}`}
            d={tide.d}
            fill="url(#poster-tide)"
            stroke={theme.posterStain}
            strokeWidth={0.6}
            strokeOpacity={0.18}
            opacity={tide.opacity}
          />
        ))}

        {/* Tea soaks in deepest at the edges, so they come out darkest. */}
        {EDGE_SOAK.map(([strokeWidth, opacity]) => (
          <Path
            key={`soak-${strokeWidth}`}
            d={art.paper}
            fill="none"
            stroke={theme.posterStain}
            strokeWidth={strokeWidth}
            strokeOpacity={opacity}
            strokeLinejoin="round"
          />
        ))}

        {/* Light wrinkling: shading baked by scripts/generate-paper-texture.mjs. */}
        <Image
          href={WRINKLES}
          x={0}
          y={0}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid slice"
        />

        {art.flecks.map((fleck, i) => (
          <Path
            key={`fleck-${i}`}
            d={fleck.d}
            fill={theme.posterStain}
            opacity={fleck.opacity}
          />
        ))}
      </G>
    </Svg>
  );
}

const WRINKLES = require("@/assets/images/paper-crumple.png");

// Room around the poster for its shadow, in pixels.
const BLEED = 16;
const SHADOW_OFFSET = [2, 5] as const;
// [stroke width, opacity] for each step of the shadow's blurred edge.
const SHADOW_BLUR = [
  [18, 0.025],
  [13, 0.03],
  [9, 0.035],
  [5, 0.04],
  [2, 0.05],
] as const;

// [stroke width, opacity] for each band of darkening along the edge.
// The stroke is clipped to the paper, so only its inner half shows.
// Many thin steps keep the darkening smooth instead of banded.
const EDGE_SOAK = [
  [64, 0.03],
  [54, 0.03],
  [45, 0.035],
  [37, 0.035],
  [30, 0.04],
  [24, 0.04],
  [19, 0.045],
  [14, 0.05],
  [10, 0.06],
  [7, 0.07],
  [4, 0.09],
  [2, 0.16],
] as const;

// Fixed so the paper keeps its look; change it for a different tear and stains.
const PAPER_SEED = 1871;

// Spacing of the points along each edge.
const STEP = 1.5;

function drawPaper(w: number, h: number) {
  const random = seeded(PAPER_SEED);

  // The tear wanders in long curves, with jags at every smaller scale and
  // the odd deep bite where a chunk ripped away.
  const tear = (): Profile => {
    const wander = wave(random, w, [
      [70, 3.5],
      [22, 2.2],
      [7, 1.2],
      [2.2, 0.6],
    ]);
    const bites = Array.from({ length: 2 + Math.floor(random() * 2) }, () => ({
      at: random() * w,
      width: 6 + random() * 18,
      depth: 3 + random() * 6,
    }));
    return (x) => {
      const bite = bites.reduce(
        (sum, b) => sum + b.depth * Math.exp(-(((x - b.at) / b.width) ** 2)),
        0,
      );
      return clamp(TEAR_DEPTH * 0.4 + wander(x) + bite, 1, TEAR_DEPTH - 1);
    };
  };
  // The band of exposed fibers is uneven, with loose hairs sticking out.
  const fray = (): Profile => {
    const band = wave(random, w, [
      [40, 1.6],
      [9, 0.8],
      [2.5, 0.5],
    ]);
    return (x) => {
      const hair = random() < 0.12 ? random() * 1.8 : 0;
      return Math.max(0.4, 1.8 + band(x) + hair);
    };
  };
  // The sides were cut, so they are only slightly rough.
  const cut = (length: number): Profile => {
    const rough = wave(random, length, [
      [50, 0.6],
      [6, 0.35],
      [1.5, 0.2],
    ]);
    return (y) => 1.2 + rough(y);
  };

  const top = tear();
  const bottom = tear();
  const topFray = fray();
  const bottomFray = fray();
  const right = cut(h);
  const left = cut(h);

  const paper = outline(w, h, top, right, bottom, left);
  const fibers = outline(
    w,
    h,
    (x) => Math.max(0, top(x) - topFray(x)),
    right,
    (x) => Math.max(0, bottom(x) - bottomFray(x)),
    left,
  );

  const blotches = Array.from({ length: 14 }, () => ({
    d: blob(random, random() * w, random() * h, 25 + random() * (w * 0.4)),
    opacity: 0.3 + random() * 0.6,
  }));
  const tides = Array.from({ length: 4 }, () => ({
    d: blob(random, random() * w, random() * h, 18 + random() * (w * 0.2)),
    opacity: 0.6 + random() * 0.4,
  }));

  const flecks = Array.from({ length: Math.round((w * h) / 900) }, () => ({
    d: blob(random, random() * w, random() * h, 0.3 + random() * 0.9),
    opacity: 0.1 + random() * 0.3,
  }));

  return { paper, fibers, blotches, tides, flecks };
}

// How far an edge sits in from the poster's bounds at each point along it.
type Profile = (along: number) => number;

function outline(
  w: number,
  h: number,
  top: Profile,
  right: Profile,
  bottom: Profile,
  left: Profile,
) {
  const points: [number, number][] = [];
  for (const x of steps(0, w)) points.push([x, top(x)]);
  for (const y of steps(top(w), h - bottom(w))) points.push([w - right(y), y]);
  for (const x of steps(0, w).reverse()) points.push([x, h - bottom(x)]);
  for (const y of steps(top(0), h - bottom(0)).reverse())
    points.push([left(y), y]);
  return toPath(points);
}

// A closed, irregular blob around (cx, cy), like a dried puddle.
function blob(random: () => number, cx: number, cy: number, radius: number) {
  const around = Math.PI * 2;
  const edge = wave(random, around, [
    [around / 3, 0.25],
    [around / 9, 0.12],
    [around / 24, 0.05],
  ]);
  const squash = 0.6 + random() * 0.5;
  const count = Math.max(8, Math.round(radius));
  // The noise does not wrap, so lean it back to its start as it goes around.
  const gap = edge(around) - edge(0);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * around;
    const r = radius * (1 + edge(angle) - gap * (i / count));
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r * squash]);
  }
  return toPath(points);
}

// Smooth 1D noise: the sum of value noise at each [period, amplitude].
function wave(
  random: () => number,
  length: number,
  octaves: readonly (readonly [number, number])[],
): Profile {
  const layers = octaves.map(([period, amplitude]) => {
    const knots = Array.from(
      { length: Math.ceil(length / period) + 2 },
      () => random() * 2 - 1,
    );
    return (x: number) => {
      const t = Math.max(0, x) / period;
      const i = Math.floor(t);
      const f = t - i;
      const ease = f * f * (3 - 2 * f);
      const from = knots[i] ?? 0;
      const to = knots[i + 1] ?? 0;
      return amplitude * (from + (to - from) * ease);
    };
  });
  return (x) => layers.reduce((sum, layer) => sum + layer(x), 0);
}

function seeded(seed: number) {
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function steps(from: number, to: number) {
  const values: number[] = [];
  for (let v = from; v < to; v += STEP) values.push(v);
  values.push(to);
  return values;
}

function toPath(points: [number, number][]) {
  return `${points.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join(" ")} Z`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function n(value: number) {
  return value.toFixed(1);
}

const styles = StyleSheet.create({
  paper: {
    position: "absolute",
    top: -BLEED,
    left: -BLEED,
  },
});
