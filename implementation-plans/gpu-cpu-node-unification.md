# GPU/CPU Node Unification Plan

## Goal

Users see one clean set of nodes with no implementation-detail leakage. GPU is the preferred backend. CPU nodes only survive when GPU can't do the job (or would be a UX downgrade).

## Status: ✅ Complete

---

## Part 1: System-Level Mask Support for GPU Kernels ✅

**Why first:** This unblocks removing CPU nodes without feature regression.

**Changes to `cascade-gpu`:**

1. **`manifest.rs`** — Add `supports_mask: bool` field to `KernelManifest` (default `true`)
2. **`manifest.rs` → `to_node_spec()`** — When `supports_mask`, auto-inject optional `"mask"` image input port
3. **`manifest.rs` → `build_glsl()`** — When `supports_mask` and mask is present, inject GLSL after `process()`:
   ```glsl
   vec4 result = process(color, uv, pixel);
   if (has_mask == 1) {
       float mask_val = texelFetch(mask_tex, pixel, 0).a;
       result = mix(color, result, mask_val);
   }
   ```
4. No changes to individual kernel GLSL files — every kernel gets mask support automatically

**Exception:** Some kernels where masking doesn't make sense (e.g., Premultiply, Unpremultiply, Extract Channel, Set Alpha) should set `supports_mask: false`.

---

## Part 2: Upgrade 2 GPU Kernels to Feature Parity ✅

**luminance_key** (`matte_kernels.rs`):
- Add `invert` Int param (checkbox, default 0)
- GLSL: `if (invert == 1) key = 1.0 - key;`

**lens_distortion** (`utility_kernels.rs`):
- Add `scale` Float param (0.5–2.0, default 1.0)
- GLSL: apply UV scale before distortion sampling

---

## Part 3: Remove "GPU" from Display Names (30 nodes) ✅

**A. `color_kernels.rs` — strip "GPU " prefix (8 nodes):**

| Before | After |
|---|---|
| GPU Invert | Invert |
| GPU Brightness / Contrast | Brightness / Contrast |
| GPU Hue / Saturation / Lightness | Hue / Saturation / Lightness |
| GPU Gamma | Gamma |
| GPU Threshold | Threshold |
| GPU Posterize | Posterize |
| GPU White Balance | White Balance |
| GPU Clamp | Clamp |

**B. Other kernel files — strip " (GPU)" suffix (22 nodes):**
- `blend_kernels.rs`: Blend, Alpha Over, Merge, Key Mix, Image Math, Channel Shuffle, Copy Channels
- `matte_kernels.rs`: Premultiply, Unpremultiply, Chroma Key, Despill, Luminance Key, Difference Matte, Set Alpha, Extract Channel
- `color_kernels_advanced.rs`: Levels, Vibrance, Tone Map, Grade, Gradient Map, Color Balance
- `transform_kernels.rs`: Resize, Rotate, Transform 2D
- `utility_kernels.rs`: Map Range, Vignette, Color Ramp, Edge Detect, Lens Distortion
- `manifest.rs`: Pixelate

**Exception: "GPU Script" keeps its name** — user writes GLSL code there, GPU is meaningful.

---

## Part 4: Fix Categories (25 nodes from "GPU" → proper categories) ✅

| File | Nodes | GPU → New Category |
|---|---|---|
| `blend_kernels.rs` | Blend, Alpha Over, Merge, Key Mix, Image Math, Channel Shuffle, Copy Channels | Composite |
| `matte_kernels.rs` | Premultiply, Unpremultiply, Chroma Key, Despill, Luminance Key, Difference Matte, Set Alpha, Extract Channel | Matte |
| `color_kernels_advanced.rs` | Levels, Vibrance, Tone Map, Grade, Gradient Map, Color Balance | Color |
| `manifest.rs` | Pixelate | Filter |

`script.rs` (GPU Script) keeps `category: "GPU"`.

---

## Part 5: Rename GPU Ports (Mixed Approach) ✅

### Output ports: all GPU kernels
- `"output"` → `"image"` (consistency with CPU convention)

### Input ports: rename GPU → CPU convention where CPU is better
- Alpha Over: `"image"` → `"background"`
- Merge: `"image"` / `"b_image"` → `"A"` / `"B"`
- Key Mix: `"image"` / `"b_image"` / `"mask_image"` → `"A"` / `"B"` / `"mask"`
- Copy Channels: `"image"` / `"b_image"` → `"A"` / `"B"`
- Image Math: `"image"` / `"b_image"` → `"A"` / `"B"`

