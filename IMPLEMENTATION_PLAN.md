# Implementation Plan — Compositor Feature Gaps

## Executive Summary

This plan addresses the gaps identified in the compositor review, ordered by priority and impact. Work is divided into 4 parallel batches that can be implemented simultaneously since they touch different files.

---

## Batch 1: Optional Mask Input Pattern (HIGHEST PRIORITY)

**Why first:** This is the single biggest functional gap. Without mask inputs, users cannot restrict any operation to a specific region — the most fundamental compositing workflow pattern.

### 1A. Add `apply_mask` helper function
- **File:** `crates/compositor-nodes-std/src/lib.rs` (or new `utils.rs`)
- **What:** A shared helper that blends processed output with original input based on a mask image's luminance
- **Pattern:** `fn apply_mask(original: &Image, processed: &Image, mask: &Image) -> Image`
- **Logic:** For each pixel: `output = lerp(original, processed, mask_luminance)`

### 1B. Add optional `mask` input to ALL color nodes
- **Files:** `color.rs`, `color_ops.rs`  
- **Nodes affected (13):** BrightnessContrast, HueSaturation, Invert, Levels, Curves, ColorBalance, ChannelShuffle, Threshold, Posterize, Gamma
- **Pattern:** Add optional `mask` input port (ValueType::Image). If connected, apply mask. If not connected, pass through as before.
- **EvalContext change needed:** Add `get_optional_input_image()` helper that returns `Option<&Image>` instead of `Result`

### 1C. Add optional `mask` input to ALL filter nodes  
- **Files:** `filter.rs`, `filter_ops.rs`
- **Nodes affected (6):** GaussianBlur, Sharpen, EdgeDetect, Dilate, Erode, Median

### 1D. Add `get_optional_input_image()` to EvalContext
- **File:** `crates/compositor-core/src/node.rs`
- **What:** `pub fn get_optional_input_image(&self, name: &str) -> Option<&Image>` — returns None if not connected instead of Err

---

## Batch 2: New Nodes (HIGH PRIORITY)

All new nodes follow the existing pattern: struct, `Node` trait impl, register in `lib.rs`.

### 2A. Despill Node
- **File:** `crates/compositor-nodes-std/src/matte.rs` (add to existing)
- **Category:** Matte
- **Params:** key_color (RGB sliders), strength (0-1), method (dropdown: Average, Double Green)
- **Logic:** Reduce channel that dominates the key color. For green: `g = min(g, max(r, b) * strength_factor)`

### 2B. Shape / Roto Node  
- **File:** `crates/compositor-nodes-std/src/generate.rs` (add to existing)
- **Category:** Generator
- **Params:** shape (Dropdown: Ellipse, Rectangle, RoundedRect), width, height, center_x, center_y, size_x, size_y, corner_radius, feather, invert
- **Output:** Grayscale mask image (white shape on black background)
- **Logic:** SDF-based rendering with feathering

### 2C. SaveImage Node
- **File:** new `crates/compositor-nodes-std/src/output.rs` (extend existing)
- **Category:** Output  
- **Params:** format (Dropdown: PNG, JPEG), quality (0-100 for JPEG)
- **Note:** In WASM context, this triggers a download. In native, writes to path. For now, just encode to bytes and return as a special Value.
- **Actually:** Since we can't write to disk from WASM, implement as `encode_to_bytes()` method on a new `ExportImage` node that the WASM bridge can call to get encoded bytes, similar to how `render_viewer` returns raw pixel data.

### 2D. WhiteBalance Node
- **File:** `crates/compositor-nodes-std/src/color_ops.rs` (add to existing)
- **Category:** Color
- **Params:** temperature (-100 to 100), tint (-100 to 100)
- **Logic:** Temperature shifts blue↔yellow axis, tint shifts green↔magenta axis. Apply as channel multipliers in linear space.

### 2E. Vibrance Node
- **File:** `crates/compositor-nodes-std/src/color_ops.rs` (add to existing)
- **Category:** Color
- **Params:** vibrance (-1 to 1)
- **Logic:** Boost saturation proportionally to how desaturated a pixel already is. `sat_boost = vibrance * (1.0 - current_saturation)`

