# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

Cascade is a node-based image processing application. The Rust backend handles graph evaluation and image processing. The React frontend renders the node editor UI. They communicate via WASM (browser) or Tauri IPC (desktop).

## Repository layout

```
crates/
  cascade-core/       # Graph engine, evaluator, node trait, type system
  cascade-nodes-std/  # All built-in CPU node implementations + benchmarks
  cascade-gpu/        # wgpu compute shader pipeline (GLSL → WGSL via naga)
  cascade-ocio/       # OpenColorIO integration (display/view transforms)
  cascade-ocio-sys/   # OpenColorIO C FFI bindings (auto-stubs if not installed)
  cascade-video/      # Video I/O support
  cascade-wasm/       # wasm-bindgen bridge exposing Engine to JS
  cascade-runtime/    # Native runtime engine + CLI bench tool
apps/
  web/                # React + Vite + @xyflow/react + Zustand
  tauri/              # Tauri v2 desktop shell
```

## Key architectural rules

### Rust

- **Image format**: All pixel processing uses `f32` RGBA in linear color space. sRGB conversion happens only at load (input) and display (output) boundaries. Never process pixels in sRGB space. `f16` is used only at I/O boundaries (GPU upload/readback via `to_f16_bytes()`/`from_f16_data()`).
- **Node trait**: Every node implements `cascade_core::node::Node`. The `spec()` method returns a `NodeSpec` declaring inputs, outputs, params, and UI hints. The `evaluate()` method receives an `EvalContext` and returns `HashMap<String, Value>`.
- **Adding a new node**: Create the struct in `cascade-nodes-std`, implement `Node`, register it in `register_standard_nodes()` in `lib.rs`. The frontend auto-discovers it via `list_node_types()` — no frontend changes needed.
- **Graph**: Uses `SlotMap` for stable node IDs. Connections are type-checked. Cycles are rejected via DFS. Dirty propagation flows downstream on param changes.
- **Evaluator**: Pull-based from viewer nodes. Cached per-output with keys `(frame_time, param_revision, upstream_hash)`. Only recomputes dirty subgraphs.
- **Parallelism**: All per-pixel operations use Rayon `par_chunks_exact_mut(4)` for SIMD-friendly parallel processing.
- **Arc vs Box**: Node instances are `Arc<dyn Node>` (not `Box`) to enable cheap cloning for background renders.
- **Error handling**: Use `CascadeError` from `cascade-core`. Don't use `unwrap()` or `panic!()` in library code. Image constructors (`from_f32_data`, `from_f32_data_with_space`, `new_with_domain`, `from_f16_data`) return `Result<Image, CascadeError>` — always propagate with `?` in production code.
- **Error propagation (WASM bridge)**: All functions in `cascade-wasm` must return `Result<_, JsValue>` and use `map_err(to_engine_error)?` for error propagation. Never use `unwrap_or(JsValue::NULL)`, bare `.unwrap()`, or `.expect()` in production WASM bridge code. The crate enforces `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`.

### Performance and error handling

Performance and robust error handling are first-class concerns in this project — not afterthoughts.

- **Prefer GPU nodes over CPU nodes.** When implementing image processing operations, default to a GPU kernel node (`cascade-gpu`) unless the operation fundamentally cannot run on the GPU (e.g., it requires random access to the full image, complex branching logic, or external library calls). GPU nodes run orders of magnitude faster on large images.
- **CPU fallback is acceptable** when GPU is unavailable at runtime, but the GPU path should be the primary implementation when feasible.
- **Profile before assuming.** If you're unsure whether a GPU implementation will be faster for a given operation, say so — don't guess. Criterion benchmarks exist for CPU nodes; use them as a baseline.
- **Error handling is mandatory, not optional.** Every new code path must propagate errors properly using `CascadeError` (Rust) or structured `EngineError` (frontend). See the Rust and Frontend error handling rules above. Never silently discard errors or fall back to default values without logging.

### Frontend (TypeScript/React)

- **State management**: Single Zustand store composed from 12 slice files in `store/graphStore/slices/`. `store.ts` is a thin composition shell — new actions go in slice files, not `store.ts` (enforced by ESLint `max-lines`). Shared mutable state (engine, render lock, undo stacks) lives in `kernel.ts`. All mutations sync to the engine first, then update local state.
- **Engine bridge**: `EngineBridge` interface abstracts over WASM and Tauri backends. `WasmEngine` is synchronous, `TauriEngine` is async IPC.
- **Theming**: All colors use CSS custom properties defined in `src/styles/theme.css`. An ESLint rule (`no-hardcoded-colors`) enforces this — never use raw hex/rgb values in components.
- **Node components**: Custom React Flow nodes live in `src/components/nodes/`. `BaseNode` is the shared wrapper. UI controls are driven by `NodeSpec` metadata from Rust.
- **Error handling**: Engine/render/eval errors must propagate as structured `EngineError` objects through the full stack (WASM bridge → EngineBridge → store → UI). Never swallow errors with empty catch blocks or by returning null. Only the Zustand store should catch engine exceptions — components and hooks must not swallow errors from engine calls. See the [error handling plan](./reviews/error-handling-plan.md) for the full strategy.

