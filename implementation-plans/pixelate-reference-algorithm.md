# Pixelate: Port the zac.is-a.dev/pixelate Algorithm

## Goal

Replace both existing Pixelate dithering modes ("Two Nearest" and "Threshold Offset") with a single
algorithm that reproduces [zac.is-a.dev/pixelate](https://zac.is-a.dev/pixelate/)
([source](https://github.com/zacharyfmarion/pixelate), pinned at `efe80c9`) exactly. Given the same
8-bit source image, palette, block size, Bayer matrix, and strength, Cascade's Pixelate node should
produce the same 8-bit output as the reference web worker.

## Reference Algorithm (`src/workers/imageProcessor.worker.ts`)

All math runs on 8-bit sRGB-encoded, straight-alpha RGBA (canvas `ImageData`):

1. **Pixelate** (block size > 1): tile the image from the top-left in `blockSize` squares (edge
   blocks are partial). Each block becomes `Math.round(sum / count)` of its pixels, per channel,
   including alpha.
2. **Palette** (only when a palette is loaded):
   - Build a 32×32×32 LUT: bucket `(rq, gq, bq)` maps to the palette index nearest to the bucket
     center `(q << 3) + 4`, using weighted distance `2·dR² + 4·dG² + 3·dB²` (first minimum wins).
   - **Dithering on**: per pixel, `offset = (bayer[cell] / n² − 0.5) · strength · 64`, where the
     cell comes from block coordinates `(⌊x / blockSize⌋ mod n, ⌊y / blockSize⌋ mod n)`. Add the
     offset to R, G, B, clamp to [0, 255], quantize with `>> 3`, and look up the LUT.
   - **Dithering off**: look up the LUT with `>> 3` directly (identical to strength 0).
   - Alpha passes through unchanged from the pixelated image.
3. **Palette extraction** (`extractPaletteFromStrip`): scan the strip row-major, skip pixels with
   alpha < 128, keep unique RGB in first-seen order, drop colors within Euclidean distance < 10 of
   an already-kept color, then evenly sample down to 256 colors if needed.

## Approach

Keep the node id `gpu_kernel::pixelate` (DSL, examples, and saved projects keep working), but
replace the single-pass manifest kernel with a custom multi-pass GPU node, because a per-pixel
kernel cannot compute block averages without O(blockSize²) reads per pixel.

- **CPU (exact, CI-tested helpers)**: palette extraction from the palette image (reference
  semantics), sRGB code ⇄ linear conversion, and a dither bucket table: for every (Bayer cell,
  8-bit channel value) the LUT bucket JavaScript's double arithmetic produces. A per-cell
  `floor(offset)` shortcut is *not* exact — when an offset sits a hair below an integer,
  `value + offset` rounds up for some magnitudes — so the table replays the JS math verbatim.
- **Strength normalization**: round to 3 decimals like the reference slider, because Cascade's
  slider snaps to e.g. `0.15000000000000002` while the reference uses `0.15`.
- **GPU pass 1 (LUT)**: 32,768 invocations build the nearest-color LUT into a storage buffer.
- **GPU pass 2 (blocks)**: one invocation per block encodes its pixels to sRGB codes, averages with
  JS `Math.round` semantics in integer math, maps each channel through the dither bucket table,
  looks up the LUT, and writes the final RGBA codes into a small `rgba8uint` texture (one texel
  per block).
- **CPU expand**: read back only the block texture and fill the full-resolution output by decoding
  codes to linear (bit-identical to Load Image's sRGB decode). This avoids a full-resolution f16
  readback and makes output colors exact.
- Inputs tagged `sRGB` are treated as already encoded; everything else as linear sRGB (matches Load
  Image and the Color Palette node).

Params mirror the reference controls:

| Param | Type | Default | Reference |
| --- | --- | --- | --- |
| `pixel_size` | Int 1–128 (pixel-space, preview-scaled) | 8 | Block Size (1 = pixelation off) |
| `dither_matrix` | Dropdown 2x2 / 4x4 / 8x8 | 4x4 | Matrix Size |
| `dither_strength` | Float 0–1 | 0.5 | Strength (0 = dithering off) |

Removed params (`algorithm`, `matrix_size`, `dither_amount`) are ignored if present in old
projects; the bundled example project is updated to the new keys.

## Affected Areas

- `crates/cascade-gpu/src/pixelate.rs` (new): node, shaders, CPU helpers, tests
- `crates/cascade-gpu/src/manifest.rs`: remove `builtin_pixelate_manifest`
- `crates/cascade-gpu/src/lib.rs`: register the new node, drop old pixelate tests
- `crates/cascade-gpu/Cargo.toml`: add `rayon` for the CPU expand step
- `crates/cascade-gpu/testdata/pixelate-golden.mjs` (new): golden-vector generator
- `apps/web/public/examples/pixel-art-palette-grade.casc`: migrate params
- `apps/web/public/examples/thumbs/pixel-art-palette-grade.webp`: re-render with the new algorithm

## Checklist

- [x] Study reference implementation and verify the deployed worker matches the source
- [x] Generate golden vectors by running the deployed reference worker in Node
- [x] Add CPU helpers (sRGB codes, palette extraction, dither bucket table) with unit tests
- [x] Add GPU LUT + block shaders and the custom `GpuPixelateNode`
- [x] Register the node and remove the old manifest kernel + tests
- [x] Add GPU tests: golden vectors, CPU-oracle parity, preview scale, domain, sRGB-tagged input
- [x] Migrate the bundled example project params
- [x] Run Rust validation (check, test, clippy, fmt, `cargo check -p cascade-tauri`)
- [x] Build WASM and verify in the web app (WebGPU output is bit-identical to the native render)
- [x] Re-render the example thumbnail (same crop, lossless WebP)
