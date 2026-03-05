# EXR Performance Optimization Plan

## Problem Statement

Loading a multi-layer OpenEXR file freezes the UI for ~30s on web (WASM) and ~3s on desktop (native Rust). The application is completely unresponsive during this time — no scrolling, no node interaction, no cancel. This is the single biggest UX blocker for production use with real Blender/Nuke render passes.

## Current Architecture

### Decode Pipeline (all main thread, synchronous)

```
1. File → ArrayBuffer → Uint8Array                            (~20ms)
2. Uint8Array copied into WASM linear memory                   (~50ms)
3. parse_exr_metadata() — headers only, no pixel decode        (~200ms WASM)
4. Viewer render triggers evaluator pull
5. evaluate() calls decode_exr_layer() PER LAYER               (★ BOTTLENECK)
6. decode_exr_layer: FULL FILE DECOMPRESS via exr crate        (~8-10s/layer WASM, ~1s/layer native)
7. Channel extraction: values_as_f32().collect() × 4 channels  (4 Vec allocations)
8. Pixel interleave loop (scalar, NOT parallelized)
9. f32→u8 + sRGB conversion                                    (~300ms)
10. Vec<u8> copied back to JS                                   (~100ms)
11. Canvas blit                                                  (~10-50ms)
```

### Root Causes (ranked by impact)

| # | Issue | Impact | Description |
|---|-------|--------|-------------|
| 1 | N× full-decode for N layers | **CRITICAL** | Each `decode_exr_layer()` call re-reads and decompresses the entire EXR file from scratch. A 3-layer EXR = 3× full decompress. This alone accounts for 2/3 of the total time. |
| 2 | Main-thread execution | **CRITICAL** | Zero Web Workers. WASM runs synchronously on main thread. React can't paint, node editor can't respond to input. Even 1s of blocking is unacceptable UX. |
| 3 | WASM decompression 6-10× slower | **HIGH** | `miniz_oxide`/`flate2` (ZIP) runs at ~30-50 MB/s in WASM vs ~300 MB/s native. No SIMD, indirect table lookups hurt. PIZ (Huffman + wavelet) similarly degraded. |
| 4 | Rayon disabled in WASM | **HIGH** | `wasm-bindgen-rayon` not configured. All `par_chunks` calls silently fall back to sequential. The PNG path's parallel sRGB→linear conversion has zero benefit in WASM. |
| 5 | Per-channel Vec allocation | **MEDIUM** | `values_as_f32().collect::<Vec<f32>>()` allocates a full-resolution Vec for each of R, G, B, A channels separately. 4 Vecs × 10MP = ~160MB transient allocations per layer. |
| 6 | Scalar pixel interleave | **MEDIUM** | The RGBA interleave loop is `for i in 0..pixel_count` — no Rayon, no SIMD. Unlike the PNG path which uses `par_chunks_exact_mut(4)`. |
| 7 | JS↔WASM boundary copies | **LOW** | ~4 data copies crossing the boundary (bytes in, pixels out). Addressable with Transferables in Worker architecture. |

### Relevant Code Locations

- `crates/cascade-core/src/exr.rs` — `parse_exr_metadata()`, `decode_exr_layer()`, `encode_multilayer_exr()`
- `crates/cascade-nodes-std/src/input.rs` — `LoadImage::set_image_data()`, `decode_exr_layer()` (node method), `evaluate()`
- `crates/cascade-wasm/src/lib.rs` — `load_image_data()`, `render_viewer()`
- `crates/cascade-runtime/src/lib.rs` — `load_image_data()` (native path)
- `apps/web/src/engine/wasmEngine.ts` — `loadImageData()`, `renderViewer()`
- `apps/web/src/store/graphStore/slices/assetsSlice.ts` — `loadImageFile()`

---

## Phase 1: Decode-Once Architecture

**Goal:** Eliminate redundant decompression. One file read → all layers extracted.
**Impact:** 30s → ~10s (web), 3s → ~1s (desktop)
**Effort:** ~1 day
**Risk:** Low — contained to `exr.rs` and `input.rs`

### Design

Replace per-layer `decode_exr_layer()` with a single-pass `decode_all_layers()` that decompresses the file once and extracts all requested layers in one traversal.

```rust
/// Decodes requested layers from an EXR file in a single decompress pass.
/// Returns a map of port_name → Image for each successfully decoded layer.
pub fn decode_all_layers(
    data: &[u8],
    metadata: &ExrMetadata,
    requested_ports: &[&str],  // only decode what's actually connected
) -> Result<HashMap<String, Image>, CascadeError>
```

