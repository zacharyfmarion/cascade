# Mixed-Size Batch Rendering

## Goal

Mixed-size batch sources should render each frame with independent pixels, logical dimensions,
preview buffers, and export dimensions across direct viewing, CPU/GPU processing, persistence,
and rapid frame navigation.

## Checklist

- [x] Add source revisioning for mutable loader nodes and include it in evaluator cache keys.
- [x] Preserve image domain semantics through preview downscale and dimension-preserving nodes.
- [x] Normalize viewer result metadata to explicit buffer/display dimensions with compatibility aliases.
- [x] Drop stale viewer results when rapid frame changes return out of order.
- [x] Add mixed-size batch runtime, node-domain, bridge, viewer, UX, persistence, and export tests.
- [x] Run the requested Rust/frontend validation gates.
- [x] Verify the mixed-size assets folder through a gated local acceptance test for direct viewer, CPU filter, and export dimensions.

## Validation Notes

- Local assets acceptance uses `CASCADE_MIXED_ASSETS_DIR` so the committed test remains portable.
- The local folder `/Users/zacharymarion/Documents/open source/cascade/assets` rendered/exported the expected dimensions:
  `1208x2624`, `3200x2126`, `2048x2048`, `746x442`, and `546x472`.
- Runtime-local Pixelate was not registered as a standard runtime node in this test context, so GPU domain coverage is handled by the
  `cascade-gpu` Pixelate domain-preservation test.
