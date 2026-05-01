# Compare Viewer Node

## Goal

Add a `compare_viewer` output node that renders two same-sized images in the Viewer pane with a draggable vertical before/after wipe.

## Approach

- Add a Rust `CompareViewer` standard output node with `before` and `after` image inputs, hidden compare outputs, and `display` forwarding the after image.
- Extend runtime, WASM, worker, Tauri, and frontend render result plumbing so compare viewers return both displayed RGBA buffers.
- Update the React viewer and viewer node card to display compare results with an interactive vertical split.
- Keep mismatched image dimensions as a render error; users should align images explicitly with Resize/Crop nodes.

## Affected Areas

- `crates/cascade-nodes-std`, `crates/cascade-core`, `crates/cascade-runtime`, `crates/cascade-wasm`
- `apps/tauri/src-tauri`
- `apps/web/src/engine`, `apps/web/src/store`, `apps/web/src/components`

## Checklist

- [x] Add and register the Rust `compare_viewer` node.
- [x] Treat compare viewers as output/viewer nodes for invalidation and selection.
- [x] Add compare render payload support across runtime, WASM, worker, and Tauri.
- [x] Add frontend compare result types, decoding, downscaling, transferables, and viewer UI.
- [x] Add/update focused Rust and frontend tests.
- [x] Run validation and record any blockers.
