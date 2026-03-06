# Color Picker Input Lag Fix

## Problem

Connecting a Solid Color node to a Viewer and dragging the color picker causes ~220-400ms input delay per render cycle. Sliders (e.g., hue in HSL node) work smoothly.

## Root Cause Analysis

Three layers of issues:

### Layer 1: handleColorCommit double-fires (CRITICAL)

`NodeColorPicker.tsx` `handleColorCommit` called both `onChange()` (live render at 0.3 scale) AND `onChangeCommit()` (full-res commit render at 1.0 scale) on every `onChange` event from `<input type="color">`. Chrome fires `onChange` continuously during drag, so every color change triggered a full 1920x1080 render instead of a 576x324 preview.

### Layer 2: No deduplication on color picker events

Unlike `NodeSlider`'s `lastEmittedRef` pattern, the color picker had no dedup. Identical hex values re-fired `onChange`, causing unnecessary renders.

### Layer 3: Sequential rasterization in WASM

`rasterize_field()` in `cascade-wasm/src/lib.rs` used a plain `for` loop over 2M+ pixels instead of Rayon parallel iteration. `Field::rasterize()` already existed with `par_chunks_exact_mut()` but wasn't being used.

## Changes

- [x] `apps/web/src/components/nodes/NodeColorPicker.tsx`
  - Removed redundant `onChange()` call from `handleColorCommit` — now only fires `onChangeCommit`
  - Added `lastEmittedHexRef` deduplication to `handleColorInput`
  - Added `useRef` import

- [x] `crates/cascade-wasm/src/lib.rs`
  - Replaced sequential for-loop in `rasterize_field()` with `field.rasterize(w, h)` which uses Rayon `par_chunks_exact_mut`

- [x] `apps/web/src/components/ColorRampEditor.tsx`
  - Added `lastColorHexRef` deduplication to `handleColorChange`

## Expected Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| Color picker live drag (per render) | 220-400ms (full-res) | ~30-50ms (0.3 scale + parallel) |
| Color picker commit (on close) | 220-400ms | ~80-120ms (full-res + parallel) |
| Field rasterization (1920x1080) | 80-150ms (sequential) | ~20-40ms (Rayon parallel) |
