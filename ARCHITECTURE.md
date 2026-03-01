# Architecture

## 1. Overview
- Node-based image compositor inspired by Nuke/Blender compositor
- Rust core compiled to WASM for browser, will also compile native for Tauri desktop
- Goal: blazing-fast compositing with AI-powered nodes in the future

## 2. Project Structure
```
compositor/
├── Cargo.toml                    # Workspace: 3 crates
├── .cargo/config.toml            # getrandom_backend="wasm_js" for WASM target
├── crates/
│   ├── compositor-core/          # Graph, evaluator, node trait, types
│   ├── compositor-nodes-std/     # 6 built-in nodes
│   └── compositor-wasm/          # wasm-bindgen bridge
├── apps/
│   └── web/                      # React + Vite frontend
│       ├── src/
│       │   ├── components/       # React components
│       │   ├── engine/           # WASM bridge layer
│       │   ├── store/            # Zustand state management
│       │   └── wasm-pkg/         # wasm-pack build output
│       └── public/test-image.png
└── tests/                        # Integration tests
```

## 3. Core Architecture (Rust)

### Image Format
- Internal format: f32 RGBA linear color space
- `Image { width: u32, height: u32, data: Arc<Vec<f32>> }`
- `Arc` enables cheap cloning through the graph — images are immutable once created
- All processing happens in linear color space for physical accuracy
- Color pipeline: sRGB u8 (file) → linear f32 (on load via sRGB transfer function) → processing → linear f32 → sRGB u8 (on display via inverse transfer function)
- f16 is used only at GPU I/O boundaries (`to_f16_bytes()` / `from_f16_data()`) for wgpu texture upload/readback

### Graph (graph.rs)
- `NodeId`: SlotMap key type — stable handles that survive deletions
- `NodeInstance`: id, type_id, params (HashMap<String, ParamValue>), position, param_revision (u64)
- `Connection`: from_node/port → to_node/port
- `Graph`: SlotMap<NodeId, NodeInstance> + Vec<Connection> + dirty_nodes HashSet
- Cycle detection via has_path() DFS before adding connections
- Type checking on connect: output port type must match input port type
- Single-input constraint: connecting to an already-connected input replaces the old connection
- Dirty propagation: setting a param marks that node + all downstream nodes dirty

### Evaluator (eval.rs)
- Pull-based: evaluation starts from a viewer node and pulls upstream
- Postorder DFS traversal: visit_postorder walks inputs recursively, pushes to order list
- Nodes processed in topological order (sources first, viewers last)
- Per-output caching with CacheKey { frame_time, param_revision, upstream_hash }
  - frame_time: for future animation/sequence support
  - param_revision: u64 counter incremented on each param change
  - upstream_hash: AHash of all upstream CacheKeys (recursive content-based)
- Cache hit: skipped if node is NOT dirty AND all output CacheKeys match
- Cache miss: evaluates node, stores results in cache HashMap<(NodeId, String), (CacheKey, Value)>
- After evaluation, clears dirty flag on node
- merge_params: merges instance params with spec defaults (instance params override)

### Node Trait (node.rs)
```rust
pub trait Node: Send + Sync + Any {
    fn spec(&self) -> NodeSpec;
    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError>;
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
```
- `EvalContext`: provides inputs (HashMap<String, Value>), params (&HashMap<String, ParamValue>), frame_time
- Helper methods: get_input_image(), get_param_float(), get_param_int(), get_param_bool(), get_param_string()
- `NodeRegistry`: HashMap of factory functions (Fn() -> Box<dyn Node>) + cached specs
- register() creates one instance to capture spec, then stores factory

### Type System (types.rs)
- `ValueType` enum: Image, Mask, Float, Int, Bool, Color
- `Value` enum: the actual runtime values flowing through connections
- `ParamSpec`: key, label, type, default, min/max/step, UiHint
- `UiHint` enum: Slider, NumberInput, Checkbox, ColorPicker, Dropdown(Vec<String>), FilePicker, Hidden
- `NodeSpec`: id, display_name, category, description, inputs/outputs (Vec<PortSpec>), params (Vec<ParamSpec>)
  - This is the self-describing metadata that drives the UI — nodes declare their own UI requirements

### Error Handling (error.rs)
- `CompositorError` enum with thiserror derive
- Variants: NodeNotFound, MissingInput, MissingParam, TypeMismatch, CycleDetected, InvalidConnection, ImageDecode, PortNotFound, Other

## 4. Standard Nodes (compositor-nodes-std)

