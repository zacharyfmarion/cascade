# Architecture

Cascade is a node-based image processing application. The shared Rust engine owns graph validation, evaluation, image processing, color management, GPU kernels, and native runtime behavior. The web app renders the editor UI with React and talks to the engine through WebAssembly; the desktop app wraps the same UI in Tauri and talks to the native runtime over IPC.

## Project Structure

```text
crates/
  cascade-core/       Graph model, evaluator, node trait, type system, image domain model
  cascade-nodes-std/  Built-in CPU node implementations and benchmarks
  cascade-gpu/        wgpu compute pipeline, GLSL kernel manifests, kernel-node support
  cascade-ocio/       OpenColorIO integration for display/view transforms
  cascade-ocio-sys/   OpenColorIO FFI bindings with generated stubs when OCIO is absent
  cascade-video/      Video I/O support; currently kept outside workspace membership
  cascade-wasm/       wasm-bindgen bridge exposing the engine to the web app
  cascade-runtime/    Native runtime engine used by Tauri and CLI-style workflows
apps/
  web/                React 19 + Vite + @xyflow/react + Zustand frontend
  tauri/              Tauri v2 desktop shell
```

The Cargo workspace includes the core, GPU, standard-node, WASM, runtime, OCIO, and Tauri crates. `crates/cascade-video` exists in the repository but is excluded from workspace membership; video support is pulled through runtime features where needed.

## Core Engine

### Image Model

Pixel processing uses linear `f32` RGBA. sRGB conversion happens at load/display boundaries, and `f16` is used only for GPU I/O (`to_f16_bytes()` / `from_f16_data()`). `Image` stores:

- `width` and `height` for the dense pixel buffer
- `data: Arc<Vec<f32>>` for cheap immutable sharing
- `color_space`
- `format`, the display canvas
- `data_window`, the half-open integer domain containing actual pixels

Images can be smaller, larger, or offset relative to the project format. Sampling outside `data_window` returns transparent black, which lets compositing and transforms operate in a shared coordinate space.

### Graph

`Graph` uses SlotMap-backed `NodeId` handles, `NodeInstance` records, typed connections, and downstream dirty propagation. Connection validation checks port existence, type compatibility, cycle prevention, and the single-input rule. Dynamic node interfaces are supported through instance-aware specs.

### Node Trait

Every node implements `cascade_core::node::Node`:

```rust
pub trait Node: Send + Sync + Any {
    fn spec(&self) -> NodeSpec;
    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a>;
    fn requested_frames(
        &self,
        _current_frame: FrameTime,
        _params: &HashMap<String, ParamValue>,
    ) -> Vec<(String, FrameTime)> {
        Vec::new()
    }
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
```

Node instances and registry factories use `Arc<dyn Node>`, allowing cheap cloning for background renders and runtime registration. `EvalContext` carries normal inputs, extra frame inputs, params, frame time, color management, optional AI provider, project format, optional AI cached outputs, and preview scale.

### Type System

`ValueType` includes `Image`, `Mask`, `Float`, `Int`, `Bool`, `Color`, `Field`, `String`, `Any`, and `Bytes`. Runtime `Value` variants include image, scalar, field, string, none, and bytes. Masks are represented by normal image values with mask-typed ports for UI and connection semantics.

`NodeSpec`, `PortSpec`, `ParamSpec`, `ParamDefault`, and `UiHint` describe node interfaces and drive frontend controls. UI hints include sliders, numeric inputs, checkboxes, color pickers, dropdowns, file pickers, color ramps, palettes, text areas, curve editors, and hidden params.

### Evaluation

Evaluation is pull-based from viewer/output nodes. The evaluator walks upstream in dependency order, merges instance params with spec defaults, rasterizes fields when an image input is required, evaluates async node futures, and caches outputs. Cache keys include frame time, param revision, upstream state, project format, node interface signatures, requested frame dependencies, and preview scale so stale results are avoided across interactive and sequence workflows.

