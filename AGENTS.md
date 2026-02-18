# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

Compositor is a node-based image processing application. The Rust backend handles graph evaluation and image processing. The React frontend renders the node editor UI. They communicate via WASM (browser) or Tauri IPC (desktop).

## Repository layout

```
crates/
  compositor-core/       # Graph, evaluator, node trait, types, errors
  compositor-nodes-std/  # All built-in CPU node implementations + benchmarks
  compositor-gpu/        # wgpu compute shader pipeline (GLSL → WGSL via naga)
  compositor-wasm/       # wasm-bindgen bridge exposing Engine to JS
  compositor-runtime/    # Native runtime engine + CLI bench tool
apps/
  web/                   # React + Vite + @xyflow/react + Zustand
  tauri/                 # Tauri v2 desktop shell
```

## Key architectural rules

### Rust

- **Image format**: All pixel processing uses `f32` RGBA in linear color space. sRGB conversion happens only at load (input) and display (output) boundaries. Never process pixels in sRGB space. `f16` is used only at I/O boundaries (GPU upload/readback via `to_f16_bytes()`/`from_f16_data()`).
- **Node trait**: Every node implements `compositor_core::node::Node`. The `spec()` method returns a `NodeSpec` declaring inputs, outputs, params, and UI hints. The `evaluate()` method receives an `EvalContext` and returns `HashMap<String, Value>`.
- **Adding a new node**: Create the struct in `compositor-nodes-std`, implement `Node`, register it in `register_standard_nodes()` in `lib.rs`. The frontend auto-discovers it via `list_node_types()` — no frontend changes needed.
- **Graph**: Uses `SlotMap` for stable node IDs. Connections are type-checked. Cycles are rejected via DFS. Dirty propagation flows downstream on param changes.
- **Evaluator**: Pull-based from viewer nodes. Cached per-output with keys `(frame_time, param_revision, upstream_hash)`. Only recomputes dirty subgraphs.
- **Parallelism**: All per-pixel operations use Rayon `par_chunks_exact_mut(4)` for SIMD-friendly parallel processing.
- **Arc vs Box**: Node instances are `Arc<dyn Node>` (not `Box`) to enable cheap cloning for background renders.
- **Error handling**: Use `CompositorError` from `compositor-core`. Don't use `unwrap()` or `panic!()` in library code.

### Frontend (TypeScript/React)

- **State management**: Single Zustand store (`graphStore.ts`) is the source of truth. All mutations sync to the engine first, then update local state.
- **Engine bridge**: `EngineBridge` interface abstracts over WASM and Tauri backends. `WasmEngine` is synchronous, `TauriEngine` is async IPC.
- **Theming**: All colors use CSS custom properties defined in `src/styles/theme.css`. An ESLint rule (`no-hardcoded-colors`) enforces this — never use raw hex/rgb values in components.
- **Node components**: Custom React Flow nodes live in `src/components/nodes/`. `BaseNode` is the shared wrapper. UI controls are driven by `NodeSpec` metadata from Rust.

## Build commands

```bash
# Rust
cargo check --workspace          # Type check all crates
cargo test --workspace           # Run all tests
cargo clippy --workspace         # Lint
cargo fmt --all -- --check       # Format check
cargo bench --package compositor-nodes-std  # Run Criterion benchmarks

# Frontend (from apps/web/)
yarn install                     # Install deps
yarn dev                         # Dev server
yarn lint                        # ESLint
npx tsc -b --noEmit              # Typecheck

# WASM bridge
wasm-pack build crates/compositor-wasm --target web --out-dir ../../apps/web/src/wasm-pkg
```

## Testing

- **Rust unit tests**: Inline `#[cfg(test)]` modules in each crate. Run with `cargo test --workspace`.
- **Integration tests**: `crates/compositor-core/tests/basic.rs` — full pipeline tests through standard nodes.
- **GPU tests**: In `compositor-gpu/src/lib.rs`. Tests that need a GPU gracefully skip when `GpuContext::new()` fails (expected in CI).
- **Benchmarks**: Criterion benchmarks in `crates/compositor-nodes-std/benches/node_benchmarks.rs`. Covers blur, blend, brightness/contrast, invert, resize, alpha_over, sRGB conversion.
- **Frontend linting**: ESLint with TypeScript, React Hooks, and custom `no-hardcoded-colors` rule.

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs on push to `main` and PRs. Four parallel jobs: Rust check+test, Rust lint (clippy+fmt), benchmark compile check, frontend lint+typecheck.

## Common patterns

### Adding a new CPU node

1. Create struct in the appropriate file under `crates/compositor-nodes-std/src/` (e.g., `color_ops.rs` for color nodes, `filter_ops.rs` for filters)
2. Implement `Node` trait with `spec()` and `evaluate()`
3. Add `pub use` in `crates/compositor-nodes-std/src/lib.rs`
4. Register in `register_standard_nodes()` with a unique string ID
5. Add tests inline or in the crate's test module

### Adding a GPU kernel node

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

## Parallel agents

Multiple AI agents may be working on this repository simultaneously. If you encounter unexpected changes, new files, or compilation errors that you did not introduce, **ignore them and move on**. Do not attempt to delete, revert, or fix changes made by other agents — they are handling their own work.

## Conventions

- Rust: Follow `rustfmt` defaults. `cargo clippy` must pass with `-D warnings`.
- TypeScript: ESLint config at `apps/web/eslint.config.js`. No hardcoded colors.
- Commits: Conventional-style preferred (e.g., `feat:`, `fix:`, `refactor:`).
- Tests: Add tests for new node implementations. GPU tests should handle missing GPU gracefully.