### Input ports: keep GPU names (GPU is better)
- Blend: `"blend_image"` (stays — more descriptive than CPU's `"blend_input"`)
- Set Alpha: `"alpha_source"` (stays — more explicit than CPU's `"alpha"`)
- Difference Matte: `"clean_plate"` (stays — correct VFX term vs CPU's `"plate"`)

---

## Part 6: Remove CPU Nodes That Have GPU Equivalents (~32 nodes) ✅

### Remove these CPU nodes:

invert, brightness_contrast, gamma, threshold, posterize, white_balance, clamp, vibrance, grade, gradient_map, premultiply, unpremultiply, extract_channel, color_ramp, levels, color_balance, tone_map, set_alpha, difference_matte, rotate, transform_2d, image_math, hue_saturation, blend, alpha_over, merge, keymix, channel_shuffle, copy_channels, map_range, edge_detect, vignette, luminance_key, lens_distortion, despill

### Remove GPU resize
CPU resize (absolute width/height px) is the correct UX. GPU relative-scale resize is a different operation and less useful as the primary resize.

### Keep these CPU nodes (no GPU equivalent or GPU is UX downgrade):

| Node | Reason |
|---|---|
| chroma_key | GPU lacks Color picker param — UX downgrade |
| resize | Absolute width/height is the primary resize UX |
| gaussian_blur | No GPU equivalent |
| sharpen | No GPU equivalent |
| curves | No GPU equivalent |
| crop, flip, translate | No GPU equivalent |
| corner_pin, st_map | No GPU equivalent |
| dilate, erode, median | No GPU equivalent |
| directional_blur, radial_blur | No GPU equivalent |
| glow | No GPU equivalent |
| All generators, I/O, time, AI, utility nodes | No GPU equivalent |
| color_convert | No GPU equivalent |
| color_palette, separate_hsva, combine_hsva | No GPU equivalent |

---

## Part 7: DSL Namespace Cleanup ✅

**`serializer.ts`**: Strip `gpu_kernel::` prefix — `gpu_kernel::tone_map` → `ToneMap`
**`parser.ts`**: Reverse lookup — try `gpu_kernel::` prefix first, fall back to bare ID
**`handleMap.ts`**: Update aliases to GPU IDs

---

## Part 8: Migration (`v1.1.0 → v1.2.0`) ✅

### A. Remap CPU node type_ids → GPU equivalents (~32 mappings):
```
"invert" → "gpu_kernel::invert"
"brightness_contrast" → "gpu_kernel::brightness_contrast"
"keymix" → "gpu_kernel::key_mix"
... etc for all ~32 removed CPU nodes
```

### B. Remap existing GPU output port connections
`"output"` → `"image"` for all GPU kernel nodes (saved graphs reference old port name)

### C. Remap CPU input port connections (where GPU ports differ from CPU):
- blend: `"blend_input"` → `"blend_image"`
- set_alpha: `"alpha"` → `"alpha_source"`
- difference_matte: `"plate"` → `"clean_plate"`

(Alpha Over, Merge, KeyMix, CopyChannels, ImageMath — GPU ports being renamed to match CPU, so no migration needed for those)

### D. Remap param values/names:
- hue_saturation: `hue /= 180.0`, rename `"value"` → `"lightness"`
- map_range: rename `"clamp"` → `"do_clamp"`, Bool → Int
- vignette: rename `"amount"` → `"intensity"`, `"size"` → `"radius"`
- despill: rename `"strength"` → `"amount"`, drop `"key_color"`
- merge: drop `"bbox"` param

### E. Remove GPU resize — no migration needed (deleted, not remapped)

### F. Bump `CURRENT_VERSION` to `"1.2.0"`, register in `MIGRATIONS` array

---

## Part 9: Cleanup ✅

**Rust (cascade-nodes-std):** ✅ ~32 struct impls, pub uses, registrations, tests, benchmarks removed
**Rust (cascade-gpu):** ✅ GPU resize kernel removed from `transform_kernels.rs` + `lib.rs`
**Rust (cascade-runtime):** ✅ Tests updated for `supports_mask`, Color Range group test updated
**Frontend:** ✅ `handleMap.ts`, `mockEngine.ts`, `nodeIcons.tsx` updated
---

## Execution Order

1. Part 1 (mask support) — unblocks everything
2. Part 2 (upgrade luminance_key + lens_distortion)
3. Parts 3–5 (rename/category/port cleanup) — GPU side
4. Part 6 (remove CPU nodes + GPU resize)
5. Part 7 (DSL cleanup)
6. Part 8 (migration)
7. Part 9 (cleanup)
8. `cargo check --workspace && cargo test --workspace && cargo clippy --workspace` + frontend lint/typecheck

---

## Files Touched (~30-35 files)

**GPU kernel system:** `manifest.rs`, `kernel_node.rs`
**GPU kernels:** `color_kernels.rs`, `blend_kernels.rs`, `matte_kernels.rs`, `color_kernels_advanced.rs`, `transform_kernels.rs`, `utility_kernels.rs`
**CPU removal:** `color.rs`, `color_ops.rs`, `blend.rs`, `matte.rs`, `filter_ops.rs`, `transform.rs`, `utility.rs`, `lib.rs`, `node_benchmarks.rs`, `bench.rs`
**Migration:** `mod.rs`, new `v1_1_0_to_v1_2_0.rs`
**Frontend:** `serializer.ts`, `parser.ts`, `handleMap.ts`, `mockEngine.ts`, `nodeIcons.tsx`

---

## What We Won't Touch
- **GPU Script** node (keeps "GPU" name and "GPU" category)
- **CPU chroma_key** (GPU lacks Color picker param)
- **CPU resize** (absolute width/height is correct UX; GPU resize gets deleted)
- **CPU-only nodes** with no GPU equivalent (gaussian_blur, sharpen, curves, crop, flip, etc.)
- Documentation/implementation plan `.md` files (other than this one)
