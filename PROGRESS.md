# Progress

## Completed

### Rust Backend
- [x] Cargo workspace with 6 crates (cascade-core, cascade-nodes-std, cascade-gpu, cascade-wasm, cascade-runtime, cascade-tauri)
- [x] Image type with f32 RGBA linear color space (`Arc<Vec<f32>>` for cheap cloning)
- [x] sRGB <-> linear color space conversion (correct gamma transfer functions)
- [x] DAG graph with SlotMap-based NodeId, cycle detection, type-safe connections, dirty propagation
- [x] Pull-based evaluator with per-output caching (CacheKey: frame_time + param_revision + upstream_hash)
- [x] Node trait with self-describing NodeSpec (inputs, outputs, params, UI hints)
- [x] NodeRegistry with factory pattern for node instantiation
- [x] 34 standard nodes across 8 categories (see below)
- [x] Image decoding: PNG, JPEG, BMP, WebP via `image` crate
- [x] Error handling with thiserror-derived CascadeError enum
- [x] 35 passing tests (22 unit + 3 integration + 7 GPU + 3 script compile flow), 0 warnings
- [x] Rayon parallelism for all per-pixel node processing
- [x] Parallel sRGB→u8 conversion with 4096-entry LUT
- [x] Parallel sRGB u8→linear f32 with 256-entry LUT in LoadImage

### GPU Compute Shader System (`cascade-gpu` crate)
- [x] `GpuContext`: wgpu device/queue initialization with `HighPerformance` + `TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES`
- [x] GLSL compute shader template with `process(vec4 color, vec2 uv, ivec2 pixel)` user function
- [x] Naga GLSL→WGSL transpilation pipeline
- [x] `KernelManifest` JSON format: id, display_name, category, inputs, outputs, params, kernel GLSL body
- [x] `GpuKernelNode`: Node trait impl with texture upload, compute dispatch, readback (Rgba16Float)
- [x] Pipeline caching by WGSL source hash (ahash)
- [x] Multi-image inputs (e.g. image + palette), std140 uniform buffer with auto-padding
- [x] Built-in Pixelate+Dither kernel (8×8 Bayer matrix, nearest palette colors, configurable pixel size)
- [x] Helper functions in template: `bayer8()`, `luminance()`
- [x] Row alignment handling for wgpu `COPY_BYTES_PER_ROW_ALIGNMENT`
- [x] Dynamic kernel registration at runtime via `Engine::register_gpu_kernel(json)`
- [x] Auto-load kernels from `kernels/` directory on engine startup
- [x] Tauri IPC `register_gpu_kernel` command for frontend-initiated registration
- [x] Dynamic `nodeTypes` map — new GPU kernels auto-render as ProcessingNode
- [x] 7 GPU tests: GLSL build, transpile, node spec, simple kernel, GPU context init, passthrough E2E, pixelate_dither E2E

### GPU Script Node (user/AI-authored kernels)
- [x] `GpuScriptDraftNode`: placeholder node for uncompiled scripts, one Image in/out by default
- [x] Per-instance unique type_id (`gpu_script::<uuid>`) for independent script compilation
- [x] `Engine::compile_script_node(node_id, manifest_json)`: validates GLSL, transpiles, swaps node instance, prunes stale connections
- [x] `NodeRegistry::register_or_replace()`: hot-swap node type specs at runtime
- [x] `Graph::prune_connections_for_node()`: removes connections to ports that no longer exist after recompilation
- [x] Instance-specific types filtered from `list_node_types()` (only base `gpu_script` shown in sidebar)
- [x] Save/load support: gpu_script nodes re-register draft types on import
- [x] ScriptNodeEditor component in Inspector panel: GLSL code editor (textarea), visual port/param config form, compile button with error display
- [x] AI-assisted kernel generation: Anthropic Claude API integration, system prompt with GLSL template docs, auto-populates form with generated kernel + ports + params
- [x] API key management via localStorage with show/hide toggle
- [x] 3 runtime tests: unique type_id generation, non-script rejection, GPU compile success

### Node Library (34 CPU nodes + GPU kernel nodes)

| Category | Nodes |
|----------|-------|
| Input | LoadImage |
| Output | Viewer |
| Color | BrightnessContrast, HueSaturation, Invert, Levels, Curves, ColorBalance, ChannelShuffle, Threshold, Posterize, Gamma |
| Filter | GaussianBlur, Sharpen, EdgeDetect, Dilate, Erode, Median |
| Composite | Blend (11 modes), AlphaOver |
| Transform | Resize (Nearest/Bilinear/Bicubic), Crop, Flip, Rotate, Translate |
| Generator | SolidColor, Noise, Gradient, Checkerboard |
| Matte | Premultiply, Unpremultiply, SetAlpha, ExtractChannel, ChromaKey |
| GPU | Pixelate+Dither (built-in), user/AI-defined via JSON manifests |

