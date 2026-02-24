# Engineering Roadmap

Prioritized plan for strengthening the compositor's engineering foundations. Runs alongside the [Product Roadmap](./PRODUCT_ROADMAP.md) — these items make feature work safer, faster, and more sustainable.

Based on the [architecture review of Feb 22 2026](./reviews/architecture-review-2-22-26.md).

---

## Guiding Principles

1. **Safety before features.** Panics in library code and unbounded allocations are live bugs. Fix them first.
2. **Measure before optimizing.** Add benchmarks and profiling before rewriting hot paths.
3. **Incremental over big-bang.** Each item should be landable independently without blocking feature work.
4. **Don't let core rot.** `compositor-core` stays focused on graph/eval mechanics. Cross-cutting concerns (AI, OCIO) live in higher layers.

---

## Phase 1: Safety & Correctness (1–2 weeks)

Items that prevent crashes, data loss, or silent corruption. These should be done before any new feature work.

### 1.1 Remove panics from library code ✅
- [x] Replace `assert_eq!` in `Image::from_f32_data()`, `Image::from_f32_data_with_space()`, and `Image::new_with_domain()` (types.rs) with `Result<Image, CompositorError>` returns
- [x] Add new `CompositorError::InvalidImageData` and `ImageTooLarge` variants for dimension/data length mismatches
- [x] Propagate `Result` through all call sites across compositor-core, compositor-gpu, compositor-nodes-std, and compositor-runtime
- [ ] Replace `panic!("Expected Value::...")` patterns in node test helpers with typed assertions

### 1.2 Add image dimension limits
- [ ] Define `const MAX_IMAGE_DIM: u32 = 16384` in `compositor-core`
- [ ] Validate dimensions in `Image` constructors, `LoadImage` decode path, GPU `upload_image()`, and WASM `load_image_data()` boundary
- [ ] Add overflow checks before `Vec::with_capacity((width * height * 4) as usize)` in `kernel_node.rs` and `kuwahara.rs`
- [ ] Return `CompositorError::ImageTooLarge` (new variant) instead of OOM-crashing

### 1.3 Fix WASM bridge + full-stack error handling

See the [error handling plan](./reviews/error-handling-plan.md) for the comprehensive strategy.

**Phase A — MVP (stop swallowing errors):**
- [ ] Replace all 7 `unwrap_or(JsValue::NULL)` in `compositor-wasm/src/lib.rs` with `.map_err(to_engine_error)?`
- [ ] Replace 2 `.expect()` panics in WASM bridge with `.map_err(to_engine_error)?`
- [ ] Add `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` to compositor-wasm crate
- [ ] Remove error-swallowing try-catch in `WasmEngine.renderViewer()` — let errors propagate
- [ ] Wire render errors to `lastError` in graphStore so they appear in the Viewer error bar

**Phase B — Structured errors:**
- [ ] Define `EngineError` TypeScript type (code, message, severity, domain, scope)
- [ ] Define `EngineErrorDto` serde struct in Rust for structured JS error serialization
- [ ] Update `EngineBridge` interface: `renderViewer()` returns `Promise<RenderResult>` (no `| null`)
- [ ] Add `parseEngineError()` utility to normalize WASM/Tauri errors into `EngineError`

**Phase C — Per-node error attribution:**
- [ ] Add `EvalError` wrapper in evaluator that captures `(node_id, node_type, source: CompositorError)`
- [ ] Add `nodeErrors: Record<NodeId, EngineError>` to store
- [ ] Add error badge to `BaseNode` component for nodes with errors
- [ ] Show "Blocked by upstream" derived state on downstream nodes

**Phase D — Enforcement:**
- [ ] Add ESLint rule `no-empty` with `allowEmptyCatch: false`
- [ ] Add CI grep checks for `unwrap_or(JsValue::NULL)` and empty catch blocks

### 1.4 Fix muted node pass-through bug
- [ ] `eval.rs:155-156`: When a node has multiple inputs of the same type, muting currently picks the first match silently. Add `NodeSpec` metadata for "pass-through input" or error when ambiguous

---

## Phase 2: Performance Foundations (2–4 weeks)

Items that prevent the app from degrading under real workloads. These unlock 4K workflows and multi-viewer setups.

### 2.1 Evaluator cache eviction
- [ ] Track approximate byte size per cached `Value::Image` (width × height × 16 bytes)
- [ ] Implement LRU eviction in the evaluator cache, capped by total byte budget (e.g., 512MB default, configurable)
- [ ] Evict on every evaluation pass, not just on OOM
- [ ] Add cache hit/miss/eviction metrics (logged or exposed to frontend)

### 2.2 Selective viewer invalidation
- [ ] Replace `triggerAllViewers()` with dirty-viewer tracking: after a mutation (connect, disconnect, setParam), compute which viewer nodes' upstream subgraphs are affected
- [ ] Only re-evaluate dirty viewers
- [ ] Use existing dirty propagation in the graph to determine affected outputs

### 2.3 Evaluator upstream hash optimization
- [ ] `compute_upstream_hash()` (eval.rs) walks the entire upstream dependency tree per node — O(n²) for deep graphs
- [ ] Cache upstream hashes per node, invalidate incrementally when params change (per-param-key dirty tracking)
- [ ] Benchmark before/after with a 50-node deep graph

### 2.4 GPU texture pooling
- [ ] Pool GPU textures by (width, height, format) instead of allocating per-evaluation
- [ ] Detect consecutive GPU nodes in evaluation order and keep intermediate textures on GPU (skip CPU readback/re-upload)
- [ ] Add GPU memory budget tracking in `GpuContext`

---

## Phase 3: Frontend Architecture (2–4 weeks)

