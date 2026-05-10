# Progress

**Last reviewed:** 2026-05-10

This file is a current maintainer snapshot. For forward-looking priorities, use
[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) and
[ENGINEERING_ROADMAP.md](./ENGINEERING_ROADMAP.md).

## Current Baseline

### Rust Backend
- [x] Cargo workspace includes `cascade-core`, `cascade-gpu`, `cascade-nodes-std`, `cascade-wasm`, `cascade-runtime`, `cascade-ocio`, `cascade-ocio-sys`, and `apps/tauri/src-tauri`
- [x] `crates/cascade-video` remains in the repository but is excluded from workspace membership
- [x] Image model uses linear `f32` RGBA with color-space metadata, project format, and `data_window`
- [x] Graph model uses SlotMap node IDs, typed ports, cycle rejection, and downstream dirty propagation
- [x] Evaluator is pull-based from viewers and caches by frame, params, upstream state, project format, dynamic interface signatures, requested frame dependencies, and preview scale
- [x] `CascadeError` is propagated through image constructors, evaluator paths, runtime, and the WASM bridge
- [x] Per-pixel CPU work uses Rayon, including browser-side parallelism through the threaded WASM bundle when cross-origin isolation is available

### Node System
- [x] `cascade-nodes-std` registers 60 built-in nodes
- [x] Input/output coverage includes image load/export, image sequences, batch export, video load/export, viewer, compare viewer, and EXR save
- [x] AI nodes include depth estimation, image generation, inpainting, background removal, and upscaling via user-supplied API keys
- [x] Color, utility, and generator nodes include color conversion, curves, palettes, HSVA split/combine, math, dot, project/image info, constants, text, UV map, rasterized fields, and procedural shapes
- [x] Filter/matte/transform/time coverage includes blur, sharpen, dilate, erode, median, directional/radial blur, glow, edge blur, matte expand/shrink, resize, crop, flip, translate, corner pin, ST map, time offset, frame hold, and frame blend
- [x] GPU Script nodes support runtime GLSL manifest compilation and instance-specific dynamic interfaces
- [x] Custom group nodes support internal graphs, group I/O nodes, dynamic interfaces, package export/import plumbing, and ongoing hardening

### GPU Pipeline
- [x] `cascade-gpu` provides wgpu context setup, GLSL-to-WGSL transpilation through naga, uniform packing, texture upload/readback, and preview-scale pixel parameter handling
- [x] GPU kernel manifests define ports, params, pixel-space params, and a GLSL `process(vec4 color, vec2 uv, ivec2 pixel)` body
- [x] GPU Script registration works from Rust, WASM, Tauri IPC, and AI-assisted workflows
- [ ] GPU texture pooling and GPU subgraph batching remain future performance work

### Web Frontend
- [x] React 19 + Vite + TypeScript frontend with `@xyflow/react`, Zustand, worker-backed WASM, direct WASM fallback, and Tauri IPC bridge
- [x] Graph store is split into 14 slices under `apps/web/src/store/graphStore/slices/`
- [x] Shared runtime state lives in `apps/web/src/store/graphStore/kernel.ts`
- [x] UI controls are driven from Rust `NodeSpec` metadata, with custom components for special nodes and viewers
- [x] Viewer UX includes preview scaling, channel isolation, pixel inspection, gain/gamma controls, compare viewer support, and structured error display
- [x] Project workflows include save/load, bundled assets, examples, project packages, unsaved-change prompts, sequence playback, and batch/export surfaces
- [x] AI workflows include the chat assistant, Graph DSL parsing/serialization/execution, GPU Script generation, and optional BYOK settings
- [x] Analytics use PostHog when configured and can be disabled in Settings > Privacy

### Desktop And Release
- [x] Tauri v2 desktop shell uses `cascade-runtime` over IPC and shares the web UI
- [x] Desktop builds are signed/notarized locally through `scripts/release.sh publish`
- [x] GitHub Actions validates release tags and does not build DMGs
- [x] Public install documentation currently points users to the signed Apple Silicon DMG from GitHub Releases
- [ ] Homebrew cask publishing remains script-supported but is not the current public install path

### Testing And CI
- [x] CI uses path-based change detection and skips heavy jobs for docs-only changes
- [x] Rust CI covers check/test, clippy, fmt, and benchmark compile checks where applicable
- [x] Frontend CI covers ESLint, CSS linting, TypeScript, Vitest, and Playwright E2E tests
- [x] Playwright specs cover rendering, project save/load, groups, playback, exports, EXR, image drop, viewer controls, DSL editor, and frontend race regressions

## Known Remaining Work

- [ ] Stabilize all remaining node group edge cases, especially nested groups and undo/redo inside group editing
- [ ] Clean up stale per-node frontend state on deletion across render, timing, AI status, and sequence caches
- [ ] Add GPU texture pooling before attempting broader GPU subgraph batching
- [ ] Complete the full async render pipeline for non-live evaluation and native desktop background rendering
- [ ] Expand Rust error-path tests and frontend component coverage around critical editor surfaces
- [ ] Add coverage and benchmark-regression reporting when the signal is worth the CI cost
