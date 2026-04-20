# Transform 2D Edge Fill

## Goal

Fix the GPU `Transform 2D` node so translating or otherwise sampling outside the source image produces transparent black instead of smearing edge pixels across the buffer.

## Approach

Update the `Transform 2D` GPU kernel to use zero-filled out-of-bounds sampling for both nearest and bilinear filtering, matching Cascade's existing transform sampling semantics. Add GPU tests that verify integer translation gap fill and bilinear edge behavior.

## Affected Areas

- `crates/cascade-gpu/src/transform_kernels.rs`
- `crates/cascade-gpu/src/lib.rs`

## Checklist

- [x] Confirm the intended boundary behavior from existing transform/image sampling code
- [x] Update the GPU `Transform 2D` kernel to return transparent black outside source bounds
- [x] Add regression tests for integer translation and bilinear edge sampling
- [x] Run Rust validation for the touched crates
- [ ] Prepare commit, push the branch, and open a draft PR against `main`
