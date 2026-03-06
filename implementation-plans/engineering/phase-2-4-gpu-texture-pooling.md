# Phase 2.4 — GPU texture pooling (Cascade)

## Bottom line
Implement a `GpuTexturePool` inside `GpuContext` that reuses `wgpu::Texture`s keyed by `(width, height, format)` and introduce a GPU-resident intermediate value (`GpuImage`) so chains of GPU nodes can execute GPU→GPU without CPU readback until a CPU consumer requires it. Track pooled allocations against a configurable GPU budget and degrade predictably.

## Effort estimate
**Medium (1–2 days)** for pooling + GPU intermediates + evaluator materialization; **Large (3d+)** if also retrofitting all node/value plumbing and adding robust fallback policies.

---

## 1) Goal and scope
- **Texture pooling**: reuse GPU textures across kernel evaluations by allocating textures once per `(w,h,format)` and recycling them via a central pool in `GpuContext`.
- **GPU intermediates**: eliminate CPU readback between consecutive GPU nodes by letting the evaluator pass GPU-resident intermediates.
- **Not in scope (Phase 2.4):** cross-node command-buffer batching, shader fusion, graph-level scheduling (Phase 6.3+).

## 2) Pool design
- **Key:** `(width: u32, height: u32, format: wgpu::TextureFormat)`; start with `Rgba16Float`.
- **Lifecycle:** `acquire(key)` returns `PooledTexture` wrapper; on `Drop`, returns texture to pool's free list.
- **Max pool size / eviction:** Global cap `gpu_budget_bytes`; per-key cap (4–8); eviction drops oldest free textures first (global LRU).

## 3) GPU-to-GPU optimization
- GPU nodes output `GpuImage`; evaluator only materializes CPU `Image` when a CPU node (or final viewer output) requests it.
- **Evaluator changes:** internal cached representation supports `{ Cpu(Image), Gpu(GpuImage) }`; conversion functions for cpu_to_gpu and gpu_to_cpu.

## 4) GPU memory budget
- Track `allocated_bytes` and `free_bytes`. Budget enforcement on acquire: evict free textures until under budget; if still insufficient, fallback-or-error.
- Start with separate GPU budget; integrate with evaluator cache budget later.

## 5) UX considerations
- Evict free textures first; fall back to CPU materialization; hard failure only for truly unrecoverable cases.
- Expose debugging telemetry: pool hit rate, allocated bytes, evictions, readback count.

## 6) Edge cases
- **Format mismatches:** materialize to CPU and re-upload as fallback.
- **Device lost:** invalidate pool + cached pipelines; require GpuContext rebuild.
- **WASM vs native:** lower default budgets on WASM.
- **Concurrent evaluations:** pool is `Send + Sync`; budgets are global.

## 7) Error handling
New `CascadeError` variants: `GpuMemoryExhausted`, `GpuTextureAllocationFailed`, `GpuReadbackFailed`, `GpuUploadFailed`, `GpuDeviceLost`.

## 8) Performance measurement
- Counters: `texture_allocations_total`, `pool_hits/misses`, `readbacks_total`, `uploads_total`, `allocated_bytes_current`.
- Benchmarks: GPU chain (5-10 kernels), steady-state (pool warmup).

## 9) Integration with existing systems
- GPU-cached outputs participate in eviction using GPU byte accounting.
- Preview scaling naturally changes pool keys.
- Pipeline cache is independent.

## 10) Format/color space preservation
- Extend `read_texture_to_image()` to take metadata (color_space, format, domain) and construct CPU `Image` with same metadata.

## Step-by-step implementation checklist
- [ ] Add `GpuTextureKey`, `GpuImageDesc`, `GpuImage`, `PooledTexture` types in `cascade-gpu`.
- [ ] Implement `GpuTexturePool` with acquire/release, byte accounting, free-list eviction.
- [ ] Refactor kernel execution: accept `GpuImage` without upload; return `GpuImage`; optional clear output texture (debug).
- [ ] Add evaluator materialization: cache GPU values, materialize on CPU-node input.
- [ ] Add new `CascadeError` variants + `EngineError` mapping.
- [ ] Add metrics + logs for pool activity.
- [ ] Add benchmarks + tests: readbacks drop to 1 for GPU chains; allocations stabilize; budget enforcement works.

## Risks and mitigations
- **Value-plumbing complexity:** keep `GpuImage` internal; only extend evaluator + GPU nodes.
- **Visual corruption from reuse:** clear output textures in debug; test with partial-write kernels.
- **Budget heuristics vs VRAM:** treat as estimate; tune conservatively; rely on fallback paths.

## Dependency on Phase 6.3
**Build now:** pooling, `GpuImage` intermediate, evaluator boundary materialization, metrics/errors.
**Defer:** command-buffer batching, multi-format pooling, async overlap, GPU scheduling.
