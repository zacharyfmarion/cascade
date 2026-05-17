# Engineering Roadmap

Prioritized plan for strengthening Cascade's engineering foundations. Runs alongside the [Product Roadmap](./PRODUCT_ROADMAP.md) — these items make feature work safer, faster, and more sustainable.

Based on the [architecture review of Feb 22 2026](../reviews/architecture-review-2-22-26.md).

**Last updated:** 2026-05-17

---

## Guiding Principles

1. **Safety before features.** Panics in library code and unbounded allocations are live bugs. Fix them first.
2. **Measure before optimizing.** Add benchmarks and profiling before rewriting hot paths.
3. **Incremental over big-bang.** Each item should be landable independently without blocking feature work.
4. **Don't let core rot.** `cascade-core` stays focused on graph/eval mechanics. Cross-cutting concerns (AI, OCIO) live in higher layers.

---

## Phase 1: Safety & Correctness ✅ (Complete)

Items that prevent crashes, data loss, or silent corruption.

### 1.1 Remove panics from library code ✅
- [x] Replace `assert_eq!` in `Image::from_f32_data()`, `Image::from_f32_data_with_space()`, and `Image::new_with_domain()` (types.rs) with `Result<Image, CascadeError>` returns
- [x] Add new `CascadeError::InvalidImageData` and `ImageTooLarge` variants for dimension/data length mismatches
- [x] Propagate `Result` through all call sites across cascade-core, cascade-gpu, cascade-nodes-std, and cascade-runtime
- [ ] Replace `panic!("Expected Value::...")` patterns in node test helpers with typed assertions

### 1.2 Add image dimension limits ✅
- [x] Define `const MAX_IMAGE_DIM: u32 = 16384` in `cascade-core`
- [x] Validate dimensions in `Image` constructors, `LoadImage` decode path, GPU `read_texture_to_image()`, and AI `decode_response_image()` boundary
- [x] Add overflow checks before `Vec::with_capacity((width * height * 4) as usize)` in `kernel_node.rs` and `kuwahara.rs`
- [x] Return `CascadeError::ImageTooLarge` instead of OOM-crashing

### 1.3 Fix WASM bridge + full-stack error handling ✅

See the [error handling plan](../reviews/error-handling-plan.md) for the comprehensive strategy.

**Phase A — MVP (stop swallowing errors): ✅**
- [x] Replace all 7 `unwrap_or(JsValue::NULL)` in `cascade-wasm/src/lib.rs` with `.map_err(to_engine_error)?`
- [x] Replace 2 `.expect()` panics in WASM bridge with `.map_err(to_engine_error)?`
- [x] Add `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` to cascade-wasm crate
- [x] Remove error-swallowing try-catch in `WasmEngine.renderViewer()` — let errors propagate
- [x] Wire render errors to `lastError` in graphStore so they appear in the Viewer error bar

**Phase B — Structured errors: ✅**
- [x] Define `EngineError` TypeScript type (code, message, severity, domain, scope)
- [x] Define `EngineErrorDto` serde struct in Rust for structured JS error serialization
- [x] Update `EngineBridge` interface: `renderViewer()` returns `Promise<RenderResult>` (no `| null`)
- [x] Add `parseEngineError()` utility to normalize WASM/Tauri errors into `EngineError`

**Phase C — Per-node error attribution: ✅**
- [x] Add `EvalError` wrapper in evaluator that captures `(node_id, node_type, source: CascadeError)`
- [x] Add `nodeErrors: Record<NodeId, EngineError>` to store
- [x] Add error badge to `BaseNode` component for nodes with errors
- [x] Show "Blocked by upstream" derived state on downstream nodes

**Phase D — Enforcement: ✅**
- [x] Add ESLint rule `no-empty` with `allowEmptyCatch: false`
- [x] Add CI grep checks for `unwrap_or(JsValue::NULL)` and empty catch blocks

### 1.4 Fix muted node pass-through bug (deferred — low impact)
- [ ] `eval.rs:155-156`: When a node has multiple inputs of the same type, muting currently picks the first match silently. Add `NodeSpec` metadata for "pass-through input" or error when ambiguous

---

## Phase 2: Performance Foundations ✅ (Complete)

Items that prevent the app from degrading under real workloads.

### 2.1 Evaluator cache eviction ✅
- [x] Track approximate byte size per cached `Value::Image` via `estimate_bytes()` on `Value`
- [x] Implement LRU eviction in the evaluator cache, capped by total byte budget (512MB default, configurable via `set_budget()`)
- [x] Evict on every evaluation pass via `evict_if_needed()`, with `EvalScope` to defer eviction during multi-viewer evaluation
- [x] Add cache hit/miss/eviction metrics (`CacheMetrics` struct with `hit_count`, `miss_count`, `eviction_count`, `total_bytes`, `entry_count`)
- [ ] Expose cache metrics to frontend (currently internal to Rust evaluator only)

