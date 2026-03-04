# Cascade Architecture Review — February 22, 2026

*Synthesized from 4 parallel deep-exploration agents analyzing Rust crates, frontend, testing/CI, and GPU/WASM subsystems, plus Oracle deep architectural analysis and direct code review of core files.*

---

## What's Working Well

Credit where due — several foundational decisions are genuinely excellent:

1. **Linear f32 RGBA pipeline.** Physically correct compositing. sRGB only at I/O boundaries. This is exactly what Nuke does, and it's the right choice. The 4096-entry LUT for sRGB→u8 conversion is a nice optimization.

2. **Self-describing `NodeSpec` system.** Nodes declare their own inputs, outputs, params, and UI hints. Adding a new CPU node requires zero frontend changes. This is the single best architectural decision in the project — it scales beautifully.

3. **Crate dependency graph is clean.** `cascade-core` has zero Cascade dependencies. Everything flows downward. No circular deps. Optional features (OCIO, video) are properly gated behind Cargo feature flags. WASM builds don't pull desktop-only dependencies.

4. **SlotMap for graph nodes.** O(1) lookup, stable IDs that survive deletions, cache-friendly. Better than arena or index-based alternatives.

5. **Pull-based evaluation.** Only computes what viewers need. Unused branches are never evaluated. Cache keys using `(frame_time, param_revision, upstream_hash)` are content-addressable without hashing pixel data — very efficient.

6. **Field abstraction.** Resolution-independent procedural patterns (`Fn(u,v) → [f32;4]`) that auto-rasterize at Image ports is elegant. Enables generators (Noise, Gradient, Checkerboard) to compose without premature rasterization.

7. **Platform-aware async.** `NodeFuture` drops the `Send` bound on WASM. Clean conditional compilation, not a hack.

8. **Rayon parallelism.** All per-pixel operations use `par_chunks_exact_mut(4)`. LUT-based sRGB conversion. Criterion benchmarks covering 40+ nodes.

9. **CSS variable theming** with a custom ESLint rule enforcing no hardcoded colors. The theme system (1122 lines of CSS variables, theme tokens in TypeScript) is exemplary.

---

## Blocking / Severe Issues

### 1. Memory: No cache eviction, no resource limits (HIGH)

The evaluator's cache grows without bound. `HashMap<(NodeId, String), (CacheKey, Value)>` in `eval.rs` accumulates every intermediate result ever computed. A 4K f32 RGBA image is **~126MB**. A 20-node graph caches all intermediates — potentially **2+ GB** of pixel data with no eviction strategy.

Worse, there are **no image dimension limits anywhere** in the stack. `kernel_node.rs:499` does `Vec::with_capacity((width * height * 4) as usize)` with no bounds check. A malformed input with width=100000, height=100000 attempts a **40GB allocation** and crashes.

**Impact:** The app will crash on large graphs or 4K images during extended sessions. This is the biggest operational risk.

### 2. Monolithic frontend store (HIGH)

`graphStore.ts` is **2,441 lines** with **156 actions** and **35+ state properties** handling: graph structure, rendering, undo/redo, playback, AI execution, file I/O, group editing, and color management. All in one Zustand store.

Any state change (even `currentFrame` ticking) can trigger re-renders in components subscribed to `nodes` or `renderResults`. There's no selector optimization visible.

Critical render control state lives in **module-scope variables** outside the store (`renderLock`, `renderSuspendCount`, `preCommitSnapshot`) — invisible to DevTools, not captured in undo snapshots, and untestable.

**Impact:** Re-render storms on every interaction. Untestable. Unreasonable coupling between unrelated concerns.

### 3. `assert_eq!` panics in library constructors (HIGH)

`Image::from_f32_data()` (types.rs:259), `Image::from_f32_data_with_space()` (types.rs:277), and `Image::new_with_domain()` (types.rs:298) all use `assert_eq!` on data length. This **panics in library code**, violating the project's own AGENTS.md rule.

Any node that constructs an image with mismatched dimensions crashes the entire WASM instance — no recovery possible. These should return `Result<Image, CascadeError>`.

### 4. `triggerAllViewers()` re-renders everything (HIGH)

Every `connect()`, `disconnect()`, `setParam()`, and `loadImage()` call triggers `triggerAllViewers()` which evaluates **every viewer node** in the graph. With multiple viewers, this means redundant full graph evaluations. There's no dirty tracking from the change site to only the affected viewers.

### 5. Node state via `as_any_mut()` downcasting is architectural debt (HIGH)

```rust
fn as_any_mut(&mut self) -> &mut dyn Any;
```

This means "node instances secretly carry mutable engine state." It breaks encapsulation, complicates WASM boundary calls ("reach into a node to set image data"), and prevents cleanly separating **graph definition** (stable/serializable) from **runtime resources** (large, mutable, platform-specific).