6 nodes registered via `register_standard_nodes()`:

| Node | Category | Inputs | Outputs | Params | Notes |
|------|----------|--------|---------|--------|-------|
| LoadImage | Input | — | image (Image) | image_data (Hidden) | Mutex-wrapped state; set_image_data() decodes PNG/JPEG/BMP/WebP via `image` crate, converts sRGB u8 → linear f32 |
| Viewer | Output | image (Image) | display (Image) | — | Passthrough; image_to_rgba8() converts linear f32 → sRGB u8 for display |
| BrightnessContrast | Color | image (Image) | image (Image) | brightness [-1,1], contrast [-1,1] | Per-pixel: v = (v - 0.5) * (1 + contrast) + 0.5 + brightness, clamped |
| HueSaturation | Color | image (Image) | image (Image) | hue [-180°,180°], saturation [-1,1], value [-1,1] | RGB→HSL, shift hue/sat/lightness, HSL→RGB |
| Invert | Color | image (Image) | image (Image) | — | Per-channel: 1.0 - value (alpha preserved) |
| GaussianBlur | Filter | image (Image) | image (Image) | sigma [0.1, 100] | Separable 2-pass (horizontal then vertical), kernel radius = ceil(3σ), edge clamping |

### Adding a Custom Node
1. Create a struct implementing the `Node` trait
2. Define `spec()` with inputs, outputs, params, and UI hints
3. Implement `evaluate()` — read inputs via EvalContext, write outputs to HashMap
4. Register with `registry.register("my_node", || Box::new(MyNode::new()))`
5. The frontend will automatically render it with appropriate controls based on the spec

## 5. WASM Bridge (compositor-wasm)

### Architecture
- `Engine` struct wraps Graph + NodeRegistry + HashMap<NodeId, Box<dyn Node>> + Evaluator
- All methods are `#[wasm_bindgen]` — callable from JS
- NodeId serialization: SlotMap KeyData → u64 → String (decimal) on the JS side
- JsValue conversion: `serde_wasm_bindgen` for complex types (NodeSpec lists, graph export)
- Raw `Vec<u8>` for pixel data (direct memory sharing, no serialization overhead)

### Key Methods
- `new()`: creates Engine with registered standard nodes + console_error_panic_hook
- `list_node_types()`: returns all NodeSpecs as JsValue
- `add_node(type_id, x, y)`: creates node in graph + instantiates via registry, returns string ID
- `remove_node(node_id)`: removes from graph + instances map
- `connect(from, from_port, to, to_port)`: validates types, checks cycles, connects
- `set_param(node_id, key, value)`: type-aware param conversion (uses spec to determine type)
- `load_image_data(node_id, data)`: downcasts to LoadImage via as_any_mut(), calls set_image_data()
- `render_viewer(viewer_id)`: evaluates graph from viewer, converts result to rgba8
- `get_render_dimensions(viewer_id)`: returns {width, height} for a viewer
- `export_graph() / import_graph(json)`: serialization for save/load

### WASM Build
- Built with `wasm-pack build --target web --release` from `crates/compositor-wasm/`
- Output goes to `apps/web/src/wasm-pkg/`
- `.cargo/config.toml` sets `getrandom_backend="wasm_js"` for the wasm32 target
- Production WASM binary: ~711KB raw, ~276KB gzipped

## 6. Frontend Architecture (React + TypeScript)

### Stack
- Vite with `vite-plugin-wasm` + `vite-plugin-top-level-await`
- React 18+ with StrictMode
- @xyflow/react for the node canvas (formerly React Flow)
- Zustand for state management
- CSS custom properties for theming

### Layout
Three-column layout: NodeLibrary (240px) | NodeCanvas (flex) | Inspector + Viewer (280px)

### State Management (Zustand — graphStore.ts)
- Single store is the source of truth for UI state
- All mutations sync to WASM engine first, then update local state
- `nodes: Map<string, NodeInstance>` — mirrors WASM graph
- `connections: Connection[]` — with client-generated UUIDs
- `renderResults: Map<string, RenderResult>` — cached viewer outputs
- `triggerAllViewers()`: called after connect/disconnect/setParam/loadImage — re-renders every viewer node
- Dev mode: `window.__compositorStore` exposed for Playwright testing

### Type System (types.ts)
- TypeScript types mirror Rust types exactly: NodeSpec, ParamSpec, ParamValue, etc.
- `ParamValue` is a tagged union: `{ Float: number } | { Int: number } | { Bool: boolean } | ...`
- `extractParamValue()` / `createParamValue()` helpers for conversion

