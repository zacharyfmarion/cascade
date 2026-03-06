# Color Picker Input Lag Fix

## Problem

Connecting a Solid Color node to a Viewer and dragging the color picker causes ~220-400ms input delay per render cycle. Sliders (e.g., hue in HSL node) work smoothly.

## Root Cause Analysis

Three layers of issues:

### Layer 1: React onChange fires continuously on `<input type="color">` (CRITICAL)

React's `onChange` on `<input type="color">` is NOT the DOM `change` event — React normalizes it to behave like the DOM `input` event, meaning it fires continuously during drag. Both `onInput` and `onChange` in React fire on every color change while the picker is open.

This bug existed in **5 separate call sites**, each with its own inline `<input type="color">`:
- `NodeColorPicker.tsx` — param color picker
- `BaseNode.tsx` — input default color picker (Solid Color node)
- `ColorRampNode.tsx` — color ramp stop editor
- `ColorPaletteNode.tsx` — palette swatch editor
- `ColorRampEditor.tsx` — inspector ramp stop editor

Each site had some variation of `onChange` calling both live and commit renders on every color change during drag, triggering full-resolution renders (~275ms) continuously.

**Fix**: Created a centralized `NativeColorInput` component that encapsulates the correct event handling:
- `onInput` for live updates during drag (with dedup)
- Native DOM `change` event listener via `useEffect` + `ref` for actual picker dismissal

### Layer 2: No deduplication on color picker events

Unlike `NodeSlider`'s `lastEmittedRef` pattern, most color picker sites had no dedup. Identical hex values re-fired `onChange`, causing unnecessary renders. Now handled centrally in `NativeColorInput`.

### Layer 3: Sequential rasterization in WASM

`rasterize_field()` in `cascade-wasm/src/lib.rs` used a plain `for` loop over 2M+ pixels instead of Rayon parallel iteration. `Field::rasterize()` already existed with `par_chunks_exact_mut()` but wasn't being used.

## Changes

- [x] **`apps/web/src/components/ui/NativeColorInput.tsx`** (NEW)
  - Centralized `<input type="color">` wrapper with correct event handling
  - `onLive` callback — fires on every drag change (deduped by hex value)
  - `onCommit` callback — fires once when picker is dismissed (native DOM `change`)
  - All dedup and ref management lives here — call sites stay clean

- [x] **`apps/web/src/components/nodes/NodeColorPicker.tsx`**
  - Replaced inline `<input>` + `useEffect` + `lastEmittedHexRef` with `<NativeColorInput>`

- [x] **`apps/web/src/components/nodes/BaseNode.tsx`**
  - Replaced inline `<input>` + `useEffect` + `lastHexRef` with `<NativeColorInput>`

- [x] **`apps/web/src/components/nodes/ColorRampNode.tsx`**
  - Replaced `<input>` with `<NativeColorInput>`
  - Fixed `handleColorCommit` — was calling both `setParamLive` + `setParamCommit`, now only `setParamCommit`
  - Removed broken RAF-based `useEffect` throttle for stop dragging
  - Call `setParamLive` directly from `handleBarPointerMove` (scheduler coalescing makes extra throttling unnecessary)

- [x] **`apps/web/src/components/nodes/ColorPaletteNode.tsx`**
  - Replaced `<input>` with `<NativeColorInput>`
  - Fixed `handleColorCommit` — was calling both `setParamLive` + `setParamCommit`, now only `setParamCommit`

- [x] **`apps/web/src/components/ColorRampEditor.tsx`**
  - Replaced `<input>` with `<NativeColorInput>`, removed manual dedup (now in NativeColorInput)
  - Added `onLive` and `onCommit` optional props for stop position dragging
  - Falls back to `onChange` if `onLive`/`onCommit` not provided
  - During drag: calls `onLive` on pointer move, `onCommit` on pointer up

- [x] **`apps/web/src/components/Inspector.tsx`**
  - Wired `onLive` → `setParamLive` and `onCommit` → `setParamCommit` for `ColorRampEditor` stop dragging

- [x] **`crates/cascade-wasm/src/lib.rs`**
  - Replaced sequential for-loop in `rasterize_field()` with `field.rasterize(w, h)` which uses Rayon `par_chunks_exact_mut`
  - Removed unused `Image` import

## Verification

All `<input type="color">` usage now lives exclusively in `NativeColorInput.tsx`. Confirmed via:
```
grep 'type="color"' apps/web/src/**/*.tsx
→ Only matches in NativeColorInput.tsx
```

## Expected Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| Color picker live drag (per render) | 220-400ms (full-res) | ~30-50ms (0.3 scale + parallel) |
| Color picker commit (on close) | 220-400ms | ~80-120ms (full-res + parallel) |
| Color ramp stop drag (per render) | 220-400ms (commit on every move) | ~30-50ms (0.3 scale live) |
| Field rasterization (1920x1080) | 80-150ms (sequential) | ~20-40ms (Rayon parallel) |
