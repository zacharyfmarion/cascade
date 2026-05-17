# Progress

Last validated: 2026-05-17

This page is a maintained snapshot of the repository's current implementation state. For long-range priorities, see [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) and [ENGINEERING_ROADMAP.md](./ENGINEERING_ROADMAP.md).

## Completed

### Rust Backend
- [x] Cargo workspace covering `cascade-core`, `cascade-nodes-std`, `cascade-gpu`, `cascade-wasm`, `cascade-runtime`, `cascade-ocio-sys`, `cascade-ocio`, and the Tauri crate
- [x] `crates/cascade-video` retained in the repository and intentionally excluded from workspace membership
- [x] Image type with linear `f32` RGBA pixels, `Arc<Vec<f32>>` sharing, display `Format`, and data-window domains
- [x] Image constructors validate dimensions and data length through `CascadeError`
- [x] sRGB conversion limited to input/display boundaries
- [x] DAG graph with SlotMap node IDs, typed connections, cycle rejection, and downstream dirty propagation
- [x] Pull-based evaluator with per-output caching, preview-scale awareness, requested frame dependencies, and LRU eviction
- [x] Node trait with self-describing `NodeSpec`, dynamic specs, and async `NodeFuture` evaluation
- [x] Node registry using `Arc<dyn Node>` factories for cheap cloning and runtime registration
- [x] Rayon parallelism for CPU per-pixel processing

### Node Library

`cascade-nodes-std` currently registers 60 built-in standard nodes, plus GPU kernel nodes are registered by `cascade-gpu` when a GPU context is available.

| Area | Current coverage |
|------|------------------|
| Input/output | Image, sequence, batch, video, viewers, compare viewer, image/sequence/video export, EXR export |
| AI | Inpaint, depth estimate, remove background, upscale, generate image |
| Color and utility | Color convert, curves, palette, HSVA split/combine, color ramp, math, dot, project/image info |
| Filters and mattes | Blur, sharpen, dilate, erode, median, directional/radial blur, edge blur, matte expand/shrink, shape, glow |
| Transforms and time | Resize, crop, flip, translate, corner pin, ST map, time offset, frame hold, frame blend |
| Generators | Solid color, noise, gradient, checkerboard, rasterize field, constants, text, UV map |
| Programmable/group | GPU Script draft nodes and custom group definitions |

### GPU Compute
- [x] `GpuContext` initialization with wgpu
- [x] GLSL `process(vec4 color, vec2 uv, ivec2 pixel)` kernel model transpiled through naga to WGSL
- [x] `KernelManifest` metadata for ports, params, pixel-space params, and GLSL body
- [x] `GpuKernelNode` execution with texture upload, compute dispatch, and readback
- [x] Built-in GPU kernel registry for color, adjustment, matte, blend/composite, utility/filter, and transform operations
- [x] Runtime GPU Script registration and compilation
- [x] Pixel-space parameter scaling for preview renders
- [x] GPU tests that skip gracefully when no GPU adapter is available

### WASM And Desktop Runtime
- [x] `cascade-wasm` bridge exposing graph, render, export, GPU script, group, project, AI, and sequence workflows to the web app
- [x] Public WASM bridge functions return `Result<_, JsValue>` and map errors into structured frontend errors
- [x] Single-threaded and threaded WASM bundles built through `apps/web` scripts
- [x] `cascade-runtime` mirrors the engine surface for Tauri and native workflows
- [x] Tauri v2 desktop shell with native filesystem access, packaging, signing/notarization workflow, and release scripts

### Frontend
- [x] React 19 + Vite + TypeScript app with `@xyflow/react`
- [x] Zustand graph store split into 15 focused slices plus `kernel.ts` runtime state
- [x] EngineBridge abstraction for worker-backed WASM, direct WASM, and Tauri IPC
- [x] Node library, context menu, typed ports, inspector controls, viewer panes, and project save/load
- [x] Undo/redo, cut/copy/paste, multi-select, edge reconnection, and drop-node-on-edge insertion
- [x] Live parameter preview with generation tracking and full-quality commit rendering
- [x] Structured engine errors surfaced in store/UI with per-node attribution
- [x] Theme tokens in CSS custom properties with lint enforcement against hardcoded component colors

### Product Features
- [x] Graph DSL for AI and text-based graph editing
- [x] AI assistant with graph manipulation tools
- [x] AI GPU Script creation and manifest inspection tools
- [x] Optional BYOK AI nodes and assistant flows
- [x] Node groups with editing stack navigation, group I/O, export, panic safety, cycle detection, atomic updates, and parameter preservation
- [x] EXR multi-layer load/export and instance-aware dynamic ports
- [x] Image sequence, video, and batch workflow foundations, including browser ZIP sequence export
- [x] Viewer channel isolation, pixel inspector, gain/gamma display controls, and compare viewer
- [x] Analytics privacy controls and minimal event contract

### Validation And CI
- [x] Rust check/test/clippy/fmt workflows
- [x] Frontend lint, CSS lint, typecheck, unit tests, and Playwright E2E coverage
- [x] Path-based CI change detection with docs-only skips for heavy jobs
- [x] Benchmark compile checks and Criterion benchmark coverage for standard nodes

## Remaining Work

### Engineering
- [ ] GPU texture pooling and GPU subgraph batching to reduce upload/readback overhead
- [ ] Full async render pipeline with cancellation for all render paths
- [ ] Native Tauri background rendering
- [ ] Tile-based processing for large images
- [ ] Node deletion state cleanup edge cases
- [ ] EngineBridge split into required core capabilities and desktop-specific capabilities
- [ ] ResourceStore architecture to remove mutable node downcasting
- [ ] Expanded `CascadeError` taxonomy and format propagation validation
- [ ] Broader error-path tests, component tests, coverage reporting, and benchmark regression detection

### Product
- [ ] Finish remaining node group reliability work, including nested group and undo/redo edge cases
- [ ] Improve GPU Script editing, hot reload, compile diagnostics, and inline DSL representation
- [ ] Add clear user-facing docs for optional AI API keys
- [ ] Mature drag-and-drop, metadata preservation, and image format coverage
- [ ] Templates, presets, shareable URLs, embed mode, and project organization
- [ ] Batch/headless rendering and library/CLI workflows
- [ ] AI assistant polish, iterative self-correction, and shader generation examples
- [ ] Demand-gated animation, keyframe, roto, paint, tracking, and advanced compositing features
