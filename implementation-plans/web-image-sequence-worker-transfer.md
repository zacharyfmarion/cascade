# Web Image Sequence Worker Cache Fix

## Goal

Fix web image sequence loading so cached frame bytes can be reused across viewer renders without failing when the worker bridge transfers frame data, while keeping playback performant with worker-owned sequence files, prefetch, and byte-budgeted decoded frame caching.

## Approach

Keep image sequence file ownership in the worker when the worker engine is active. The worker registers selected `File` handles once, keeps a compressed-byte LRU cache, de-duplicates in-flight reads, and prepares frames directly before render.

For uploaded web frames, keep a byte-budgeted decoded cache inside `LoadImageSequence`. Desktop directory-backed sequences still use the node's existing count-based decoded frame cache when loading from disk.

## Affected Areas

- `apps/web/src/engine/workerEngine.ts`
- `apps/web/src/engine/engineWorker.ts`
- `apps/web/src/engine/transferableBytes.ts`
- `apps/web/src/engine/sequenceFrameManager.ts`
- `apps/web/src/__tests__/sequenceFrameManager.test.ts`
- `apps/web/src/store/graphStore/slices/sequenceVideoSlice.ts`
- `apps/web/src/store/graphStore/slices/renderSlice.ts`
- `crates/cascade-nodes-std/src/input.rs`

## Checklist

- [x] Confirm the sequence byte cache is the detached buffer source
- [x] Update worker sequence-frame loading to transfer an owned byte copy
- [x] Add regression coverage for cached frame reuse after transfer-style detachment
- [x] Run frontend validation
- [x] Replace prior decoded uploaded sequence frames to cap WASM playback memory
- [x] Add worker-owned sequence file registration and compressed-byte cache
- [x] Route current-frame prepare and non-blocking prefetch through worker APIs
- [x] Use byte-budgeted multi-frame decoded cache for uploaded frames
- [x] Add Rust and frontend cache/prefetch regression coverage
- [x] Run full Rust/frontend/WASM validation