### 2.2 Selective viewer invalidation ✅
- [x] Add `get_affected_viewers(node_id)` to Graph struct — filters `get_downstream()` for viewer/output node types
- [x] Expose via WASM bridge, replace 13 single-node mutation call sites with selective invalidation
- [x] Keep `triggerAllViewers()` for bulk operations (undo/redo, frame changes, graph import, group navigation)
- [x] 7 unit tests covering linear chain, diamond graph, disconnected subgraphs, etc.

### 2.3 Evaluator upstream hash optimization ✅
Cache-key-chaining design already handles this efficiently — O(inputs) per node, not O(n²).

### 2.4 GPU texture pooling
- [ ] Pool GPU textures by (width, height, format) instead of allocating per-evaluation
- [ ] Detect consecutive GPU nodes in evaluation order and keep intermediate textures on GPU (skip CPU readback/re-upload)
- [ ] Add GPU memory budget tracking in `GpuContext`

> **Note:** With 35+ GPU kernel nodes now shipping (as of the GPU/CPU unification), texture pooling is increasingly important for real-world pipelines chaining multiple GPU nodes. Prioritize if profiling shows GPU alloc overhead.

---

## Phase 3: Frontend Architecture ✅ (Complete)

### 3.1 Split the monolithic store ✅
Broke `graphStore.ts` into 15 focused Zustand slices composed via `StateCreator` spread. ESLint `max-lines` rule (300 lines) on `store.ts` prevents regression, while `kernel.ts` owns shared runtime state.

### 3.2 Fix live parameter race conditions ✅
- [x] Await `exportGraph()` in `setParamLive()` before storing the snapshot
- [x] Add gesture lock to prevent overlapping `setParamLive`/`setParamCommit` sequences
- [x] Ensure `liveRenderGeneration` properly discards stale renders without race windows
- [x] Serialize undo/redo operations and await live param snapshots before commit
- [x] Fix color picker and color ramp input lag during drag

### 3.3 Clean up state on node deletion
- [ ] When removing a node, also delete entries from `renderResults`, `nodeTimings`, `aiNodeStatuses`, `aiNodeStale`
- [ ] Add a `cleanupNodeState(nodeId)` helper called from all deletion paths (delete, undo, clear)

### 3.4 Improve EngineBridge abstraction
- [ ] Audit optional methods — split into `CoreBridge` (required, non-optional) and `DesktopBridge extends CoreBridge` (desktop-only features)
- [ ] Remove `Promise<T> | T` union return types — make all methods async (`Promise<T>`)
- [ ] Remove scattered `if (eng.loadSequenceFrameData)` feature checks — use capability queries or bridge-level feature flags

---

## Phase 4: Rust Architecture Improvements (4–6 weeks)

Larger refactors that improve the long-term health of the Rust core. Each item is independently landable.

### 4.1 Introduce EvalSession
- [ ] Create `EvalSession` struct bundling: registry, color_management, ai_provider, project_format, caches
- [ ] Replace evaluator's 10-parameter signature with `(graph, session, viewer_node_id, output_port, frame_time)`
- [ ] Make `EvalContext` extensible via `TypeMap` pattern (type-keyed service locator) so new services (AI, OCIO) don't add fields to a shared struct

### 4.2 Unify Value / ParamValue / ParamDefault
- [ ] Design a single typed parameter schema (e.g., `ParamSchema<T>` with default, or a `ParamType` enum with explicit conversion traits)
- [ ] Eliminate silent `Value::None` returns in `param_value_to_value()` and `param_default_to_value()` — make unhandled types a compile-time or explicit runtime error
- [ ] Keep f64 precision in UI params, make conversion to f32 runtime values explicit and documented

### 4.3 Introduce ResourceStore (eliminate `as_any_mut()` downcasting)
- [ ] Create engine-owned `ResourceStore` keyed by `(NodeId, resource_key)` for mutable resources (loaded images, AI outputs)
- [ ] Add `ctx.resources` to `EvalContext` so nodes access resources via typed API instead of self-mutation
- [ ] Remove `as_any()` and `as_any_mut()` from the Node trait
- [ ] Migrate `LoadImage` image data, `GroupNode` internal state, and AI cached outputs to ResourceStore

### 4.4 Expand CascadeError taxonomy
- [ ] Add variants: `GpuDeviceLost`, `GpuShaderCompilation`, `FormatMismatch`, `UnsupportedOperation`, `ResourceNotFound`
- [ ] Replace uses of `CascadeError::Other(String)` with specific variants where possible
- [ ] Ensure errors round-trip across WASM/IPC with stable error codes

