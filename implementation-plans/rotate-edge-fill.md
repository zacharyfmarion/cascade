# Rotate Edge Fill

## Goal

Fix the GPU `Rotate` node so pixels that sample outside the source image become transparent black instead of repeating edge pixels, matching `Transform 2D` and translate behavior.

## Approach

Update the `Rotate` GPU kernel to use explicit out-of-bounds checks for nearest and bilinear sampling. Add GPU regression tests that verify rotated corners expose transparent pixels and bilinear edge samples fade into transparency.

## Affected Areas

- `crates/cascade-gpu/src/transform_kernels.rs`
- `crates/cascade-gpu/src/lib.rs`

## Checklist

- [x] Confirm current Rotate clamps out-of-bounds source coordinates
- [x] Update the GPU `Rotate` kernel to return transparent black outside source bounds
- [x] Add regression tests for nearest and bilinear rotate edge behavior
- [x] Run focused Rust validation for the touched crate
- [x] Prepare PR handoff