### Engine Bridge (bridge.ts + wasmEngine.ts)
- `EngineBridge` interface: abstraction allowing WASM, native (Tauri), or mock implementations
- `WasmEngine` class implements EngineBridge, delegates to WASM Engine
- `initWasmEngine()`: promise-based deduplication prevents React StrictMode race condition
  - StrictMode double-fires useEffect — without dedup, two concurrent init() + new Engine() calls corrupt wasm-bindgen's internal Rc refcount
  - Fix: `if (initPromise) return initPromise;` — second call reuses the same promise

### Components
- **NodeCanvas**: ReactFlow wrapper with custom nodeTypes map, drag-drop from library, snap-to-grid
- **NodeLibrary**: categorized sidebar with search, drag-to-create via dataTransfer
- **Inspector**: dynamic param controls driven by NodeSpec (Slider for Float with min/max, Checkbox for Bool, etc.)
- **Viewer**: canvas element rendering from renderResults, auto-selects viewer nodes, shows dimensions
- **Custom Nodes** (nodes/):
  - `BaseNode`: shared wrapper with typed input/output handles, port colors by type (Image=cyan, Float=green, etc.)
  - `ImageInputNode`: file drop/click with thumbnail preview
  - `ViewerNode`: inline canvas preview subscribing to renderResults
  - `ProcessingNode`: shows first 2 param values inline

### Theme
- Dark professional theme via CSS custom properties
- Deep blue/purple palette (#0d0f1a background, #1a1d2e surfaces)
- Port colors by type: Image=#00d4ff, Float=#00ff88, Mask=#ff6600, etc.

## 7. Data Flow

Complete render cycle:
```
User drops image file
  → File.arrayBuffer() → Uint8Array
    → wasmEngine.loadImageData(nodeId, data)
      → LoadImage.set_image_data(bytes)
        → image crate decodes PNG/JPEG/BMP/WebP
        → sRGB u8 → linear f32 conversion per pixel
        → stored in Mutex<Option<Image>>
    → triggerAllViewers()
      → for each viewer node:
        → wasmEngine.renderViewer(viewerId)
          → Evaluator.evaluate(graph, registry, nodes, viewerId, "display", frame_time)
            → visit_postorder: LoadImage → [processing nodes...] → Viewer
            → for each node in order:
              → check CacheKey: (frame_time, param_revision, upstream_hash)
              → cache miss? evaluate node:
                → collect inputs from upstream cache
                → merge params (instance overrides + spec defaults)
                → node.evaluate(ctx) → HashMap<String, Value>
                → store outputs in cache
            → return Viewer's "display" output
          → Viewer::image_to_rgba8(image) — linear f32 → sRGB u8
          → return Vec<u8> to JS
        → create RenderResult { nodeId, width, height, pixels: Uint8ClampedArray }
        → store in renderResults Map
      → React re-renders Viewer + ViewerNode components
        → canvas.putImageData(new ImageData(pixels, width, height))
```

## 8. Testing

### Rust Tests (25 total, 0 warnings)
- `compositor-core/src/graph.rs`: 17 unit tests (add/remove, connect/disconnect, cycle detection, type mismatch, dirty propagation, param revision, get_upstream/downstream)
- `compositor-core/src/eval.rs`: 5 unit tests (chain evaluation, cache hit/miss, param change invalidation, frame_time changes)
- `tests/basic.rs`: 3 integration tests (full pipeline through standard nodes)

### E2E Tests (Playwright)
- App loads and WASM initializes
- All 6 node types appear in library
- Node creation, connection, parameter adjustment
- Full render pipeline with actual pixel verification
- Inspector displays correct params
- Zero console errors

## 9. Performance Considerations

### Current Optimizations
- f32 format: native CPU ALU width — no conversion overhead on x86-64 (f16 requires F16C convert instructions, no native f16 arithmetic)
- Arc<Vec<f32>>: cheap clone through graph (reference counted, no deep copy)
- Per-output caching: unchanged subgraphs are never re-evaluated
- Content-based cache keys: upstream_hash captures the full upstream state
- Separable Gaussian blur: O(n·k) per pass instead of O(n·k²) for 2D kernel

### Planned Optimizations (not yet implemented)
- Rayon parallelism for per-pixel operations in native builds
- Proxy resolution during slider interaction (lower res while dragging, full res on release)
- WGSL shader nodes for GPU-accelerated processing
- wgpu native viewport for 60fps 4K rendering in Tauri
- Tiled processing for large images (process in tiles to fit cache)