### Implementation Steps

1. **New function `decode_all_layers` in `exr.rs`:**
   - Single call to `exr::read().all_channels().all_layers().from_buffered()`
   - Iterate the decoded layers once
   - For each requested port: extract channels, interleave to RGBA f32, build `Image`
   - Return `HashMap<String, Image>` with all requested layers

2. **Update `LoadImage` node in `input.rs`:**
   - Replace `decode_cache: RefCell<HashMap<String, Arc<Image>>>` with a bulk decode approach
   - On first `evaluate()` call: determine which output ports are connected (from `EvalContext`)
   - Call `decode_all_layers(bytes, metadata, &connected_ports)`
   - Cache ALL decoded layers at once in `decode_cache`
   - Subsequent evaluations hit cache

3. **Demand-driven decoding:**
   - Only decode layers whose output ports are actually connected to downstream nodes
   - If user connects a new layer port later, decode just that layer (single additional decode)
   - Track which layers have been decoded to avoid redundant work

4. **Memory management:**
   - A 4K f32 RGBA layer = ~133MB. Cap at reasonable number of cached layers.
   - For now: cache all decoded layers (they're already `Arc<Image>` so sharing is cheap)
   - Future: LRU eviction if memory pressure detected

### What Changes

| File | Change |
|------|--------|
| `crates/cascade-core/src/exr.rs` | Add `decode_all_layers()`. Keep `decode_exr_layer()` for single-layer fallback. |
| `crates/cascade-nodes-std/src/input.rs` | `evaluate()` uses bulk decode. Cache populated in one pass. |

### What Doesn't Change

- `parse_exr_metadata()` — still lazy, headers-only
- `set_image_data()` — still stores raw bytes + metadata, no pixel decode
- Frontend, WASM bridge, evaluator — no changes needed
- Node spec, dynamic ports — unaffected

### Verification

- Existing unit tests (`test_decode_named_layer_round_trip`, `test_decode_fixture_depth_layer`) still pass
- E2E tests (`exr.spec.ts`) still pass — all 6 tests
- `cargo bench` — add a benchmark for multi-layer decode to measure improvement
- Manual test with real Blender EXR files (the user's `WindmillRenders/`)

---

## Phase 2: Web Worker Engine Offloading

**Goal:** UI never freezes during EXR decode (or any engine operation).
**Impact:** Perceived responsiveness — loading spinner instead of freeze. Actual decode time unchanged.
**Effort:** ~2-3 days
**Risk:** Medium — architectural change to engine communication model

### Design

Move the **entire WASM engine** into a dedicated Web Worker. The main thread handles only React UI, node editor, and canvas blitting. All engine operations (load, evaluate, render) are async messages.

```
Main Thread                          Worker Thread
┌────────────────────┐              ┌──────────────────────┐
│ React + ReactFlow  │  postMessage │ WASM Engine           │
│ Zustand store      │◄────────────►│ (cascade-wasm.wasm)   │
│ Canvas rendering   │  Transferable│ Graph, Evaluator      │
│ UI event handling  │  ArrayBuffer │ EXR decode            │
│ Node specs (cache) │              │ Image processing      │
└────────────────────┘              │ Render pipeline       │
                                    └──────────────────────┘
```

### Why Whole Engine, Not Just Decode

- Decode-only-in-worker still leaves evaluation, color conversion, graph operations on main thread
- The existing `EngineScheduler` already serializes all engine ops — Worker is a natural boundary
- Avoids splitting the engine into "decode worker" + "everything else on main thread" which doubles complexity
- Single ownership model: engine state lives entirely in worker, no shared mutable state

### Implementation Steps

1. **Create `engineWorker.ts`:**
   - Instantiate WASM module in worker context
   - Message protocol: `{ id, method, args }` → `{ id, result | error }`
   - Use `Transferable` for `ArrayBuffer` payloads (zero-copy)

2. **Create `WorkerEngine` implementing `EngineBridge`:**
   - Every method sends a message to worker, returns Promise
   - Replaces `WasmEngine` as the default web engine
   - `WasmEngine` kept as fallback for environments without Worker support

3. **Handle node specs:**
   - Worker sends `NodeSpec` data on node creation / interface change
   - Main thread caches in `nodeSpecsById` (Zustand) — already exists
   - ReactFlow node components read from cache, not engine

4. **Handle render results:**
   - Worker evaluates viewer → produces `Uint8Array` pixel buffer
   - Transfer via `Transferable` (zero-copy) to main thread
   - Main thread blits to canvas

5. **Progress and cancellation:**
   - Worker posts progress messages during long operations
   - Main thread can send `cancel` message
   - UI shows loading indicator per-node

6. **Comlink (optional):**
   - Library that makes Worker calls look like `await engine.loadImageData(...)`
   - Auto-detects Transferable objects
   - Reduces boilerplate but adds dependency

### What Changes

| File | Change |
|------|--------|
| `apps/web/src/engine/engineWorker.ts` | **New** — Worker entry point, loads WASM |
| `apps/web/src/engine/workerEngine.ts` | **New** — `EngineBridge` impl via postMessage |
| `apps/web/src/engine/bridge.ts` | Add progress/cancel to interface |
| `apps/web/src/store/graphStore/slices/` | All engine calls become async-aware |
| `apps/web/src/components/` | Loading indicators for nodes during decode |

### Desktop (Tauri)

Tauri already runs the engine in a separate process via IPC. The desktop equivalent of this phase is to ensure `load_image_data` runs on a background thread (Tauri's `async_runtime::spawn`), not the main Tauri thread. This should be a small change.

### Verification

- All E2E tests pass (Playwright waits for async completion)
- Manual test: drag-and-drop large EXR → UI stays responsive, loading indicator shows
- No race conditions: Worker serializes operations naturally

---

## Phase 3: Decode Internals Optimization

**Goal:** Reduce per-layer decode time by eliminating unnecessary allocations and enabling parallelism.
**Impact:** ~20-30% speedup (10s → 7-8s web, 1s → 0.7s desktop)
**Effort:** ~0.5 day
**Risk:** Low — localized to `exr.rs`

### Implementation Steps

1. **Eliminate per-channel `collect()` allocations:**
   ```rust
   // BEFORE: 4 full Vec allocations per layer
   let r = get_channel_f32("R")?;  // allocates Vec<f32> of pixel_count
   let g = get_channel_f32("G")?;  // allocates Vec<f32> of pixel_count
   // ...
   for i in 0..pixel_count {
       data[i*4]   = r[i];
       data[i*4+1] = g[i];
       // ...
   }

   // AFTER: iterate channels directly, no intermediate Vecs
   // Use the exr crate's channel iterator API to avoid collect()
   ```

2. **Parallelize pixel interleave with Rayon:**
   ```rust
   // AFTER: parallel interleave (helps native now, WASM when rayon enabled)
   data.par_chunks_exact_mut(4).enumerate().for_each(|(i, pixel)| {
       pixel[0] = r_data[i];
       pixel[1] = g_data[i];
       pixel[2] = b_data[i];
       pixel[3] = a_data[i];
   });
   ```

3. **Pre-allocate output buffer:**
   - Reuse a buffer pool for `Vec<f32>` pixel data instead of allocating fresh per decode
   - Minor in single-decode architecture, significant if re-decoding on parameter changes

### Verification

- Unit tests pass with identical pixel values
- Add `criterion` benchmark: `decode_10mp_exr_layer` before/after

---

## Phase 4: WASM Multi-Threading (wasm-bindgen-rayon)

**Goal:** Enable real Rayon parallelism in WASM for 2-4× speedup on CPU-bound work.
**Impact:** 8s → 3-4s (web). No desktop impact (already has native threads).
**Effort:** ~2 days
**Risk:** Medium — build infrastructure changes, requires specific HTTP headers

### Prerequisites

- Phase 2 (Worker) should be done first — rayon threads are Web Workers under the hood
- Server must set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers
- These headers **restrict third-party embeds** (iframes, CDN resources) — product decision needed

### Implementation Steps

1. **Add `wasm-bindgen-rayon` to `cascade-wasm`:**
   ```toml
   [dependencies]
   wasm-bindgen-rayon = "1.2"
   ```

2. **Configure build for atomics:**
   ```bash
   RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals' \
   wasm-pack build --target web -- -Z build-std=panic_abort,std
   ```

3. **Initialize thread pool in WASM:**
   ```rust
   pub use wasm_bindgen_rayon::init_thread_pool;
   ```
   ```javascript
   await initThreadPool(navigator.hardwareConcurrency);
   ```

4. **Configure dev server headers:**
   ```javascript
   // vite.config.ts
   server: {
     headers: {
       'Cross-Origin-Opener-Policy': 'same-origin',
       'Cross-Origin-Embedder-Policy': 'require-corp',
     }
   }
   ```

5. **Feature-gate for graceful degradation:**
   - Detect `SharedArrayBuffer` availability at runtime
   - Fall back to single-threaded WASM if headers not present
   - `WorkerEngine` vs `WasmEngine` selection based on capability

### What Benefits

- All existing `par_chunks_exact_mut` calls (sRGB conversion, pixel ops) become truly parallel
- Potential parallel decompression if exr crate can decompress tiles/scanlines independently
- Future node processing (blur, blend, etc.) gets automatic speedup

### Verification

- Feature-gated: existing CI runs without atomics, new CI job with atomics
- Benchmark: `decode_10mp_exr_layer` with 1, 2, 4, 8 threads
- Manual test in Chrome with DevTools Performance tab

---

## Phase 5: Progressive Decode and Preview

**Goal:** Show partial results during decode so the user perceives near-instant feedback.
**Impact:** Perceived instant load for large files. Actual time unchanged but hidden.
**Effort:** ~3+ days
**Risk:** Medium-High — requires evaluator model changes

### Design Concepts

1. **Low-res preview first:**
   - EXR mipmap levels: decode smallest level first (~1ms), display immediately
   - Upgrade to full resolution in background
   - Requires `exr` crate's resolution level API

2. **Tile-by-tile progressive:**
   - Tiled EXR files support random-access tile decode
   - Decode visible tiles first, then fill in rest
   - Most Blender EXR files are scanline (not tiled) — limited applicability

3. **Scanline streaming:**
   - Decode N scanlines at a time, push partial image to viewer
   - Viewer shows growing image (top-down reveal)
   - Requires changes to evaluator cache model (partial results)

4. **Progress callback:**
   - `exr` crate supports progress callbacks during decode
   - Worker posts progress percentage to main thread
   - UI shows progress bar on the node

### Evaluator Model Changes

Currently the evaluator expects complete `Value::Image` outputs. Progressive decode requires:
- `Value::PartialImage { completed_rows, total_rows, data }` or similar
- Viewer node handles partial images (renders what's available)
- Re-evaluation triggered as more data arrives

This is a significant architectural change to the pull-based cache model.

### Recommendation

Start with **progress callback + loading indicator** (Phase 2's cancel/progress). This gives the user feedback without changing the evaluator model. Full progressive decode is a future milestone.

---

## Implementation Order

```
Phase 1 (Decode-Once)          ← DO FIRST. Biggest impact, lowest risk.
  ↓
Phase 3 (Optimize Internals)   ← Quick follow-up, same code area.
  ↓
Phase 2 (Web Worker)           ← UI responsiveness. Architectural.
  ↓
Phase 4 (wasm-bindgen-rayon)   ← Optional. Product decision on headers.
  ↓
Phase 5 (Progressive)          ← Future. After evaluator model matures.
```

### Expected Results After Phases 1-3

| Scenario | Before | After Phase 1 | After Phase 1+3 |
|----------|--------|---------------|-----------------|
| 1-layer EXR (web) | ~10s freeze | ~10s freeze | ~7-8s freeze |
| 3-layer EXR (web) | ~30s freeze | ~10s freeze | ~7-8s freeze |
| 1-layer EXR (desktop) | ~1s freeze | ~1s freeze | ~0.7s freeze |
| 3-layer EXR (desktop) | ~3s freeze | ~1s freeze | ~0.7s freeze |

### Expected Results After Phase 2 (Worker)

Same decode times but **UI stays responsive** — loading indicator instead of freeze.

### Expected Results After Phase 4 (Rayon WASM)

| Scenario | Phase 1+3 | + Phase 4 |
|----------|-----------|-----------|
| 1-layer EXR (web) | ~7-8s responsive | ~3-4s responsive |
| 3-layer EXR (web) | ~7-8s responsive | ~3-4s responsive |

---

## Non-Goals / Explicitly Rejected

- **OpenEXR C++ in WASM**: Same thread constraints, massive integration effort, marginal speed gain
- **GPU decompression**: ZIP/PIZ are inherently sequential algorithms, not GPU-parallelizable
- **Switching away from `exr` crate**: It's the standard Rust EXR library. The bottleneck is architecture, not the library.
- **Eager decode of all layers**: Memory-wasteful. A 4K f32 RGBA layer is ~133MB. Decode only what's connected.
