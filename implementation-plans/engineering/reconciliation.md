# Engineering Plans Reconciliation

This document analyzes the 15 implementation plans for engineering compatibility, identifies dependency ordering, shared type/interface conflicts, and proposes a recommended implementation sequence.

---

## 1. Dependency Graph (what must come before what)

### Hard Dependencies (blocking)

```
Phase 2.4 (GPU Texture Pooling) ──────────► Phase 6.3 (GPU Subgraph Batching)
                                              └── needs pooled texture acquire/release API

Phase 4.1 (EvalSession) ──────────────────► Phase 4.3 (ResourceStore)
                                              └── ResourceStore is a service in EvalSession's TypeMap

Phase 4.1 (EvalSession) ──────────────────► Phase 6.1 (Async Render Pipeline)
                                              └── EvalSession must be Clone+Send+Sync for background rendering

Phase 2.4 (GPU Texture Pooling) ──────────► Phase 6.2 (Tile-based Processing) [GPU tiles]
                                              └── tile-sized GPU textures need the pool

Phase 4.4 (CascadeError Taxonomy) ────────► Phase 5.1 (Rust Error Path Testing)
                                              └── tests cover new error variants; adding variants first avoids double-work
```

### Soft Dependencies (recommended ordering, not blocking)

```
Phase 4.1 (EvalSession) ← before ──────── Phase 4.5 (Format Propagation)
   └── format resolver needs access to project format via session services

Phase 4.2 (Value/Param Unification) ← before ── Phase 4.5 (Format Propagation)
   └── format propagation adds new typed getters; unification should establish the pattern first

Phase 3.4 (EngineBridge Split) ← before ── Phase 6.1 (Async Render Pipeline)
   └── async render changes the bridge contract; easier if bridge is already async-only

Phase 3.3 (Node Deletion Cleanup) ← before ── Phase 5.2 (Frontend Component Tests)
   └── component tests for deletion should test the cleaned-up behavior, not the buggy state

Phase 4.4 (CascadeError Taxonomy) ← before ── Phase 2.4 (GPU Texture Pooling)
   └── GPU pooling introduces new error variants; taxonomy should define them first

Phase 6.2 (Tile-based Processing) ← before ── Phase 6.3 (GPU Subgraph Batching) [tile-aware batching]
   └── batching can be tile-aware if tiling is available

Phase 6.2 (Tile-based Processing) ← before ── Phase 6.4 (Multi-channel/AOV)
   └── tile cache keys should reserve fields for channel/AOV identifiers
```

### Independent (can be done in any order)

- Phase 3.3 (Node Deletion Cleanup) — standalone frontend fix
- Phase 3.4 (EngineBridge Split) — standalone frontend refactor
- Phase 5.3 (CI Coverage + Benchmarks) — CI infrastructure, no code dependencies
- Phase 5.2 (Frontend Component Tests) — test infrastructure, independent of Rust changes

---

## 2. Shared Type/Interface Conflicts

### 2.1 `EvalContext` — Modified by 4 Plans

| Plan | Change to EvalContext |
|------|----------------------|
| 4.1 (EvalSession) | Replace feature-specific fields with `&Services` handle; add `services()` accessor |
| 4.2 (Value/Param Unification) | Add typed param getters (`param_f32()`, `param_curve_points()`, etc.) |
| 4.3 (ResourceStore) | Add `resources: NodeResourceAccessor` field |
| 4.5 (Format Propagation) | Uses services to access project format; no direct EvalContext field changes |

**Compatibility Assessment:** ✅ Compatible if done in order 4.1 → 4.2 → 4.3.
- 4.1 establishes the `Services` pattern and adds the services handle.
- 4.2 adds typed param getters (these read from `params` HashMap, not services — no conflict).
- 4.3 adds `resources` accessor which is just another service in the TypeMap.
- 4.5 reads from services — no structural changes needed.

**Risk:** If 4.2 and 4.3 are done in parallel, both add methods to `EvalContext` — merge conflicts are likely but mechanical (no semantic conflict).

### 2.2 `CascadeError` — Modified by 4 Plans

