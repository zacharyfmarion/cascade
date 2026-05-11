# Media Iterator Batch UX

## Goal

Make batch, sequence, and video sources share a first-class media iterator model, with fast desktop batch browsing for large folders and viewer/node filmstrip previews.

## Approach

- Commit the existing batch/export work as a checkpoint before implementation.
- Change desktop batch sources to path-backed lazy entries so large folders are indexed without eager image reads.
- Add media iterator state to the graph store and derive transport/timeline behavior from the active iterator.
- Add viewer filmstrip browsing with bounded processed-thumbnail rendering.
- Add a compact source filmstrip to `LoadImageBatch`.

## Affected Areas

- Rust `LoadImageBatch` storage and runtime batch APIs.
- Tauri batch folder/path commands and project hydration.
- Web engine bridge, Zustand graph store, timeline, viewer, and load-batch node UI.
- Focused Rust and frontend tests for iterator state and lazy batch behavior.

## Checklist

- [x] Commit current work as checkpoint.
- [x] Add lazy path-backed batch entries in Rust/runtime/Tauri.
- [x] Add media iterator registry and active transport state.
- [x] Update timeline to use active media iterator range.
- [x] Add viewer filmstrip with lazy processed thumbnails.
- [x] Add `LoadImageBatch` mini source filmstrip.
- [x] Add/update tests and run validation.