## Build commands

```bash
# Rust
cargo check --workspace          # Type check all crates
cargo test --workspace           # Run all tests
cargo clippy --workspace         # Lint
cargo fmt --all -- --check       # Format check
cargo bench --package cascade-nodes-std  # Run Criterion benchmarks

# Frontend (from apps/web/)
yarn install                     # Install deps
yarn dev                         # Dev server
yarn lint                        # ESLint
npx tsc -b --noEmit              # Typecheck

# WASM bridge
wasm-pack build crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg
```

## Testing

- **Rust unit tests**: Inline `#[cfg(test)]` modules in each crate. Run with `cargo test --workspace`.
- **Integration tests**: `crates/cascade-core/tests/basic.rs` — full pipeline tests through standard nodes.
- **GPU tests**: In `cascade-gpu/src/lib.rs`. Tests that need a GPU gracefully skip when `GpuContext::new()` fails (expected in CI).
- **Benchmarks**: Criterion benchmarks in `crates/cascade-nodes-std/benches/node_benchmarks.rs`. Covers blur, blend, brightness/contrast, invert, resize, alpha_over, sRGB conversion.
- **Frontend linting**: ESLint with TypeScript, React Hooks, and custom `no-hardcoded-colors` rule.

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs on push to `main` and PRs. Four parallel jobs: Rust check+test, Rust lint (clippy+fmt), benchmark compile check, frontend lint+typecheck.

## Common patterns

### Adding a new node

**Default to a GPU kernel node** when the operation is a per-pixel transform (color correction, filters, blending, etc.). GPU nodes are dramatically faster and simpler to write for these cases. Only use a CPU node (`cascade-nodes-std`) when the operation requires complex control flow, full-image random access, or external library calls that can't run in a shader.

#### CPU node

1. Create struct in the appropriate file under `crates/cascade-nodes-std/src/` (e.g., `color_ops.rs` for color nodes, `filter_ops.rs` for filters)
2. Implement `Node` trait with `spec()` and `evaluate()`
3. Add `pub use` in `crates/cascade-nodes-std/src/lib.rs`
4. Register in `register_standard_nodes()` with a unique string ID
5. Add tests inline or in the crate's test module

#### GPU kernel node

1. Create a `KernelManifest` (JSON or Rust struct) with id, ports, params, and GLSL kernel body
2. The GLSL `process(vec4 color, vec2 uv, ivec2 pixel)` function returns the output color
3. Register via `Engine::register_gpu_kernel(json)` or place JSON in `kernels/` directory

### Modifying the frontend

- Node rendering is automatic from `NodeSpec`. Only create custom node components when you need special UI (e.g., image preview, inline canvas).
- All param changes go through `graphStore.setParam()` which syncs to engine then triggers viewer re-render.
- Never bypass the store to call engine methods directly.

## Fix philosophy

- **Never apply a quick fix if it's not the architecturally correct fix.** A band-aid that papers over a design problem is worse than no fix at all — it adds complexity and makes the real fix harder later.
- When you identify that the correct solution requires a larger refactor, **always surface this to the user**. Explain what the right architecture looks like, why the simple fix is insufficient, and ask whether we should proceed with the refactor instead.
- Prefer doing things right over doing things fast. A well-designed solution that takes longer is always preferable to a hacky shortcut.
- **When you hit an architectural limitation — stop.** If the current architecture cannot cleanly support what you're trying to do (e.g., the type system doesn't express a needed concept, the evaluator can't handle a new execution pattern, the graph model doesn't support a required connection type), do not work around it. Instead: (1) clearly describe the limitation and why it blocks the correct implementation, (2) propose what architectural changes might be needed, and (3) ask the user how to proceed before writing any code.

## Implementation plans

When starting a non-trivial feature or change, create a Markdown plan file in `implementation-plans/` (e.g., `implementation-plans/gpu-blur-node.md`). The plan should outline the goal, approach, affected files, and a checklist of steps.

As you work, **mark off progress in the plan file** (using `- [x]` checkboxes) in addition to updating your TODO tool. The plan file serves as a durable, human-readable record of what was done and what remains — it persists across sessions and is visible to other agents and the user, unlike the TODO tool which is ephemeral.

## Parallel agents

Multiple AI agents may be working on this repository simultaneously. If you encounter unexpected changes, new files, or compilation errors that you did not introduce, **ignore them and move on**. Do not attempt to delete, revert, or fix changes made by other agents — they are handling their own work.

## Conventions

- Rust: Follow `rustfmt` defaults. `cargo clippy` must pass with `-D warnings`.
- TypeScript: ESLint config at `apps/web/eslint.config.js`. No hardcoded colors.
- Commits: Conventional-style preferred (e.g., `feat:`, `fix:`, `refactor:`).
- Tests: Add tests for new node implementations. GPU tests should handle missing GPU gracefully.