### 4.5 Format propagation validation
- [ ] Require nodes to declare output Format rules in `NodeSpec` (e.g., "inherits input A", "uses project format", "custom")
- [ ] Validate format consistency at evaluation boundaries — mismatches become `CascadeError::FormatMismatch`
- [ ] Auto-rasterization of Field→Image should respect declared format rules, not silently pick a fallback

---

## Phase 5: Testing & CI

Items that can be done incrementally alongside any other phase.

### 5.1 Rust error path testing
- [ ] Add integration tests for error scenarios: missing inputs, type mismatches, cycle detection, invalid connections, oversized images
- [ ] Add evaluator tests that exercise cache invalidation, dirty propagation, and muted node pass-through
- [ ] Target: every `CascadeError` variant has at least one test that triggers it

### 5.2 Frontend component tests
- [ ] Set up vitest + React Testing Library for component tests
- [ ] Add tests for critical components: `NodeCanvas` (node creation, connection, deletion), `BaseNode` (param rendering), `CurvesNode` (curve editing)
- [ ] Add tests for store interactions: undo/redo round-trips, live parameter gestures, node deletion cleanup

### 5.3 CI pipeline improvements ✅ (Partially complete)
- [x] Add frontend typecheck + lint as blocking CI steps
- [x] Add Stylelint CSS linting to CI
- [x] Add unit tests to CI (Rust `cargo test --workspace`)
- [ ] Add code coverage reporting (e.g., `cargo-tarpaulin` or `cargo-llvm-cov`) with minimum threshold
- [ ] Add benchmark regression detection: run Criterion benchmarks in CI, fail on >10% regression
- [ ] Consider adding a GPU CI runner or at minimum ensuring GPU test skip-detection works reliably

### 5.4 E2E tests ✅
- [x] Playwright E2E tests for core workflows: load image → add nodes → connect → verify render output
- [x] Test undo/redo, save/load round-trip, node deletion, parameter editing
- [x] Group, playback, project save/load, and export E2E specs
- [x] Run in CI on every PR

---

## Phase 6: Scale Preparation (future, as needed)

