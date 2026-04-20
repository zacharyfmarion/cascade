# Worker Viewer Serialization Fix

## Goal

Fix the web worker viewer path so image results always cross the Comlink boundary as serializable, transferable payloads instead of occasionally surfacing `"Unserializable return value"` in the viewer.

## Approach

Extract viewer-result decoding into a small shared frontend helper. Use that helper from both `WasmEngine` and the worker engine, and force the worker path to materialize a fresh `Uint8ClampedArray` before calling `Comlink.transfer(...)`.

## Affected Areas

- `apps/web/src/engine/engineWorker.ts`
- `apps/web/src/engine/wasmEngine.ts`
- `apps/web/src/engine/viewerResult.ts`
- `apps/web/src/__tests__/viewerResult.test.ts`

## Checklist

- [x] Add a shared viewer-result decoding helper with optional pixel-buffer copying
- [x] Update the worker render paths to normalize viewer results before Comlink transfer
- [x] Update the main-thread WASM engine to reuse the helper without adding an extra copy
- [x] Add focused frontend tests for pixel and scalar viewer results
- [x] Run frontend validation and summarize skipped checks
