// Golden-vector generator for the Pixelate node (crates/cascade-gpu/src/pixelate.rs).
//
// Runs the *deployed* zac.is-a.dev/pixelate web worker (pure computation, no I/O) with a fake
// `self`, feeds it deterministic inputs, and prints the outputs the Rust tests embed.
//
// The vectors in pixelate.rs came from imageProcessor.worker-CVNuKRmo.js (source commit efe80c9).
// To regenerate, find the current worker bundle referenced by the site's main script, then:
//
//   curl -sL https://zac.is-a.dev/pixelate/assets/<imageProcessor.worker-*.js> -o /tmp/worker.js
//   node crates/cascade-gpu/testdata/pixelate-golden.mjs /tmp/worker.js
import { readFileSync } from 'node:fs';

const workerPath = process.argv[2];
if (!workerPath) {
  console.error('usage: node pixelate-golden.mjs <imageProcessor.worker.js>');
  process.exit(1);
}
const workerSource = readFileSync(workerPath, 'utf8');

let lastResponse = null;
const fakeSelf = {
  onmessage: null,
  postMessage(response) {
    lastResponse = response;
  },
};
// eslint-disable-next-line no-new-func
new Function('self', workerSource)(fakeSelf);
if (typeof fakeSelf.onmessage !== 'function') throw new Error('worker did not install onmessage');

function runWorker(codes, width, height, params, palette) {
  lastResponse = null;
  const buffer = new Uint8ClampedArray(codes).buffer;
  fakeSelf.onmessage({
    data: { type: 'process', requestId: 1, imageBuffer: buffer, width, height, params, palette },
  });
  if (!lastResponse) throw new Error('worker produced no response');
  return new Uint8Array(lastResponse.imageBuffer);
}

// Same LCG as the Rust tests: state = state * 1664525 + 1013904223 (mod 2^32), value = top byte.
function makeImage(width, height, seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
  const codes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = next();
    const g = next();
    const b = next();
    const t = next();
    codes[i * 4] = r;
    codes[i * 4 + 1] = g;
    codes[i * 4 + 2] = b;
    codes[i * 4 + 3] = t < 64 ? t * 4 : 255;
  }
  return codes;
}

const hexToRgb = (hex) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
const SLSO8 = ['#0d2b45', '#203c56', '#544e68', '#8d697a', '#d08159', '#ffaa5e', '#ffd4a3', '#ffecd6'].map(hexToRgb);
const TWILIGHT5 = ['#fbbbad', '#ee8695', '#4a7a96', '#333f58', '#292831'].map(hexToRgb);

const params = (blockSize, dither, matrixSize, strength) => ({
  adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
  // Cascade's pixel_size = 1 corresponds to the reference with pixelation disabled.
  pixelation: { enabled: blockSize > 1, blockSize },
  dithering: { enabled: dither, matrixSize, strength },
});

// FNV-1a 64-bit over bytes.
function fnv1a64(bytes) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return '0x' + hash.toString(16).padStart(16, '0');
}
const toHex = (bytes) => Buffer.from(bytes).toString('hex');

const smallCases = [
  { name: 'block4_bayer4_s050_slso8', w: 9, h: 7, seed: 1, p: params(4, true, 4, 0.5), pal: SLSO8 },
  { name: 'block1_bayer8_s035_twilight5', w: 9, h: 7, seed: 2, p: params(1, true, 8, 0.35), pal: TWILIGHT5 },
  { name: 'block3_nodither_slso8', w: 9, h: 7, seed: 3, p: params(3, false, 4, 0.5), pal: SLSO8 },
  { name: 'block2_no_palette', w: 9, h: 7, seed: 4, p: params(2, true, 4, 0.5), pal: [] },
  { name: 'block2_bayer2_s100_twilight5', w: 9, h: 7, seed: 5, p: params(2, true, 2, 1.0), pal: TWILIGHT5 },
  { name: 'block5_bayer8_s075_slso8', w: 9, h: 7, seed: 6, p: params(5, true, 8, 0.75), pal: SLSO8 },
];

console.log('// ---- small cases (full expected output, hex RGBA) ----');
for (const c of smallCases) {
  const out = runWorker(makeImage(c.w, c.h, c.seed), c.w, c.h, c.p, c.pal);
  console.log(`${c.name}: ${toHex(out)}`);
}