These become necessary when hitting the [escalation triggers](../reviews/architecture-review-2-22-26.md#escalation-triggers) identified in the architecture review. Don't start until one of those triggers fires.

### 6.1 Background thread rendering ✅ (Partially complete)
- [x] Move WASM evaluation to Web Worker with dedicated engine instance
- [x] Live viewer updates during slider drags via Worker engine with RAF coalescing
- [x] Engine-side preview scaling — downscale images during live drags for interactive response (configurable `livePreviewScale`, default 0.3)
- [x] WASM multi-threading via `wasm-bindgen-rayon` — all `par_chunks_exact_mut(4)` calls (42+ sites) parallelize in-browser automatically
- [ ] Full async render pipeline — non-blocking renders for all evaluation (not just live params), with cancel support
- [ ] Native (Tauri) background thread rendering

### 6.2 Tile-based processing
- [ ] **Prerequisite:** cache eviction (Phase 2.1) must be solid first ✅
- [ ] Design tile decomposition for nodes that support it (per-pixel ops, convolutions with known kernel radius)
- [ ] Keep tile size cache-friendly (e.g., 256×256)
- [ ] Nodes that can't tile (global ops like histogram equalization) process full buffers as today

### 6.3 GPU subgraph batching
- [ ] Detect contiguous runs of GPU nodes in the evaluation graph
- [ ] Fuse them into a single GPU execution pass: upload once → chain compute dispatches → readback once
- [ ] Requires GPU texture pooling (Phase 2.4) as prerequisite

### 6.4 Multi-channel / AOV system
- [ ] Extend `Value::Image` beyond fixed RGBA to support named channels (depth, motion vectors, normals, cryptomatte)
- [ ] Requires rethinking `Image` struct, node port types, and UI rendering
- [ ] Blocks CG integration workflows

---

## Recently Completed (last 2 weeks, not in original phases)

Major engineering work completed that was either unplanned or cut across multiple phases:

### GPU/CPU Node Unification ✅
- [x] Added 35 GPU kernel nodes for per-pixel color, blend, matte, transform, and utility operations
- [x] Removed CPU nodes replaced by GPU equivalents, keeping CPU only where GPU can't do the job
- [x] Renamed GPU kernel display names, categories, and ports for consistency
- [x] Updated DSL namespace and frontend for unified node IDs
- [x] Added v1.1.0→v1.2.0 migration for CPU/GPU node unification (old project files auto-migrate)
- [x] Updated all E2E, integration, and runtime tests for unified node IDs

### System-Level Mask Support for GPU Kernels ✅
- [x] Added mask input to GPU kernel infrastructure — any GPU node can now accept a mask
- [x] Removed `Value::Mask` variant — unified Image↔Mask type compatibility
- [x] Added KeyMix compositing node with mask-driven A/B mixing
- [x] Added mask input to CPU Color Ramp node

### EXR Multi-Layer Support ✅
- [x] Added EXR metadata parsing and core types
- [x] Integrated EXR support into LoadImage with dynamic outputs and lazy decode
- [x] Added EXR support to LoadImageSequence with dynamic outputs
- [x] Added SpecProvider trait for instance-aware port validation
- [x] Added dynamic port plumbing for EXR multi-layer support
- [x] Added SaveExr node, EXR encoder, and bytes export pipeline
- [x] Optimized EXR decode to single-pass (all layers decoded together instead of per-layer decompress)
- [x] Instance-aware specs for dynamic port connections and evaluation

### Viewer Enhancements ✅
- [x] Channel isolation (view R/G/B/A individually)
- [x] Pixel inspector (hover to see pixel values)
- [x] Gain/gamma display controls
- [x] Responsive toolbar with 520px breakpoint

### Time Manipulation Nodes ✅
- [x] TimeOffset, FrameHold, FrameBlend nodes

### AI GPU Script Tools ✅
- [x] Added `create_gpu_script` and `get_gpu_script_manifest` AI tools — AI can now create and inspect GPU Script nodes programmatically

### Node Group Hardening ✅
- [x] Panic safety, cycle detection, atomic updates, and param preservation

### Infrastructure ✅
- [x] Toast notification system
- [x] Stylelint CSS linting with CI integration
- [x] Unit tests added to CI
- [x] Rename Compositor → Cascade across entire codebase

---

## Current Priority Stack

Based on the state of the codebase as of 2026-03-06, here's the recommended priority order for remaining engineering work:

### High Priority (do next)
1. **Node deletion state cleanup** (Phase 3.3) — Simple, prevents memory leaks and stale state. Low effort, high value.
2. **GPU texture pooling** (Phase 2.4) — With 35+ GPU nodes and mask support, real pipelines now chain multiple GPU ops. Profile first, but likely a significant win.
3. **Full async render pipeline** (Phase 6.1 remainder) — Live param rendering works via Worker, but non-live renders still block. Completing this makes the app feel professional.

### Medium Priority (next quarter)
4. **EngineBridge abstraction split** (Phase 3.4) — Prerequisite for clean batch/headless rendering (Product Roadmap Phase 2.4).
5. **EvalSession introduction** (Phase 4.1) — Evaluator's parameter signature is already unwieldy and will get worse with new features.
6. **Rust error path testing** (Phase 5.1) — Good coverage of happy paths, but error paths are under-tested.
7. **Frontend component tests** (Phase 5.2) — No component tests exist yet; store contract tests help but aren't sufficient.
8. **CI coverage + benchmark regression** (Phase 5.3 remainder) — Important for preventing regressions as the codebase grows.

### Lower Priority (when needed)
9. **Value/ParamValue/ParamDefault unification** (Phase 4.2) — Technical debt that's annoying but not blocking features.
10. **ResourceStore** (Phase 4.3) — Blocks clean implementation of new stateful nodes, but the workaround (`as_any_mut`) is functional.
11. **CascadeError taxonomy expansion** (Phase 4.4) — Nice to have; `Other(String)` works for now.
12. **Format propagation validation** (Phase 4.5) — Becomes important when OCIO/color-managed workflows mature.
13. **Tile-based processing** (Phase 6.2) — Only needed at very large image sizes.
14. **GPU subgraph batching** (Phase 6.3) — Requires texture pooling first; profile before building.
15. **Multi-channel/AOV system** (Phase 6.4) — Blocked until EXR workflows reveal whether fixed-RGBA is actually limiting users.

---

## Cross-Cutting: Things to Never Do

These are engineering guardrails that apply at all times, regardless of what phase we're in.

- **No `as any`, `@ts-ignore`, `@ts-expect-error`** in TypeScript
- **No `.unwrap()` or `panic!()` in Rust library code** (test code is fine)
- **No new fields on `EvalContext`** without first considering `EvalSession` / `TypeMap`
- **No new `as_any()` downcast sites** — use `ResourceStore` or a trait instead
- **No hardcoded colors** in frontend components (enforced by ESLint rule)
- **No tile processing before cache eviction** — tiles without eviction leak in smaller chunks
- **Don't let `cascade-core` absorb more integrations** — keep it focused on graph/eval mechanics
- **No empty catch blocks** in frontend code — every catch must log, set error state, or re-throw
- **No `unwrap_or(JsValue::NULL)`** in WASM bridge code — errors must propagate to JS
- **No returning `null` to signal errors** from EngineBridge methods — throw `EngineError` instead
- **No adding logic directly to `store.ts`** — it's a composition shell; new actions go in slice files (enforced by ESLint `max-lines` rule)