Oracle's deeper insight: the fix isn't just introducing a trait — it's introducing an engine-owned **`ResourceStore`** keyed by `NodeId`. Nodes would access resources via `ctx.resources.get_image(handle)` instead of holding mutable state internally. This also fixes GroupNode's interior mutability via `Mutex`.

---

## Painful / Significant Issues

### 6. The Value / ParamValue / ParamDefault trinity (MEDIUM-HIGH)

Three parallel enum types that mirror each other:
- `Value` uses f32 (runtime)
- `ParamValue` uses f64 (UI precision)
- `ParamDefault` is yet another enum for spec defaults

Conversion between them loses precision (`f64 → f32`) and introduces ambiguity. `param_value_to_value()` and `param_default_to_value()` in eval.rs both truncate, and both silently return `Value::None` for types they don't handle (ColorRamp, CurvePoints). This is a source of subtle bugs.

### 7. Evaluator function signature explosion (MEDIUM-HIGH)

`evaluate()` takes **10 parameters**: graph, registry, node_instances, viewer_node_id, output_port, frame_time, color_management, ai_provider, project_format, ai_node_cache. And `EvalContext` has **7 fields** including AI-specific ones that only AI nodes use.

This is "boundary contamination" — `cascade-core` is becoming a dumping ground for cross-cutting concerns. Each new feature adds another parameter. The `ai_cached_outputs` field is a special case that only AI nodes consume.

**Fix:** Introduce an `EvalSession` struct that bundles these, and make `EvalContext` extensible via a type-keyed service locator (`TypeMap` pattern) instead of adding fields. Keep core focused on graph/eval mechanics and traits; push integrations (AI/OCIO) into higher layers.

### 8. GPU↔CPU round-trip on every node (MEDIUM)

Connected GPU nodes go: CPU Image → upload to GPU texture → compute shader → readback to CPU → store in cache → next GPU node uploads again. The `cascade-gpu` crate has no mechanism to keep images on the GPU between connected GPU nodes. For a chain of 3 GPU nodes, that's 6 unnecessary transfers.

Pipeline caching exists (keyed on WGSL hash) but **no texture/buffer pooling**. Every kernel allocates and deallocates GPU buffers per evaluation.

### 9. Live parameter race conditions (MEDIUM)

`setParamLive()` in graphStore fires `exportGraph()` async without awaiting it, then `setParamCommit()` has a fallback check (`if (!preCommitSnapshot.engineState)`). This means:
- Undo stack can contain incomplete snapshots if commit fires before export resolves
- `liveRenderGeneration` counter resets on every gesture, but stale renders from previous gestures can complete after new ones start
- No lock preventing overlapping gesture sequences

### 10. EngineBridge optional method sprawl (MEDIUM)

The `EngineBridge` interface has **30+ methods**, many returning `Promise<T> | T` (sync or async depending on implementation). Callers must wrap everything in `Promise.resolve()`. Feature checks are scattered throughout graphStore: `if (eng.loadSequenceFrameData)`, `if (eng.setParamAndRender)`, `if (eng.renderSequence)`.

This creates two parallel code paths (web vs desktop) interleaved in one file. Better: make two distinct implementations with non-optional methods, or use a capability/feature flag system.

### 11. Buffer size calculation overflow (MEDIUM)

`kernel_node.rs:440, 488` and `kuwahara.rs:830, 878` calculate buffer sizes without overflow checks. `padded_bytes_per_row * height` can overflow if width/height exceed ~65MB pixels. No `MAX_IMAGE_SIZE`, `MAX_BUFFER_SIZE`, or GPU memory budget is enforced anywhere.

### 12. Silent serialization failures in WASM bridge (MEDIUM)

`wasm/lib.rs:187, 205, 507, 525, 619` use:
```rust
serde_wasm_bindgen::to_value(&specs).unwrap_or(JsValue::NULL)
```
JS receives NULL on serialization failures with no error message. These should propagate structured errors.

---

## Notable / Nice-to-Fix Issues

### 13. `CascadeError::Other(String)` catch-all (MEDIUM-LOW)

Only 9 error variants for an entire Cascade engine. `Other(String)` is used as a dumping ground throughout `cascade-nodes-std`. Error context is lost at the WASM boundary — JS receives string messages, not structured errors.

### 14. Image struct has redundant fields (LOW)

`width` and `height` are documented as "backward-compatible" with `data_window.width_u32()` and `data_window.height_u32()`. This is acknowledged tech debt. Low risk but every Image constructor must maintain the invariant.

### 15. Muted node pass-through bug (MEDIUM)