| Plan | New Variants |
|------|-------------|
| 4.4 (Error Taxonomy) | ~15 new variants: GPU (5), Format (2), Resource (2), Operation (3), IO (2), Validation (4) |
| 2.4 (GPU Texture Pooling) | `GpuMemoryExhausted`, `GpuTextureAllocationFailed`, `GpuReadbackFailed`, `GpuUploadFailed`, `GpuDeviceLost` |
| 4.1 (EvalSession) | `MissingService { service, node_id }` |
| 4.5 (Format Propagation) | `FormatMismatch { node_type, output, rule, expected, actual, ... }` |

**Compatibility Assessment:** ✅ Compatible — all add non-overlapping variants.
- Phase 4.4 should define the GPU variants first, then 2.4 uses them (avoids duplication).
- `MissingService` (4.1) and `FormatMismatch` (4.5) are unique to their plans.
- Phase 5.1 tests should run after all variants are defined.

**Recommendation:** Do 4.4 first to establish the taxonomy and stable error codes. Then 2.4, 4.1, and 4.5 reference those variants instead of each defining their own.

### 2.3 `NodeSpec` / `OutputSpec` — Modified by 3 Plans

| Plan | Change |
|------|--------|
| 4.5 (Format Propagation) | Adds `format_rule`, `data_window_rule` to `OutputSpec` |
| 6.2 (Tile-based Processing) | Adds `TilingSpec` (tiling kind + halo) to `NodeSpec` |
| 6.4 (Multi-channel/AOV) | Adds channel constraints to port specs |

**Compatibility Assessment:** ✅ Compatible — all add independent optional fields.
- No conflicts between format rules, tiling capabilities, and channel constraints.
- All are additive (optional fields with defaults for backward compatibility).

### 2.4 `Image` Struct — Modified by 3 Plans

| Plan | Change |
|------|--------|
| 4.5 (Format Propagation) | Ensures format/color_space are correctly preserved (no structural change) |
| 6.2 (Tile-based Processing) | Tiles use existing `Image` type with `data_window` encoding global rect |
| 6.4 (Multi-channel/AOV) | Adds `channels: ChannelSet`, changes `data` length to `w*h*channels.len()` |

**Compatibility Assessment:** ⚠️ Potential conflict between 6.2 and 6.4.
- 6.2 uses `Image.data_window` to encode tile global position — this must not conflict with 6.4's channel metadata.
- 6.4 changes the pixel stride from hardcoded 4 to `channels.len()` — this affects 6.2's tile operations which assume `par_chunks_exact_mut(4)`.

**Recommendation:** Implement 6.2 before 6.4. Tile code should be written to work with current RGBA (stride=4), and 6.4 should update tile operations to use dynamic stride when it lands. 6.2's `TileId` already reserves a field for channel/AOV identifiers.

### 2.5 `Value` Enum — Modified by 2 Plans

| Plan | Change |
|------|--------|
| 2.4 (GPU Texture Pooling) | Introduces `GpuImage` as an internal evaluator cached value type (not a `Value` variant) |
| 4.2 (Value/Param Unification) | Changes conversion behavior; keeps `Value` variants unchanged |

**Compatibility Assessment:** ✅ Compatible — 2.4's `GpuImage` is internal to the evaluator, not a new `Value` variant. 4.2 doesn't add new variants either.

### 2.6 Evaluator (`eval.rs`) — Modified by 5 Plans

| Plan | Change |
|------|--------|
| 4.1 (EvalSession) | Simplifies evaluate() signature; threads session through internals |
| 2.4 (GPU Texture Pooling) | Adds materialization logic (GpuImage ↔ Image) at evaluation boundaries |
| 4.5 (Format Propagation) | Adds validation step after node evaluation |
| 6.1 (Async Render) | Adds cancellation token checks at per-node boundaries |
| 6.2 (Tile-based Processing) | Adds tile decomposition, ROI propagation, tile-level caching |

**Compatibility Assessment:** ⚠️ High-touch area requiring careful ordering.
- All 5 plans modify the evaluator's evaluation loop. Changes are conceptually independent but touch the same code paths.
- 4.1 should go first (establishes the session pattern all others use).
- 2.4 and 4.5 add boundary logic (GPU materialization, format validation) — both add steps in the post-evaluation path.
- 6.1 and 6.2 are larger structural changes that should come after the core cleanup (4.x).