Items that make the frontend testable, maintainable, and performant. Can run in parallel with Phase 2.

### 3.1 Split the monolithic store
Break `graphStore.ts` (2,441 lines, 156 actions) into focused stores:
- [ ] `graphStructureStore` — nodes, connections, positions, selections
- [ ] `renderStore` — renderResults, nodeTimings, render lock/suspend state
- [ ] `playbackStore` — currentFrame, fps, loopMode, playback state
- [ ] `undoStore` — undo/redo stacks, snapshot capture/restore
- [ ] Keep `settingsStore`, `themeStore`, `layoutStore` as-is (already well-scoped)
- [ ] Move module-scope render control variables (`renderLock`, `renderSuspendCount`, `preCommitSnapshot`) into Zustand state so they're visible in DevTools and captured in undo

### 3.2 Fix live parameter race conditions
- [ ] Await `exportGraph()` in `setParamLive()` before storing the snapshot, or use a synchronous snapshot mechanism
- [ ] Add a gesture lock to prevent overlapping `setParamLive`/`setParamCommit` sequences
- [ ] Ensure `liveRenderGeneration` properly discards stale renders without race windows

### 3.3 Clean up state on node deletion
- [ ] When removing a node, also delete entries from `renderResults`, `nodeTimings`, `aiNodeStatuses`, `aiNodeStale`
- [ ] Add a `cleanupNodeState(nodeId)` helper called from all deletion paths (delete, undo, clear)

### 3.4 Improve EngineBridge abstraction
- [ ] Audit optional methods — split into `CoreBridge` (required, non-optional) and `DesktopBridge extends CoreBridge` (desktop-only features)
- [ ] Remove `Promise<T> | T` union return types — make all methods async (`Promise<T>`), since WASM sync calls wrapped in `Promise.resolve()` are negligible overhead
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

### 4.4 Expand CompositorError taxonomy
- [ ] Add variants: `ImageTooLarge`, `GpuDeviceLost`, `GpuShaderCompilation`, `FormatMismatch`, `UnsupportedOperation`, `ResourceNotFound`
- [ ] Replace uses of `CompositorError::Other(String)` with specific variants where possible
- [ ] Ensure errors round-trip across WASM/IPC with stable error codes

### 4.5 Format propagation validation
- [ ] Require nodes to declare output Format rules in `NodeSpec` (e.g., "inherits input A", "uses project format", "custom")
- [ ] Validate format consistency at evaluation boundaries — mismatches become `CompositorError::FormatMismatch`
- [ ] Auto-rasterization of Field→Image should respect declared format rules, not silently pick a fallback

---

## Phase 5: Testing & CI (ongoing, start immediately)

Items that can be done incrementally alongside any other phase.

### 5.1 Rust error path testing
- [ ] Add integration tests for error scenarios: missing inputs, type mismatches, cycle detection, invalid connections, oversized images
- [ ] Add evaluator tests that exercise cache invalidation, dirty propagation, and muted node pass-through
- [ ] Target: every `CompositorError` variant has at least one test that triggers it

### 5.2 Frontend component tests
- [ ] Set up vitest + React Testing Library for component tests
- [ ] Add tests for critical components: `NodeCanvas` (node creation, connection, deletion), `BaseNode` (param rendering), `CurvesNode` (curve editing)
- [ ] Add tests for store interactions: undo/redo round-trips, live parameter gestures, node deletion cleanup

### 5.3 CI pipeline improvements
- [ ] Add code coverage reporting (e.g., `cargo-tarpaulin` or `cargo-llvm-cov`) with minimum threshold
- [ ] Add benchmark regression detection: run Criterion benchmarks in CI, fail on >10% regression
- [ ] Add frontend typecheck + lint as blocking CI steps (may already exist, verify)
- [ ] Consider adding a GPU CI runner or at minimum ensuring GPU test skip-detection works reliably

### 5.4 E2E tests
- [ ] Add Playwright E2E tests for core workflows: load image → add nodes → connect → verify render output
- [ ] Test undo/redo, save/load round-trip, node deletion, parameter editing
- [ ] Run in CI on every PR

---

## Phase 6: Scale Preparation (future, as needed)

These become necessary when hitting the [escalation triggers](./reviews/architecture-review-2-22-26.md#escalation-triggers) identified in the architecture review. Don't start until one of those triggers fires.

### 6.1 Background thread rendering
- [ ] Move evaluation off the main thread: Web Workers for WASM, dedicated thread for native
- [ ] Async render results delivered via message passing
- [ ] UI stays responsive during long evaluations

### 6.2 Tile-based processing
- [ ] **Prerequisite:** cache eviction (Phase 2.1) must be solid first
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

## Cross-Cutting: Things to Never Do

These are engineering guardrails that apply at all times, regardless of what phase we're in.

- **No `as any`, `@ts-ignore`, `@ts-expect-error`** in TypeScript
- **No `.unwrap()` or `panic!()` in Rust library code** (test code is fine)
- **No new fields on `EvalContext`** without first considering `EvalSession` / `TypeMap`
- **No new `as_any()` downcast sites** — use `ResourceStore` or a trait instead
- **No hardcoded colors** in frontend components (enforced by ESLint rule)
- **No tile processing before cache eviction** — tiles without eviction leak in smaller chunks
- **Don't let `compositor-core` absorb more integrations** — keep it focused on graph/eval mechanics
- **No empty catch blocks** in frontend code — every catch must log, set error state, or re-throw
- **No `unwrap_or(JsValue::NULL)`** in WASM bridge code — errors must propagate to JS
- **No returning `null` to signal errors** from EngineBridge methods — throw `EngineError` instead