`eval.rs:155-156`: Muted nodes pass data through by finding the **first input matching the output type**. If a node has multiple inputs of the same type (e.g., Blend's `base` and `blend_input` are both Image), muting it silently picks one. This should either error or require explicit mapping.

### 16. No frontend component tests (MEDIUM)

5 store test files (2,655 lines) but **zero React component tests**. All 41 components (NodeCanvas, BaseNode, CurvesNode, etc.) are untested. The CI pipeline doesn't run E2E tests either. The entire UI interaction surface ships without automated validation.

### 17. Field closures can't be serialized (LOW)

`Field` uses `Arc<dyn Fn(f32, f32) -> [f32; 4]>`. Save/load workflows skip Field values. GroupNode serialization handles this by re-creating Fields from node params, but if a Field is modified procedurally, it's lost.

### 18. Unbounded state growth in frontend Maps (MEDIUM-LOW)

When nodes are deleted, `renderResults`, `nodeTimings`, `aiNodeStatuses`, and `aiNodeStale` Maps are **not cleaned up**. Over long sessions with many create/delete cycles, this leaks memory in the JS heap.

### 19. `unwrap()` proliferation in library code (MEDIUM)

Found 74+ `.unwrap()` calls in `eval.rs`, 44 in `cascade-nodes-std/lib.rs`, 30 in `cascade-runtime`. Many are in test code (acceptable) but some are in production paths — particularly Mutex locks and registry lookups.

### 20. No GPU failure recovery (MEDIUM-LOW)

If GPU context drops mid-evaluation, the kernel node panics. No CPU fallback for GPU kernels. GPU failures are fatal to graph evaluation.

---

## Testing & CI Gaps

| Domain | Status | Severity |
|--------|--------|----------|
| **CI Coverage** | Tests run, but no GPU/e2e/coverage metrics | Medium |
| **Rust Tests** | 163 unit tests, 1 integration test, only happy paths | High |
| **Error Path Testing** | Zero tests for error scenarios | High |
| **Frontend Tests** | 5 store tests, 0 component tests, 0 e2e tests | Critical |
| **Benchmarks** | Comprehensive node benchmarks, missing graph/GPU/memory benchmarks | Medium |
| **GPU Testing** | 9 tests, gracefully skip if GPU unavailable, never run in CI | Medium |

---

## Architectural Constraints That Will Block Future Features

| Constraint | Blocks |
|---|---|
| Fixed RGBA — no AOV/multi-channel system | CG integration, deep compositing, cryptomatte |
| No tile-based processing | 4K+ images (memory explodes) |
| No background thread rendering | UI freezes during evaluation (especially WASM) |
| Field abstraction can't do spatial filters | Blur/sharpen must rasterize first, breaking the Field pipeline |
| No expression language for params | Can't link parameters programmatically |
| No streaming evaluation | Video sequences load entirely into memory |

---

## Escalation Triggers

These are the moments when targeted fixes won't suffice and the bigger redesign becomes unavoidable:

1. When you want **reliable 4K/8K** with multiple viewers and timeline scrubbing without OOM
2. When you want **GPU graphs to be meaningfully faster** than CPU on real chains (not isolated kernels)
3. When you want **robust project serialization/versioning** without special-casing nodes

---

## Trap Warnings

- **Don't add tile processing before adding eviction** — tiles without eviction just leak in smaller chunks
- **Don't let `cascade-core` absorb more integrations** (AI/OCIO/etc.) — it will become untestable and hard to evolve; keep core generic with traits
- **Don't let downcasting spread further** — every new "special node that needs mutation" increases coupling and makes serialization/versioning uglier

---

## Prioritized Recommendations

### Week 1 (Safety)
1. Replace `assert_eq!` in Image constructors with `Result` return types
2. Add `MAX_IMAGE_DIM` validation (e.g., 16384×16384) at all allocation sites
3. Replace `.unwrap()` in production eval paths with proper error propagation
4. Replace `unwrap_or(JsValue::NULL)` in WASM bridge with explicit error handling

### Week 2-3 (Performance)
5. Implement LRU cache eviction in the evaluator (cap by total pixel byte count)
6. Replace `triggerAllViewers()` with selective dirty-viewer tracking
7. Split `graphStore.ts` into graph structure / render / playback / undo stores

### Month 2 (Architecture)
8. Unify `Value`/`ParamValue`/`ParamDefault` into a single parameterized type or use conversion traits
9. Introduce `EvalSession` to replace the 10-parameter evaluate() signature; push AI/OCIO out of core
10. Add GPU texture pooling to eliminate CPU↔GPU round-trips between connected GPU nodes
11. Introduce a `ResourceStore` + `DataReceiver` trait to eliminate `as_any()` downcasting
12. Add format propagation validation — nodes must declare output Format rules

### Month 3+ (Scale)
13. Add frontend component tests and E2E tests
14. Implement background thread rendering
15. Investigate tile-based processing (only after eviction is solid)
16. GPU subgraph batching — detect consecutive GPU nodes and keep intermediates on GPU
