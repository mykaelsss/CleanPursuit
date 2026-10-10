// Generates assets/images/paper-crumple.png, the crumpled paper shading laid
// over the wanted poster.
//
// Crumpling a sheet folds it along short creases, and flattening it again
// leaves those creases as soft ridges and valleys with flat patches between
// them. This builds a height map from a few hundred random folds at
// several sizes, lights it from the top left and writes the result as a
// transparent overlay: warm shadow where the paper faces away from the light
// and warm highlight where it faces it.
//
// Run with `npm run generate:paper` from app/.
// It has no dependencies and is seeded, so it always writes the same image.

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const WIDTH = 720;
const HEIGHT = 1120;
const SEED = 1871;
const OUTPUT = new URL("../assets/images/paper-crumple.png", import.meta.url);

// [fold length in pixels, slope] for each size of fold, largest first.
// The poster is only lightly wrinkled, so the folds are few and shallow.
const FOLDS = [
  [260, 0.08],
  [140, 0.06],
  [75, 0.04],
  [40, 0.025],
];
// Folds per area at each size, relative to the fold's own length squared.
const FOLD_DENSITY = 0.7;
// Rounds the tip of each crease, in pixels, so creases look pressed flat.
const CREASE_SOFTNESS = 1.5;
// Where the light comes from: the top left, a little above the paper.
const LIGHT = normalize([-0.6, -0.8, 1.2]);
// Shade values are multiplied by this to get the overlay's opacity.
const GAIN = 1.5;
const MAX_ALPHA = 0.4;
const SHADOW = [74, 42, 16];
const HIGHLIGHT = [255, 246, 224];

const random = mulberry32(SEED);
const height = new Float32Array(WIDTH * HEIGHT);

// Broad swells in the sheet, so it is not uniformly crumpled.
const swell = valueNoise(320);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) height[y * WIDTH + x] = 10 * swell(x, y);
}

for (const [length, slope] of FOLDS) {
  const count = Math.round((FOLD_DENSITY * WIDTH * HEIGHT) / length ** 2);
  for (let i = 0; i < count; i++) fold(length, slope);
}

const shade = new Float32Array(WIDTH * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const at = (dx, dy) =>
      height[
        Math.min(HEIGHT - 1, Math.max(0, y + dy)) * WIDTH +
          Math.min(WIDTH - 1, Math.max(0, x + dx))
      ];
    const gx = (at(1, 0) - at(-1, 0)) / 2;
    const gy = (at(0, 1) - at(0, -1)) / 2;
    const normal = normalize([-gx, -gy, 1]);
    const lit =
      normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2];
    shade[y * WIDTH + x] = lit - LIGHT[2];
  }
}

writePng(OUTPUT, overlay(shade));
console.log(`Wrote ${OUTPUT.pathname}`);

// Adds one fold: a straight crease through a random point, raising the paper
// on both sides of it into a ridge (or sinking it into a valley). The fold
// fades out along and across its line, so it only creases a patch of paper,
// and many overlapping folds make the crumple.
function fold(length, slope) {
  const cx = random() * WIDTH;
  const cy = random() * HEIGHT;
  const angle = random() * Math.PI;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const amount = slope * (0.4 + random() * 0.6) * (random() < 0.5 ? 1 : -1);
  const along = length * (0.5 + random() * 0.5);
  const across = along * 0.6;

  const reach = Math.ceil(along);
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(WIDTH - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + reach));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const a = dx * ux + dy * uy;
      const d = dy * ux - dx * uy;
      // Falls smoothly to exactly zero at the edge of the patch, so the fold
      // leaves no seam where it ends.
      const r = (a / along) ** 2 + (d / across) ** 2;
      if (r >= 1) continue;
      const fade = (1 - r) ** 3;
      const crease = Math.sqrt(d * d + CREASE_SOFTNESS ** 2);
      height[y * WIDTH + x] += amount * crease * fade;
    }
  }
}

// Smooth 2D value noise in [-1, 1] with features about `scale` pixels apart.
function valueNoise(scale) {
  const cols = Math.ceil(WIDTH / scale) + 2;
  const rows = Math.ceil(HEIGHT / scale) + 2;
  const knots = Array.from({ length: cols * rows }, () => random() * 2 - 1);
  const ease = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / scale;
    const gy = y / scale;
    const c = Math.floor(gx);
    const r = Math.floor(gy);
    const fx = ease(gx - c);
    const fy = ease(gy - r);
    const at = (dc, dr) => knots[(r + dr) * cols + c + dc] ?? 0;
    const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
    const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

// Turns shade values into RGBA pixels: warm shadow below zero, warm highlight
// above, and transparent where the paper faces the viewer.
function overlay(values) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  values.forEach((value, i) => {
    const color = value < 0 ? SHADOW : HIGHLIGHT;
    const alpha = Math.min(MAX_ALPHA, Math.abs(value) * GAIN);
    pixels[i * 4] = color[0];
    pixels[i * 4 + 1] = color[1];
    pixels[i * 4 + 2] = color[2];
    pixels[i * 4 + 3] = Math.round(alpha * 255);
  });
  return pixels;
}

function writePng(url, pixels) {
  const stride = WIDTH * 4;
  // Each row is stored as its difference from the row above, which keeps the
  // smooth facets small once compressed.
  const rows = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    rows[y * (stride + 1)] = 2;
    for (let i = 0; i < stride; i++) {
      const above = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      rows[y * (stride + 1) + 1 + i] = (pixels[y * stride + i] - above) & 0xff;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 6, 0, 0, 0], 8);

  writeFileSync(
    url,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}
