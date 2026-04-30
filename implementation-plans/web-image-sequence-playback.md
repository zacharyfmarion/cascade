# Web Image Sequence Playback

## Goal

Make image sequence playback advance frames reliably in both web/WASM and desktop/Tauri when a sequence is connected to a viewer.

## Approach

- Trace how timeline frame changes render viewers on web versus desktop.
- Ensure web renders upload the requested browser `File` frame data before evaluating the viewer.
- Mark sequence nodes dirty when sequence data changes so evaluator caches cannot reuse stale outputs.
- Add focused frontend coverage for web frame upload during playback/timeline renders.
- Run targeted frontend and Rust validation for the touched areas.

## Affected Areas

- `apps/web/src/store/graphStore/slices/renderSlice.ts`
- `apps/web/src/store/graphStore/slices/sequenceVideoSlice.ts`
- `apps/web/src/__tests__/engineMock.ts`
- `apps/web/src/__tests__/graphStore.contracts.test.ts`
- `crates/cascade-wasm/src/lib.rs`
- `crates/cascade-runtime/src/lib.rs`

## Checklist

- [x] Inspect playback, sequence loading, and render paths.
- [x] Implement web frame upload before all viewer renders.
- [x] Mark sequence graph data dirty when backend sequence state changes.
- [x] Add or update tests for sequence frame upload during playback.
- [x] Run validation.
