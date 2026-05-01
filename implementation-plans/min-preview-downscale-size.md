# Minimum Preview Downscale Size

## Goal

Prevent live preview downscaling from making already-small images visibly pixelated when the configured preview scale is low.

## Approach

Clamp the effective preview scale so pixel-carrying preview results keep an aspect-preserving 600px minimum edge size. If an image is too small to satisfy that minimum, leave it at full resolution. Apply the same rule both where Rust source nodes downscale images for engine-side preview and where the web store downscales viewer results.

## Affected Areas

- `crates/cascade-nodes-std/src/input.rs`
- `crates/cascade-runtime/src/lib.rs`
- `apps/web/src/store/graphStore/kernel.ts`
- `apps/web/src/__tests__/previewDownscale.test.ts`

## Checklist

- [x] Add implementation plan
- [x] Update Rust preview downscale sizing and tests
- [x] Update web preview result downscale sizing and tests
- [x] Run targeted validation
