# Desktop AI Node Background Jobs

## Goal

Make desktop AI node execution match the web UX: clicking Run should immediately show a running state, keep the UI responsive, and complete asynchronously without blocking the Tauri main thread.

## Approach

- Treat native AI node execution as a small background job lifecycle.
- Prepare the node run while briefly holding the engine lock, then release the lock before slow provider/network work.
- Commit the result only if the node still exists and the completion belongs to the latest run for that node.
- Store the cache key from run start so results from older inputs correctly report as stale if params/inputs changed while generation was running.
- Have the frontend poll node execution state after starting a run, so desktop can return from `runAiNode` immediately while the UI remains in `running`.

## Affected Files

- `crates/cascade-runtime/src/lib.rs`
- `apps/tauri/src-tauri/src/lib.rs`
- `apps/web/src/store/graphStore/slices/aiSlice.ts`
- `apps/web/src/__tests__/graphStore.test.ts`
- `apps/web/src/engine/__tests__/tauriEngine.test.ts`

## Checklist

- [x] Add run IDs and prepared cache keys to native AI execution state.
- [x] Split native AI execution into prepare/evaluate/finish phases.
- [x] Start desktop AI runs in a background worker without holding the engine lock.
- [x] Poll AI execution state from the frontend until complete/error.
- [x] Add tests for non-blocking start, stale completion, and unsupported/error states.
- [x] Run focused and broad validation.