### Tauri Desktop App
- [x] Full Tauri v2 app with cascade-runtime native backend
- [x] 14 IPC commands including batched `set_param_and_render`, `register_gpu_kernel`, and `compile_script_node`
- [x] Binary response protocol for render results
- [x] Timing instrumentation (`[perf]` eprintln)
- [x] Auto-detection of Tauri vs WASM engine via `__TAURI_INTERNALS__`

### WASM Bridge
- [x] wasm-bindgen Engine class exposing all graph operations to JavaScript
- [x] NodeId serialization (SlotMap KeyData -> u64 string)
- [x] serde_wasm_bindgen for complex type conversion (NodeSpec, graph export/import)
- [x] `#[serde(tag = "type", content = "data")]` on UiHint enum for correct JS object shape
- [x] Type-aware parameter conversion from JsValue
- [x] console_error_panic_hook for debug-friendly panics
- [x] Graph export/import for save/load (SerializableGraph, SerializableNode, SerializableConnection)
- [x] Release build: ~1.2MB raw, ~364KB gzipped

### Frontend
- [x] Vite + React + TypeScript app with WASM integration (vite-plugin-wasm + top-level-await)
- [x] @xyflow/react node canvas with custom node components
- [x] Drag-and-drop node creation from categorized library with search
- [x] Dynamic parameter inspector driven by NodeSpec (Slider, NumberInput, Checkbox, FilePicker, Dropdown)
- [x] Dropdown selects for enum-like params (blend mode, interpolation filter, gradient direction, channel selection)
- [x] Viewer panel with canvas rendering, dimension display, and aspect-ratio-aware scaling
- [x] Zustand store synced with engine (all mutations go through engine first)
- [x] TypeScript types mirroring Rust types (ParamValue tagged union, NodeSpec, etc.)
- [x] EngineBridge abstraction with WasmEngine (sync) and TauriEngine (async IPC) implementations
- [x] Dark professional theme with CSS custom properties
- [x] Custom node components: BaseNode, ImageInputNode, ViewerNode, ProcessingNode
- [x] Port colors by type (Image=cyan, Float=green, Mask=orange, etc.)
- [x] Category-tinted node headers (Input=teal, Output=red, Color=purple, Filter=blue, Composite=amber, Transform=cyan, Generator=green, Matte=gray)
- [x] Scrollable Node Library sidebar with collapsible categories
- [x] React StrictMode compatible (WASM init promise deduplication)
- [x] Clean production build

### UX Features
- [x] Blender-style inline NodeSlider: drag-to-scrub, click-to-type, Shift+drag for fine control
- [x] Pointer event isolation — slider drag does NOT move the node (`nopan nodrag nowheel` + pointer capture)
- [x] rAF-throttled live preview during slider drag (requestAnimationFrame, no undo spam)
- [x] Fire-and-forget setParamLive — no blocking awaits in slider hot path
- [x] Single undo snapshot per drag gesture (captured before drag starts, committed on release)
- [x] Node deletion via Delete/Backspace (single and multi-select)
- [x] Edge deletion via Delete/Backspace when edge is selected
- [x] Multi-selection via Shift+click or Shift+drag box
- [x] Cut/Copy/Paste nodes (Ctrl+X/C/V) with relative position preservation
- [x] Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) via state snapshots (max 50 deep)
- [x] Toolbar with Undo/Redo/Save/Load buttons
- [x] Save project (downloads JSON via graph export)
- [x] Load project (imports JSON, rebuilds UI state)
- [x] Edge reconnection — drag from connected handle to reconnect or disconnect
- [x] Auto-disconnect when connecting to an already-occupied input port
- [x] Drop-node-on-edge auto-insert (50px hit slop, port type matching)
- [x] Double-click to add nodes (Tauri webview workaround for drag-and-drop)
- [x] Colored edges matching output port type
- [x] Error display banner in viewer for failed evaluations
- [x] Right-click context menu for adding nodes with search
- [x] Enter selects first search result in context menu
- [x] Drag-from-port-to-empty opens context menu with auto-connect

### Performance Optimizations
- [x] Batched IPC: `set_param_and_render` = 1 IPC call instead of 3 per slider tick
- [x] rAF throttling: `requestAnimationFrame` instead of `setTimeout(50ms)`
- [x] Fire-and-forget setParamLive: no blocking awaits in slider hot path
- [x] Parallel sRGB→u8 conversion with 4096-entry LUT (main bottleneck)
- [x] Parallel sRGB u8→linear f32 with 256-entry LUT in LoadImage
- [x] All pixel processing uses Rayon `par_chunks_exact_mut(4)`
- [x] GaussianBlur: 3-pass box blur approximation, parallel H/V passes, sigma=0 passthrough

### Testing
- [x] Rust: 32 tests passing (graph operations, evaluation, caching, dirty propagation, GPU pipeline)
- [x] E2E: Playwright tests covering full pipeline (load image → process → render → verify pixels)
- [x] All original 6 node types tested independently
- [x] Parameter adjustment triggers re-render (verified pixel changes)
- [x] Inspector shows correct params and description