---

## 3. Frontend Consistency Check

### 3.1 EngineBridge Changes

| Plan | Bridge Impact |
|------|--------------|
| 3.4 (EngineBridge Split) | Major: splits into CoreBridge + DesktopBridge, async-only, capabilities system |
| 6.1 (Async Render) | Major: adds render job management, progress events, cancel API |
| 4.4 (Error Taxonomy) | Minor: new error codes flow through bridge; EngineError.code stays string |

**Recommendation:** Do 3.4 before 6.1. The async render pipeline needs a clean bridge contract to build on. The bridge split removes `Promise<T> | T` unions, which simplifies the render job API design.

### 3.2 Store Slices

| Plan | Store Impact |
|------|-------------|
| 3.3 (Node Deletion) | graphSlice: centralized cleanup helper; renderSlice/aiSlice: guards |
| 6.1 (Async Render) | renderSlice: job-based state management, progress, stale-safe results |
| 3.4 (EngineBridge) | All slices: migrate from optional method probing to capability checks |

**Recommendation:** Do 3.3 first (small, standalone fix), then 3.4 (bridge refactor), then 6.1 (builds on both).

### 3.3 Testing Infrastructure

| Plan | Test Infrastructure |
|------|-------------------|
| 5.1 (Rust Error Path Tests) | New Rust integration test files; exhaustive CascadeError coverage |
| 5.2 (Frontend Component Tests) | New jsdom test infrastructure; React Testing Library |
| 5.3 (CI Coverage + Benchmarks) | New CI jobs; cargo-llvm-cov; benchmark regression detection |

**Compatibility Assessment:** ✅ Fully independent. Can be done in parallel.
- 5.1 should follow 4.4 (tests need the new error variants to exist).
- 5.2 and 5.3 have no dependencies on other plans.

---

## 4. Error Handling Consistency

All plans that introduce new `CascadeError` variants must follow the same pattern established by Phase 4.4:
- Stable `UPPER_SNAKE_CASE` error codes
- `code()`, `domain()`, `severity()`, `user_message()` methods on each variant
- WASM bridge uses these methods instead of hardcoded match tables
- Tauri IPC serializes via `EngineErrorDto` (not `.to_string()`)

**Plans that add errors: 4.4, 2.4, 4.1, 4.3, 4.5, 6.2, 6.3, 6.4**

This is why 4.4 should land first — it establishes the infrastructure that all other plans depend on.

---

## 5. Recommended Implementation Ordering

### Wave 1: Foundations (no cross-dependencies)
Execute in parallel where possible.

| Priority | Plan | Effort | Rationale |
|----------|------|--------|-----------|
| 1a | **3.3 Node Deletion Cleanup** | Small (1d) | Standalone frontend fix; unblocks clean component tests |
| 1b | **4.4 CascadeError Taxonomy** | Medium (1-2d) | Establishes error infrastructure used by all subsequent plans |
| 1c | **5.3 CI Coverage + Benchmarks** | Medium (1-2d) | Infrastructure-only; enables measurement for all future work |
| 1d | **4.1 EvalSession** | Medium (1-2d) | Core architecture change; unblocks 4.2, 4.3, 4.5, 6.1 |

### Wave 2: Core Architecture (depends on Wave 1)

| Priority | Plan | Effort | Depends On |
|----------|------|--------|------------|
| 2a | **4.2 Value/Param Unification** | Medium (1-2d) | 4.1 (EvalSession) |
| 2b | **4.3 ResourceStore** | Medium (1-2d) | 4.1 (EvalSession) |
| 2c | **3.4 EngineBridge Split** | Medium (1-2d) | Independent, but benefits from 4.4 error codes |
| 2d | **2.4 GPU Texture Pooling** | Medium-Large (1-3d) | 4.4 (error variants) |

### Wave 3: Validation + Testing (depends on Wave 2)