// Larger cases: compare by hash. 37x29 with assorted block sizes covers all Bayer cells.
const largeCases = [];
for (const [blockSize, matrixSize, strength, palName, dither] of [
  [1, 2, 0.5, 'slso8', true],
  [1, 4, 1.0, 'twilight5', true],
  [1, 8, 0.05, 'slso8', true],
  [2, 8, 0.65, 'slso8', true],
  [3, 4, 0.25, 'twilight5', true],
  [4, 8, 0.9, 'slso8', true],
  [6, 2, 0.4, 'twilight5', true],
  [7, 4, 0.5, 'slso8', false],
  [8, 4, 0.5, 'slso8', true],
  [3, 8, 0.0, 'twilight5', true],
  [5, 4, 0.5, 'none', true],
]) {
  largeCases.push({ blockSize, matrixSize, strength, palName, dither });
}
console.log('// ---- large cases (37x29, seed 42): blockSize matrix strength palette dither hash ----');
const largeImage = makeImage(37, 29, 42);
for (const c of largeCases) {
  const pal = c.palName === 'slso8' ? SLSO8 : c.palName === 'twilight5' ? TWILIGHT5 : [];
  const out = runWorker(largeImage, 37, 29, params(c.blockSize, c.dither, c.matrixSize, c.strength), pal);
  console.log(`${c.blockSize} ${c.matrixSize} ${c.strength} ${c.palName} ${c.dither} ${fnv1a64(out)}`);
}

// ---- Palette extraction (transcribed verbatim from src/lib/processing/palette.ts @ efe80c9) ----
function extractPaletteFromStrip(imageData, options = {}) {
  const { maxColors = 256, minColorDifference = 10 } = options;
  const { data } = imageData;
  const colorMap = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const key = `${r},${g},${b}`;
    if (!colorMap.has(key)) {
      colorMap.set(key, { r, g, b });
    }
  }
  let colors = Array.from(colorMap.values());
  colors = deduplicateColors(colors, minColorDifference);
  if (colors.length > maxColors) {
    colors = sampleColors(colors, maxColors);
  }
  return colors;
}
function deduplicateColors(colors, minDifference) {
  const result = [];
  const minDistSq = minDifference ** 2;
  for (const color of colors) {
    const isDuplicate = result.some((existing) => {
      const dist = (color.r - existing.r) ** 2 + (color.g - existing.g) ** 2 + (color.b - existing.b) ** 2;
      return dist < minDistSq;
    });
    if (!isDuplicate) result.push(color);
  }
  return result;
}
function sampleColors(colors, count) {
  if (colors.length <= count) return colors;
  const result = [];
  const step = colors.length / count;
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(i * step);
    result.push(colors[idx]);
  }
  return result;
}

// Strip with duplicates, near-duplicates, alpha threshold edge cases, 2D layout (4x3).
const strip = [
  [10, 20, 30, 255], [10, 20, 30, 255], [15, 24, 33, 255], [20, 20, 30, 255],
  [200, 0, 0, 127], [200, 0, 0, 128], [0, 255, 0, 255], [6, 0, 0, 255],
  [0, 0, 0, 255], [3, 4, 5, 255], [255, 255, 255, 0], [250, 250, 250, 255],
].flat();
const extracted = extractPaletteFromStrip({ data: new Uint8ClampedArray(strip) });
console.log('// ---- palette extraction (4x3 strip) ----');
console.log(JSON.stringify(extracted.map((c) => [c.r, c.g, c.b])));

// >256 distinct, well-separated colors: grid with spacing 12 in each axis, row-major order.
const many = [];
for (let r = 0; r < 256 && many.length < 300 * 4; r += 12) {
  for (let g = 0; g < 256 && many.length < 300 * 4; g += 12) {
    for (let b = 0; b < 256 && many.length < 300 * 4; b += 12) {
      many.push(r, g, b, 255);
    }
  }
}
const sampled = extractPaletteFromStrip({ data: new Uint8ClampedArray(many) });
console.log('// ---- palette extraction (300 grid colors) ----');
console.log(`count=${sampled.length} hash=${fnv1a64(sampled.flatMap((c) => [c.r, c.g, c.b]))}`);
console.log(`first=${JSON.stringify([sampled[0], sampled[1], sampled[255]].map((c) => [c.r, c.g, c.b]))}`);