## Standard Nodes

`cascade-nodes-std` currently registers 60 built-in nodes. Broad categories include:

- input/output: images, sequences, batches, video, viewers, compare viewer, image/sequence/video export, EXR export
- AI: inpaint, depth estimate, remove background, upscale, generate image
- color and utility: color conversion, curves, palette, HSVA split/combine, color ramp, math, dot, project/image info
- filters and mattes: blur, sharpen, dilate, erode, median, directional/radial blur, edge blur, matte expand/shrink, shape, glow
- transforms and time: resize, crop, flip, translate, corner pin, ST map, time offset, frame hold, frame blend
- generators: solid color, noise, gradient, checkerboard, rasterize field, constants, text, UV map
- programmable/group nodes: GPU script and custom group definitions

Add CPU nodes in `crates/cascade-nodes-std/src/`, export them from `lib.rs`, register them in `register_standard_nodes()`, and add focused tests. Prefer GPU kernel nodes for per-pixel operations that fit the shader model.

## GPU Pipeline

`cascade-gpu` provides the wgpu context, kernel manifests, GLSL-to-WGSL transpilation, and reusable built-in kernel definitions. Kernel manifests declare ports, params, pixel-space params, and a GLSL `process(vec4 color, vec2 uv, ivec2 pixel)` body. Pixel-space params are scaled automatically during preview execution.

## WASM Bridge

`cascade-wasm` exposes the engine through `wasm-bindgen`. It owns the graph, registry, node instances, evaluator, GPU script registration, group definitions, project format, color-management state, and render/export commands for the browser path. Public bridge functions return `Result<_, JsValue>` and map engine errors into structured frontend errors.

The web build produces both single-threaded and threaded WASM bundles:

```bash
cd apps/web
yarn build:wasm
```

Threaded WASM requires cross-origin isolation headers. Without them, the frontend falls back to the single-threaded engine path.

## Native Runtime And Desktop

`cascade-runtime` mirrors the engine surface for native use, including project/file workflows used by Tauri. `apps/tauri` is a Tauri v2 desktop shell with native filesystem access, packaging, signing/notarization support, and feature flags for video and OCIO.

## Frontend

The web app is React 19, Vite, `@xyflow/react`, Zustand, and TypeScript. `EngineBridge` abstracts over worker-backed WASM, direct WASM, and Tauri IPC implementations.

State lives in a single graph store:

- `apps/web/src/store/graphStore/store.ts` defines the composed Zustand store surface.
- `apps/web/src/store/graphStore/slices/` contains 15 focused slices for graph, render, undo, live params, frames, selection, project, batch export, sequence/video, media iteration, assets, color, AI, DSL, and toasts.
- `apps/web/src/store/graphStore/kernel.ts` holds shared mutable runtime state such as the engine instance and render generations.

All graph mutations sync to the engine first, then update local Zustand state. Components should use store actions rather than calling the engine directly.

Theming uses CSS custom properties in `apps/web/src/styles/theme.css`; components should not use raw color literals.

## Rendering Flow

1. The user edits graph state in the UI.
2. Store actions apply the mutation to the engine.
3. Affected viewers are identified.
4. The selected engine bridge renders viewers at the current frame and preview scale.
5. Results are normalized into the `ViewerResult` union.
6. Zustand publishes `renderResults`, `nodeErrors`, and timing metadata.
7. Viewer components draw pixels or scalar values.

Interactive param edits use preview-scale rendering and commit back to full quality. Generation counters prevent stale renders from overwriting newer results.

## Validation

Common local checks:

```bash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check

cd apps/web
yarn lint
yarn lint:css
yarn test
npx tsc -b --noEmit
npx playwright test
```

CI uses `.github/workflows/ci.yml`. It performs path-based change detection, skips heavy jobs for docs-only changes, and conditionally runs Rust check/test, clippy/fmt, benchmark compile checks, frontend lint/typecheck/unit/CSS checks, and Playwright E2E tests.
