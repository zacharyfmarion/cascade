# Phase 2: Web Worker Engine Offloading ✅ COMPLETE

## Status

**COMPLETE.** Implemented and shipped to main. Key implementation details:

- `engineWorker.ts` — Worker entry point with WASM engine + `EngineScheduler` (FIFO + `enqueueLive` latest-wins)
- `workerEngine.ts` — Main-thread Comlink proxy implementing `EngineBridge`
- `paramController.ts` — Fire-and-coalesce live render scheduling (at most 1 render in-flight)
- `nodeDraftStore.ts` — Per-node draft stores for zero-re-render slider drags
- Param-delta undo snapshots (synchronous, no `exportGraph` blocking Worker queue)
- Sync ops (`typesCompatible`, `needsMigration`, `migrateDocument`) stay on main thread
- `?noworker=true` fallback to `WasmEngine` for debugging
- `setAndRender` atomic Worker operation for live preview (~5fps during drags)

## Goal
Move the entire WASM engine into a Web Worker so the UI never freezes during EXR decode, graph evaluation, or rendering. Loading spinner instead of freeze.

## Architecture

```
Main Thread                          Worker Thread
┌────────────────────┐               ┌────────────────────┐
│ React + Zustand    │               │ WASM Engine        │
│ WorkerEngine       │◄─ postMsg ──►│ engineWorker.ts    │
│  (EngineBridge)    │  Transferable │  EngineScheduler   │
│ Canvas blitting    │   ArrayBufs   │  Comlink.expose()  │
└────────────────────┘               └────────────────────┘
```

- **Comlink** (~1.2kB gzip) wraps the 80+ method EngineBridge interface automatically
- **Transferable ArrayBuffers** for zero-copy pixel data in renderViewer/exportImage
- **WasmEngine kept as fallback** for environments without Worker support
- **Worker is default ON**, with `?noworker=true` URL param to disable
- **Migration functions** (`needsMigration`, `migrateDocument`) stay on main thread (fast blocking JSON ops)

## Critical Risks & Mitigations

### 1. Un-awaited Fire-and-Forget Calls (5 sites)
**Sites:** graphSlice.ts setParam/setPosition, liveParamsSlice.ts setParam/setInputDefault, batchExportSlice.ts exportImage

**Analysis:** These are intentionally fire-and-forget for responsiveness (slider dragging, position updates). With Worker, the EngineScheduler in the Worker still serializes ops, so ordering is preserved. Floating promises are safe because renderViewer also queues through the same Worker, naturally ordering after setParam.

**Decision:** Leave as-is — they're correct fire-and-forget patterns.

### 2. web_sys::window() in WASM (ai_provider.rs)
Lines 228, 252 use `web_sys::window()` which doesn't exist in Workers.

**Fix:** Replace with Worker-compatible fetch approach before Worker migration.

### 3. OffscreenCanvas document.createElement Fallback
`kernel.ts` `createScalingCanvas()` has `document.createElement('canvas')` fallback — not Worker-compatible.

**Decision:** Downscaling stays on main thread (display concern). WorkerEngine receives full-res pixels, main thread downscales. No change needed.

### 4. Document Import/Export with Base64
Large strings through postMessage. Structured clone handles strings efficiently. One-time operation — not a bottleneck.

### 5. GPU Init (WebGPU in Worker)
Feature-detect `navigator.gpu` in Worker. If unavailable, skip GPU (CPU-only). Already handled gracefully in existing code.

### 6. Worker Crash Recovery
If WASM panics or Worker hits OOM, all pending promises reject, engine state is lost.

**Solution:** WorkerEngine implements restart:
1. Detect Worker `error`/`messageerror` events
2. Re-create Worker, re-init WASM
3. Re-load document from last undo snapshot
4. Reject all in-flight promises with EngineError
5. Max 3 retries before surfacing fatal error

### 7. Initial Load Latency
Worker startup + WASM init adds latency.

**Solution:** Start Worker eagerly on page load (parallel with React mount). Show loading UI until Worker signals ready.

### 8. Race Conditions
Rapid slider → multiple setParam+render pairs queued → stale responses. Already handled by render generation counter in renderSlice.ts. No new race introduced.

## Implementation Steps

### Step 1: Fix Rust Prerequisites
- Fix `web_sys::window()` in `ai_provider.rs` → Worker-compatible fetch

### Step 2: Build Worker Infrastructure
- Add Comlink dependency
- Create `engineWorker.ts` — Worker entry, WASM init, Comlink.expose()
- Create `workerEngine.ts` — EngineBridge impl via Comlink.wrap()

### Step 3: Wire Up with Graceful Degradation
- Update `createEngine()` in kernel.ts: Worker default ON, `?noworker=true` to disable, Tauri path unchanged
- Pixel data Transfer in renderViewer/exportImage
- Error handling + restart logic

### Step 4: Testing & Verification
- All existing E2E tests pass with Worker
- All existing Rust tests pass
- Manual: large EXR → UI stays responsive
- Test Worker crash + recovery
- Test `?noworker=true` fallback

## Files to Create/Modify

| File | Change |
|------|--------|
| `apps/web/src/engine/workerEngine.ts` | **NEW** — EngineBridge via Comlink |
| `apps/web/src/engine/engineWorker.ts` | **NEW** — Worker entry point |
| `apps/web/src/store/graphStore/kernel.ts` | Modify createEngine() branching |
| `crates/cascade-wasm/src/ai_provider.rs` | Fix web_sys::window() for Worker compat |
| `apps/web/package.json` | Add comlink dependency |

## Test Strategy

| Test Type | What | How |
|-----------|------|-----|
| Unit | WorkerEngine message protocol | Mock Worker, verify message shapes |
| Unit | Transferable detection | Verify ArrayBuffers are Transferred not cloned |
| Integration | Full engine lifecycle via Worker | Init → addNode → setParam → render → export |
| E2E | Existing Playwright tests | Must all pass with Worker enabled |
| E2E | UI responsiveness during EXR load | Load large EXR, measure main-thread jank |
| Manual | Slider dragging smoothness | Drag param slider while EXR is loading |
| Edge | Worker crash recovery | Kill Worker mid-render, verify recovery |
| Edge | No Worker support | Verify WasmEngine fallback works (`?noworker=true`) |

## Performance Expectations
- EXR load: UI thread stays at 60fps (currently freezes for 3-30s)
- Render: same latency (Worker overhead ~1-2ms per postMessage round-trip)
- Initial load: +200-500ms for Worker startup (masked by existing loading screen)
- Memory: ~2x WASM memory (separate Worker heap) — acceptable tradeoff