### 2F. Vignette Node
- **File:** `crates/compositor-nodes-std/src/filter_ops.rs` (add to existing)
- **Category:** Filter
- **Params:** amount (0-1), size (0-2), softness (0-1)
- **Logic:** Radial falloff from center, multiply RGB channels by falloff

### 2G. Glow/Bloom Node
- **File:** `crates/compositor-nodes-std/src/filter_ops.rs` (add to existing)
- **Category:** Filter
- **Params:** threshold (0-1), radius (0-100), intensity (0-2)
- **Logic:** Extract pixels above threshold → blur → add back to original (Screen blend)

### 2H. GradientMap Node
- **File:** `crates/compositor-nodes-std/src/color_ops.rs` (add to existing)
- **Category:** Color
- **Params:** color_low_r/g/b, color_mid_r/g/b, color_high_r/g/b, strength (0-1)
- **Logic:** Convert pixel to luminance → map to color gradient → blend with original by strength

### 2I. ToneMap Node
- **File:** `crates/compositor-nodes-std/src/color_ops.rs` (add to existing)
- **Category:** Color
- **Params:** method (Dropdown: Reinhard, ACES Filmic, Uncharted 2), exposure (-5 to 5)
- **Logic:** Apply exposure multiply, then tone mapping curve

---

## Batch 3: Blend & Composite Improvements (MEDIUM PRIORITY)

### 3A. Add mask input to Blend node
- **File:** `crates/compositor-nodes-std/src/blend.rs`
- **What:** Add optional `mask` input. When present, blend amount is modulated per-pixel by mask luminance.

### 3B. Add mask input to AlphaOver node
- **File:** `crates/compositor-nodes-std/src/blend.rs`
- **What:** Same pattern — mask modulates the foreground alpha.

### 3C. Add missing blend modes
- **File:** `crates/compositor-nodes-std/src/blend.rs`
- **Add:** Color Burn (11), Linear Burn (12), Vivid Light (13), Linear Light (14), Pin Light (15), Exclusion (16), Subtract (17), Divide (18)
- **Update dropdown max from 10 to 18**

### 3D. ChromaKey dual output
- **File:** `crates/compositor-nodes-std/src/matte.rs`
- **What:** Add second output port `matte` (ValueType::Image) that outputs the generated alpha matte as a grayscale image, enabling matte inspection and downstream matte refinement.

---

## Batch 4: Transform Improvements (MEDIUM PRIORITY)

### 4A. Transform2D unified node
- **File:** new addition to `crates/compositor-nodes-std/src/transform.rs`
- **Category:** Transform
- **Params:** translate_x, translate_y, rotate (degrees), scale_x, scale_y, pivot_x, pivot_y, filter (Nearest/Bilinear)
- **Logic:** Build a single affine matrix from all params, apply in one resampling pass
- **Why:** Avoids quality loss from chaining Translate → Rotate → Resize (3 resampling passes)

---

## Registration Checklist

All new nodes must be registered in `crates/compositor-nodes-std/src/lib.rs`:
- Add `pub use` for each new struct
- Add `registry.register("type_id", || Box::new(NodeType::new()))` in `register_standard_nodes()`

The frontend auto-discovers new nodes via `list_node_types()` — no frontend changes needed for new nodes.

---

## Files Modified Per Batch

| Batch | Files Modified |
|-------|---------------|
| 1 | `core/node.rs`, `nodes-std/lib.rs` (new utils), `nodes-std/color.rs`, `nodes-std/color_ops.rs`, `nodes-std/filter.rs`, `nodes-std/filter_ops.rs` |
| 2 | `nodes-std/matte.rs`, `nodes-std/generate.rs`, `nodes-std/output.rs`, `nodes-std/color_ops.rs`, `nodes-std/filter_ops.rs`, `nodes-std/lib.rs` |
| 3 | `nodes-std/blend.rs`, `nodes-std/matte.rs`, `nodes-std/lib.rs` |
| 4 | `nodes-std/transform.rs`, `nodes-std/lib.rs` |

**Key constraint:** Batches 2, 3, 4 all modify `lib.rs` for registration. These registrations should be merged carefully at the end.