| Priority | Plan | Effort | Depends On |
|----------|------|--------|------------|
| 3a | **4.5 Format Propagation** | Large (3d+) | 4.1, 4.2, 4.4 |
| 3b | **5.1 Rust Error Path Testing** | Medium (1-2d) | 4.4 (all variants defined) |
| 3c | **5.2 Frontend Component Tests** | Medium (1-2d) | 3.3 (clean deletion behavior) |

### Wave 4: Performance + Async (depends on Wave 2-3)

| Priority | Plan | Effort | Depends On |
|----------|------|--------|------------|
| 4a | **6.1 Async Render Pipeline** | Large (3d+) | 4.1, 3.4 |
| 4b | **6.2 Tile-based Processing** | Large (3d+) | 4.1, 2.4 (for GPU tiles) |

### Wave 5: Advanced GPU + Multi-channel (depends on Wave 4)

| Priority | Plan | Effort | Depends On |
|----------|------|--------|------------|
| 5a | **6.3 GPU Subgraph Batching** | Large (3d+) | 2.4 (GPU texture pooling) |
| 5b | **6.4 Multi-channel/AOV** | Large (3d+) | All Phase 4.x complete |

---

## 6. Cross-Cutting Concerns

### 6.1 EvalContext is the hottest interface
Five plans modify EvalContext. The recommended ordering (4.1 → 4.2 → 4.3 → 4.5) ensures each plan builds on the previous one's additions without conflicts.

### 6.2 GPU pipeline has a clear dependency chain
`GPU Texture Pooling (2.4)` → `Tile-based Processing (6.2, GPU path)` → `GPU Subgraph Batching (6.3)`. Each requires the previous step's infrastructure.

### 6.3 The evaluator is the most modified component
Plans 4.1, 2.4, 4.5, 6.1, and 6.2 all modify `eval.rs`. The recommended wave ordering spaces these out to avoid merge conflicts and ensure each change stabilizes before the next.

### 6.4 Error handling is a cross-cutting foundation
Phase 4.4's error code system and WASM/Tauri bridge changes must land before other plans add their own error variants, or each plan will implement ad-hoc error handling that must be retrofitted later.

### 6.5 Frontend and Rust changes are largely decoupled
Frontend plans (3.3, 3.4, 5.2) can proceed independently of Rust plans (4.x, 5.1, 6.x) with the exception of 6.1 (async render) which spans both.

---

## 7. Potential Conflicts Requiring Attention

### 7.1 Image struct changes (6.2 + 6.4)
If tile-based processing (6.2) and multi-channel (6.4) are developed close together, coordinate the `Image` struct changes:
- 6.2 should NOT hardcode stride=4 in tile operations; use `image.stride()` or similar.
- 6.4's `ChannelSet` changes will require updating 6.2's tile operations.

### 7.2 Evaluator cache key changes (multiple plans)
Plans 4.5 (format hash), 6.2 (tile index), and 6.4 (channel metadata) all add fields to cache keys. Ensure the cache key composition is additive and doesn't break existing invalidation semantics.

### 7.3 CascadeError variant count growth
After all plans, `CascadeError` will have ~35+ variants (currently 18). This is manageable but:
- Keep the exhaustive match in `code()` / `domain()` / `user_message()` well-organized by domain.
- Consider grouping variants into sub-enums if the match becomes unwieldy (future, not now).

### 7.4 GPU readback metadata preservation
Both 2.4 (GPU pooling) and 4.5 (format propagation) fix `read_texture_to_image()` to preserve metadata. Whichever lands first should establish the pattern; the second should build on it.

---

## 8. Summary

All 15 plans are **engineering-compatible** with the recommended wave ordering. The main coordination points are:

1. **Do 4.4 (Error Taxonomy) early** — it's the foundation for error handling in 8+ other plans.
2. **Do 4.1 (EvalSession) early** — it's the prerequisite for 4.2, 4.3, 4.5, and 6.1.
3. **Respect the GPU chain:** 2.4 → 6.2 → 6.3.
4. **Space out evaluator changes** across waves to avoid merge conflicts.
5. **Frontend plans are independent** and can run in parallel with Rust work.
6. **6.4 (Multi-channel/AOV) goes last** because it touches the most foundational type (`Image`) and benefits from all preceding infrastructure being stable.