### Documentation
- [x] ARCHITECTURE.md — full 9-section architecture document
- [x] PROGRESS.md — this file
- [x] PROGRESS.md — this file

---

## Remaining Work

### High Priority

#### Performance
- [x] ~~Proxy resolution during slider interaction (render at lower res while dragging, full res on mouse up)~~
- [ ] Tiled processing for large images (chunk into tiles that fit CPU cache)
- [ ] Background thread rendering (Web Workers for WASM, separate thread for native)
- [x] ~~Memory pressure management (LRU eviction of cached results)~~

#### UX Improvements
- [ ] Node groups / subgraphs (collapse multiple nodes into one)
- [x] ~~Keyboard shortcuts panel~~
- [ ] Zoom to fit / zoom to selection
- [ ] Connection validation preview (highlight compatible ports while dragging)
- [ ] Node search command palette (Ctrl+K or Tab in canvas)
- [ ] Fix drag-and-drop in Tauri webview (currently using double-click workaround)

### Medium Priority

#### GPU Acceleration
- [x] ~~WGSL shader nodes for per-pixel operations~~ — GLSL compute kernels via naga transpile
- [x] ~~`cascade-gpu` crate~~ — Full GPU compute pipeline with wgpu
- [ ] More GPU kernel nodes (bloom, vignette, chromatic aberration, film grain, color LUT)
- [ ] Keep images on GPU between connected GPU nodes (eliminate CPU round-trips)
- [ ] wgpu native viewport for 60fps 4K rendering in Tauri
- [ ] Migrate CPU filter nodes (blur, convolution) to GPU compute shaders

#### AI Nodes
- [ ] Style transfer node (neural style transfer models)
- [ ] Background removal / segmentation node
- [ ] Inpainting node (mask-based content generation)
- [ ] Super-resolution / upscaling node
- [ ] Depth estimation node
- [ ] AI-powered color grading

### Low Priority (Future)

#### Advanced Features
- [ ] Image sequence / video support with timeline
- [ ] Multi-viewer support (multiple viewer panels, split view)
- [ ] Plugin system for third-party nodes (dynamic library loading or WASM plugins)
- [ ] Collaborative editing (CRDT-based graph synchronization)
- [ ] Cloud rendering (offload heavy operations to server)
- [ ] Custom expressions / scripting within nodes
- [ ] Node presets / templates (save and reuse common subgraphs)

---

## Architecture Decisions Log

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| Internal pixel format | f32 RGBA linear | Native CPU ALU width on x86-64 (no f16↔f32 conversion overhead); linear space for physical accuracy; f16 used only at GPU I/O boundaries |
| Graph storage | SlotMap | O(1) insert/remove, stable handles that survive deletions, cache-friendly |
| Evaluation strategy | Pull-based from viewers | Only computes what's needed for display; unused branches are never evaluated |
| Cache key strategy | frame_time + param_revision + upstream_hash | Content-addressable without hashing pixel data; upstream_hash captures transitive dependencies |
| Frontend state | Zustand | Lightweight, no boilerplate, direct mutation API matches engine sync pattern |
| Node canvas | @xyflow/react | Battle-tested node editor, handles pan/zoom/connections, extensible custom nodes |
| WASM integration | wasm-pack + vite-plugin-wasm | Standard toolchain, top-level-await for clean init |
| Color space | Linear throughout, sRGB only at I/O boundaries | Physically correct blending/compositing; avoids gamma-space artifacts |
| Node self-description | NodeSpec with ParamSpec + UiHint | UI is entirely driven by metadata — adding a new node requires zero frontend changes |
| UiHint serde strategy | `#[serde(tag = "type", content = "data")]` | Adjacently tagged enum produces `{type: "Slider"}` matching TS discriminated unions |
| Slider interaction model | Pointer capture + live/commit split | Pointer events prevent node drag; `setParamLive` throttles renders, `setParamCommit` pushes one undo snapshot |
| React Flow state sync | `useState` + `useEffect` from store, `applyNodeChanges`/`applyEdgeChanges` for selection | Preserves React Flow's internal selection state while keeping our store as source of truth for graph data |
| Enum param UI | UiHint::Dropdown(Vec&lt;String&gt;) | Human-readable labels mapped to integer indices; no magic numbers in UI |
| Desktop app | Tauri v2 + cascade-runtime | Native Rust performance with web frontend; batched IPC for slider responsiveness |
| GPU kernel language | GLSL 450 (user writes) → naga → WGSL (wgpu executes) | AI training data is rich with GLSL; naga provides validated transpilation; wgpu runs everywhere |
| GPU kernel format | JSON manifest + GLSL body | Declarative metadata (ports, params, UI hints) + imperative kernel; trivial for AI to generate |
| Dynamic node types | `nodeTypes` built from `nodeSpecs` via useMemo | New GPU kernels auto-render without manual frontend registration |
