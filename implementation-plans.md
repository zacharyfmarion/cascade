# Implementation Plans

## OpenEXR Multi-Layer Support

### Overview

Add OpenEXR multi-layer/multi-pass support to Cascade. Users can load EXR files containing render passes (fog/mist, depth, normals, diffuse, specular, etc.) and work with individual layers via dynamic output ports on the existing LoadImage node — Blender Render Layers style.

**Crate**: `exr = "1.74"` — pure Rust, WASM-compatible, parallel decompression via Rayon, handles all compression formats except DWAA/DWAB.

---

### Section 0: Mask Type Cleanup (Prerequisite)

**Problem**: The current `Mask` type is buggy and redundant:

| Issue | Detail |
|---|---|
| `as_image()` silently rejects Mask | Only matches `Value::Image`, returns `None` for `Value::Mask`. So `get_input_image()` on a Mask-typed port returns `MissingInput` error — nodes can't read their own Mask inputs. |
| Image↔Mask connections blocked | `types_compatible()` has no Image↔Mask clause. You cannot connect an Image output to a Mask input or vice versa. |
| No node creates `Value::Mask` | The ONLY place `Value::Mask(...)` is constructed is `eval.rs` during Field→Mask rasterization. Zero standard nodes ever output it. |
| Every handler treats them identically | All code uses `Value::Image(img) \| Value::Mask(img) =>` — same branch, same logic, no distinction. |

**Solution**: Keep `ValueType::Mask` (for UI port color distinction), delete `Value::Mask` variant entirely.

**Concrete changes (~1-4 hours):**

1. **Delete `Value::Mask(Image)`** from the `Value` enum in `cascade-core/src/types.rs`
2. **`eval.rs`**: Field rasterization always produces `Value::Image`, regardless of port type
3. **`types_compatible()` in `graph.rs`**: Add Image↔Mask bidirectional compatibility:
   ```rust
   (from == Image || from == Mask) && (to == Image || to == Mask)
   ```
4. **Simplify** all `Value::Image(img) | Value::Mask(img) =>` patterns to just `Value::Image(img) =>` across:
   - `eval.rs` (6 places)
   - `kernel_node.rs` (2 places)
   - `cascade-wasm/src/lib.rs` (1 place)
   - `types.rs` estimate_bytes (1 place)
5. **Serialization**: Migration shim to deserialize old `Value::Mask` as `Value::Image`
6. **Frontend**: No changes needed — `ValueType::Mask` still exists for port colors
7. **Tests**: Add regression tests:
   - Image→Mask and Mask→Image connections succeed
   - `get_input_image()` succeeds on Mask-typed ports
   - Existing Mask-using nodes still evaluate correctly

**EXR impact**: Single-channel EXR layers (depth, mist, AO) get `ValueType::Mask` port annotation (different handle color) but materialize as `Value::Image` at runtime. Connect freely to any Image input.

**Future**: True single-channel Mask type (1 float per pixel, 4× memory savings) can be added later if memory pressure from large EXR AOVs becomes an issue. Not worth the refactor now — every node assumes 4-channel.

---

### Section 1: Core Data Model

New module: `crates/cascade-core/src/exr.rs`

```rust
/// How a layer maps to the existing type system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExrLayerKind {
    Rgba,  // ≥3 channels with recognizable RGBA-like names → ValueType::Image
    Mask,  // 1 channel (depth, mist, AO, etc.)            → ValueType::Mask
}

/// Which channels from the EXR layer map to which RGBA slot.
#[derive(Clone, Debug)]
pub struct ExrChannelSet {
    pub r: Option<String>,  // EXR channel name mapped to R
    pub g: Option<String>,  // mapped to G
    pub b: Option<String>,  // mapped to B
    pub a: Option<String>,  // mapped to A (None → fill 1.0)
}

/// Metadata for one layer — NO pixel data.
#[derive(Clone, Debug)]
pub struct ExrLayerDescriptor {
    pub layer_name: String,     // Original EXR name (e.g., "ViewLayer.Mist")
    pub port_name: String,      // Sanitized stable port ID (e.g., "viewlayer_mist")
    pub label: String,          // Display label (e.g., "Mist")
    pub kind: ExrLayerKind,
    pub width: u32,
    pub height: u32,
    pub channel_set: ExrChannelSet,
}

/// Parsed EXR file manifest — everything needed to build dynamic outputs.
#[derive(Clone, Debug)]
pub struct ExrMetadata {
    pub primary_width: u32,
    pub primary_height: u32,
    pub layers: Vec<ExrLayerDescriptor>,
    pub primary_layer_port: Option<String>,  // port_name of the "default" RGBA layer
}
```

**Layer-to-output mapping rules** (Blender-style, per-layer granularity):

| EXR Channels | Output Type | Mapping |
|---|---|---|
| R, G, B, A | `Image` | Direct RGBA |
| R, G, B (no A) | `Image` | RGB + A=1.0 |
| X, Y, Z | `Image` | Map to RGB (normals) |
| Y only | `Mask` | Grayscale |
| Y, A | `Image` | Replicate Y→RGB, use A |
| Z only (depth) | `Mask` | Grayscale |
| Single arbitrary channel | `Mask` | Grayscale |
| YCA (chroma subsampled) | *Skipped* | Warning toast |

**New Value/ValueType additions:**

```rust
// In ValueType enum:
Bytes,  // For SaveExr binary output

// In Value enum:
Bytes(Arc<Vec<u8>>),  // EXR file bytes for export
```

---

### Section 2: Dynamic Port Infrastructure

This is the biggest architectural change. Currently `graph.rs:connect()` validates ports against the registry (type-level) spec. It needs to validate against the node **instance** spec.

#### 2a. SpecProvider Trait

```rust
// cascade-core/src/graph.rs (or new spec_provider.rs)

/// Abstraction for querying a node's current spec — instance-aware.
pub trait SpecProvider {
    fn get_node_spec(&self, node_id: NodeId) -> Result<NodeSpec, CascadeError>;
}
```

Engine implements `SpecProvider` by looking up the node instance and calling `spec()`.

#### 2b. graph.rs Changes

```rust
// connect() signature change:
pub fn connect(
    &mut self,
    from_id: NodeId, from_port: &str,
    to_id: NodeId, to_port: &str,
    spec_provider: &dyn SpecProvider,  // NEW — replaces registry lookup
) -> Result<(), CascadeError>

// prune_connections_for_node() returns what was removed:
pub fn prune_connections_for_node(
    &mut self,
    node_id: NodeId,
    spec_provider: &dyn SpecProvider,
) -> Vec<PrunedConnection>

#[derive(Clone, Debug)]
pub struct PrunedConnection {
    pub from_node: NodeId,
    pub from_port: String,
    pub to_node: NodeId,
    pub to_port: String,
}
```

#### 2c. Evaluator Changes

```rust
// Cache key incorporates output schema:
impl NodeSpec {
    pub fn outputs_signature_hash(&self) -> u64 {
        // Hash output port names + types — changes when dynamic ports change
        let mut hasher = ahash::AHasher::default();
        for out in &self.outputs {
            out.name.hash(&mut hasher);
            out.ty.hash(&mut hasher);
        }
        hasher.finish()
    }
}
```

The evaluator uses the live instance spec (via `SpecProvider`) instead of registry spec. Cache entries are invalidated when `outputs_signature_hash()` changes.

#### 2d. WASM Bridge

```rust
// New function:
#[wasm_bindgen]
pub fn get_node_spec(&self, node_id: &str) -> Result<JsValue, JsValue>

// Modified set_load_image_data to return interface changes:
#[wasm_bindgen]
pub fn set_load_image_data(
    &mut self, node_id: &str, data: &[u8]
) -> Result<JsValue, JsValue>
// Returns NodeInterfaceChangeWasm:
```

```rust
#[derive(Serialize)]
pub struct NodeInterfaceChangeWasm {
    pub new_spec: NodeSpecWasm,
    pub removed_output_ports: Vec<String>,
    pub pruned_connections: Vec<PrunedConnectionWasm>,
}
```

#### 2e. Frontend

**Zustand store** gains `nodeSpecsById: Map<string, NodeSpec>` — per-instance specs override the type-level specs.

```typescript
// store/graphStore/slices/graphSlice.ts
applyNodeInterfaceChange(nodeId: string, change: NodeInterfaceChange): void {
    // 1. Update nodeSpecsById with new_spec
    // 2. Remove edges for pruned_connections
    // 3. Push toast for each removed connection:
    //    "Layer '{port}' no longer available — disconnected from {target_node}"
    // 4. Trigger React Flow re-render
}
```

**BaseNode.tsx** reads from `nodeSpecsById[id] ?? typeSpec` — instance spec takes priority, falling back to the default type spec for non-dynamic nodes.

---

### Section 3: LoadImage Node Changes

#### 3a. EXR Detection

```rust
// In set_image_data():
fn is_exr(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0..4] == [0x76, 0x2f, 0x31, 0x01]
}
```

#### 3b. Extended Internal State

```rust
pub struct LoadImage {
    parsed: Mutex<ParsedImage>,
    original_bytes: Mutex<Option<Arc<Vec<u8>>>>,
    decode_cache: Mutex<HashMap<String, Arc<Image>>>,  // port_name → decoded Image
    content_hash: Mutex<Option<[u8; 32]>>,
}

enum ParsedImage {
    Empty,
    Standard(Image),
    Exr {
        metadata: ExrMetadata,
        // Pixel decode happens lazily in evaluate()
    },
}
```

#### 3c. set_image_data Flow

```
bytes arrive
  → is_exr()?
    YES → parse_exr_metadata(bytes) → store ExrMetadata + raw bytes
          → rebuild spec (dynamic outputs per layer)
          → return list of removed ports (if previous EXR had different layers)
    NO  → image::load_from_memory() → sRGB→linear → store Image (existing path)
          → rebuild spec (just "image" output)
          → return list of removed ports (if was previously EXR)
```

**`parse_exr_metadata`** uses the `exr` crate to read headers only (no pixel decompression):

```rust
pub fn parse_exr_metadata(bytes: &[u8]) -> Result<ExrMetadata, CascadeError> {
    let reader = exr::meta::read_all_meta_data(
        &mut std::io::Cursor::new(bytes)
    ).map_err(|e| CascadeError::ExrMetadata(e.to_string()))?;
    // Extract layer descriptors from header metadata
    // Build ExrLayerDescriptor for each usable layer
    // Determine primary layer
}
```

#### 3d. spec() Dynamic Outputs

```rust
fn spec(&self) -> NodeSpec {
    let mut outputs = vec![
        PortSpec {
            name: "image".into(),
            label: "Image".into(),
            ty: ValueType::Image,
            ..Default::default()
        },
    ];

    if let ParsedImage::Exr { ref metadata, .. } = *self.parsed.lock() {
        for layer in &metadata.layers {
            // Skip if this layer IS the primary (already mapped to "image")
            if Some(&layer.port_name) == metadata.primary_layer_port.as_ref() {
                continue;
            }
            outputs.push(PortSpec {
                name: layer.port_name.clone(),
                label: layer.label.clone(),
                ty: match layer.kind {
                    ExrLayerKind::Rgba => ValueType::Image,
                    ExrLayerKind::Mask => ValueType::Mask,
                },
                ..Default::default()
            });
        }
    }

    NodeSpec {
        id: "load_image".into(),
        display_name: "Load Image".into(),
        category: "Input".into(),
        outputs,
        params: vec![/* existing image_data param */],
        ..Default::default()
    }
}
```

#### 3e. evaluate() — Lazy Decode

```rust
fn evaluate(&self, ctx: &EvalContext) -> NodeFuture {
    // 1. Determine which output port is being pulled
    // 2. For Standard: return existing Image clone
    // 3. For Exr:
    //    a. Check decode_cache for this port_name
    //    b. If cached → return clone
    //    c. If not → decode just this layer from raw bytes:
    //       - exr::prelude::read()...specific_channels()...from_buffered()
    //       - Map channels to f32 RGBA (or single-channel replicated for Mask)
    //       - Convert to Image via from_f32_data()
    //       - Cache in decode_cache
    //       - Return
}
```

#### 3f. Primary Layer Selection

Priority order:
1. Layer with empty name containing R, G, B, A channels
2. Layer named "Combined" or "rgba" with RGBA channels
3. First layer with ≥3 RGBA-like channels
4. If no qualifying layer → `ExrNoUsablePrimaryLayer` error

---

### Section 4: Toast Notification System

#### 4a. Zustand Slice

```typescript
// store/graphStore/slices/toastSlice.ts

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
    id: string;           // crypto.randomUUID()
    kind: ToastKind;
    title: string;
    message?: string;
    createdAt: number;
    timeoutMs: number;    // default 5000, error = 8000
}

export interface ToastSlice {
    toasts: Toast[];
    pushToast: (kind: ToastKind, title: string, message?: string) => void;
    dismissToast: (id: string) => void;
    clearToasts: () => void;
}
```

#### 4b. ToastHost Component

```
src/components/ui/ToastHost.tsx
src/styles/toast.css
```

- Positioned `fixed` bottom-right, stacks upward
- Lucide icons: `Info`, `CheckCircle2`, `AlertTriangle`, `AlertCircle`
- Auto-dismiss via `setTimeout`, progress bar animation
- CSS custom properties in `theme.css`:

```css
/* theme.css additions */
--toast-bg: var(--color-surface-2);
--toast-border: var(--color-border);
--toast-text: var(--color-text);
--toast-info-accent: var(--color-info);
--toast-success-accent: var(--color-success);
--toast-warning-accent: var(--color-warning);
--toast-error-accent: var(--color-error);
```

#### 4c. Integration Points

| Event | Toast |
|---|---|
| EXR file swap removes layers | `info`: "Layer 'Mist' no longer available — disconnected from Blur node" |
| EXR decode error | `error`: "Failed to read EXR: {detail}" |
| Unsupported layer skipped | `warning`: "Layer 'crypto00' uses unsupported channel format — skipped" |
| Layer too large | `warning`: "Layer 'beauty' (32768×16384) exceeds max dimensions — skipped" |
| Memory limit exceeded | `error`: "EXR decode would require ~4.2 GB — exceeds 512 MB limit" |
| SaveExr export complete | `success`: "EXR exported successfully" |

---

### Section 5: Error Handling

#### New CascadeError Variants

```rust
pub enum CascadeError {
    // ... existing ...

    /// EXR header/metadata parsing failed
    ExrMetadata(String),

    /// EXR pixel decode failed (corrupted scanlines, bad compression, etc.)
    ExrDecode(String),

    /// Layer uses unsupported feature (YCA subsampling, deep data, etc.)
    ExrUnsupportedLayer { layer_name: String, reason: String },

    /// No layer qualifies as the primary RGBA output
    ExrNoUsablePrimaryLayer,

    /// Layer dimensions exceed MAX_IMAGE_DIM
    ExrLayerTooLarge { layer_name: String, width: u32, height: u32, max: u32 },

    /// Expected Bytes value, got something else (SaveExr pipeline)
    ValueNotBytes { got: ValueType },
}
```

#### Error Policies

| Situation | Policy |
|---|---|
| Corrupted/truncated file | `ExrMetadata` or `ExrDecode` → error toast, node shows error badge |
| Deep data EXR | `ExrUnsupportedLayer` for each deep layer → warning toast, layers skipped |
| DWAA/DWAB compression (exr crate limitation) | `ExrDecode` → error toast |
| Layer exceeds MAX_IMAGE_DIM | `ExrLayerTooLarge` → warning toast, port still appears but evaluate() returns error |
| No usable primary layer | `ExrNoUsablePrimaryLayer` → error toast, "image" output returns error on pull |
| f16 NaN / Inf / denormals | **Preserved as-is** in f32. Display path clamps for viewing. VFX pipelines use these intentionally. |
| Mixed pixel types within file | Normalize all to f32 via `values_as_f32()` — transparent to user |
| Memory limit exceeded | Estimate `Σ(w × h × channels × 4)` before decode. If over limit → `ExrDecode("estimated N bytes exceeds limit")` |

---

### Section 6: SaveExr Node

```rust
pub struct SaveExr;

impl Node for SaveExr {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "save_exr".into(),
            display_name: "Save EXR".into(),
            category: "Output".into(),
            inputs: vec![
                PortSpec { name: "image".into(), label: "Image".into(), ty: ValueType::Image, .. },
                // Additional layers added via params:
            ],
            outputs: vec![
                PortSpec { name: "exr_bytes".into(), label: "EXR".into(), ty: ValueType::Bytes, .. },
            ],
            params: vec![
                ParamSpec { key: "compression".into(), ui_hint: Some(UiHint::Dropdown(
                    vec!["PIZ", "ZIP", "ZIPS", "RLE", "None"]
                )), .. },
                ParamSpec { key: "layer_count".into(), ty: ParamDefault::Int(1), ui_hint: Some(UiHint::NumberInput), .. },
                // Per-layer name params generated dynamically
            ],
        }
    }
}
```

**WASM export path:**
1. Frontend calls `evaluate_bytes_output(node_id, "exr_bytes")`
2. WASM returns `Vec<u8>` (the encoded EXR file)
3. Frontend creates `Blob` + `URL.createObjectURL()` → triggers download

---

### Section 7: Performance

| Concern | Strategy |
|---|---|
| **Header parse** | `exr::meta::read_all_meta_data()` — microseconds, no pixel decode |
| **Lazy pixel decode** | Only layers whose output ports are actually connected + evaluated get decoded |
| **Per-layer cache** | `decode_cache: HashMap<String, Arc<Image>>` — keyed by port_name, invalidated on `content_hash` change |
| **Parallel decode** | `exr` crate decompresses scanlines/tiles via Rayon (native). WASM falls back to single-threaded. |
| **Memory budget** | Default 512MB native, 256MB WASM. Estimate before decode: `Σ(w × h × 4 × 4)` bytes per decoded layer. |
| **Cache invalidation** | New file bytes → new `content_hash` (blake3) → drop entire `decode_cache` → mark dirty downstream |
| **Large files** | 100MB+ EXR file stored as `Arc<Vec<u8>>` — single allocation, shared across lazy decodes |

---

### Section 8: Edge Cases

| Case | Handling |
|---|---|
| **Single-layer EXR** | Only `image` output port appears. Behaves identically to loading a PNG. |
| **Y (luminance) only** | Maps to `Mask` output (single channel replicated to RGBA). |
| **Y + A** | Maps to `Image` output (Y→RGB, A→A). |
| **YCA (chroma subsampled)** | Skipped with warning toast. Not worth the complexity for a rare format. |
| **Non-standard layer names** | Label preserves original name. Port name sanitized: lowercase, non-alphanumeric→`_`, deduplicated with suffix. |
| **f16 NaN / Inf / -0.0** | Preserved in f32 data. Display pipeline clamps. Users can add explicit clamp/sanitize nodes. |
| **Layer > MAX_IMAGE_DIM** | Port still appears. `evaluate()` returns `ExrLayerTooLarge`. Warning toast on load. |
| **Mixed pixel types** | All converted to f32 via `values_as_f32()`. Transparent. |
| **Tiled vs scanline** | `exr` crate abstracts this. No special handling needed. |
| **File swap (different layers)** | Auto-prune connections to disappeared ports. Info toast per broken connection. New ports appear. |
| **Same file re-upload** | Compare `content_hash`. If identical → no-op (cache preserved). If different → full re-parse. |
| **LoadImageSequence + EXR** | Interface built from first frame's layers. Stable across frames. If a later frame is missing a layer → warning toast, output returns black Image/zero Mask for that frame. Path change → full re-parse + prune. |
| **Empty EXR (no layers)** | `ExrNoUsablePrimaryLayer` error. Node shows error badge. Only default `image` port, returns error on pull. |

---

### Section 9: Implementation Phases

| Phase | Scope | Depends On |
|---|---|---|
| **Phase 0: Mask Type Cleanup** ✅ | Delete `Value::Mask`, fix `types_compatible()` for Image↔Mask, simplify all match arms, add regression tests | Nothing |
| **Phase 1: Toast System** ✅ | `ToastSlice`, `ToastHost` component, CSS vars, `pushToast()` wired up | Nothing — frontend only |
| **Phase 2: Per-Instance Spec Plumbing** ✅ | `SpecProvider` trait, `graph.rs` connect/prune changes, `PrunedConnection` return, `InstanceAwareSpecProvider`, `Arc<NodeRegistry>` impl | Phase 1 |
| **Phase 3: EXR Metadata + Dynamic Outputs** ✅ | `exr` crate dependency, `exr.rs` module with core types + `parse_exr_metadata()`, new `CascadeError` variants, 12 unit tests | Phase 2 |
| **Phase 4+5: LoadImage EXR Integration + Pixel Decode** ✅ | LoadImage EXR detection via magic bytes, `ParsedImage` enum, dynamic `spec()` outputs per layer, lazy `decode_exr_layer()` with per-port cache, channel-to-RGBA mapping, `set_image_data()` returns removed ports | Phase 3 |
| **Phase 6: LoadImageSequence** | EXR detection in sequence loader, interface from first frame, per-frame decode, missing-layer fallback | Phase 5 |
| **Phase 7: SaveExr + Bytes ValueType** | `ValueType::Bytes`, `Value::Bytes`, `SaveExr` node, `encode_multilayer_exr()`, WASM blob export, download trigger | Phase 5 |

**Testing strategy per phase:**
- Phase 0: Unit tests — Image→Mask and Mask→Image connections pass; get_input_image() on Mask-typed port succeeds; existing Mask-using nodes evaluate correctly
- Phase 1: Visual test — push toasts of each kind, verify auto-dismiss
- Phase 2: Unit test — `SpecProvider` mock, connect/prune with dynamic specs, cache invalidation on hash change
- Phase 3: Unit test — `parse_exr_metadata()` with fixture EXRs (single-layer, multi-layer, weird names, oversized, empty)
- Phase 4: Integration test — swap EXR files, verify connections pruned and toasts fired
- Phase 5: Integration test — decode known fixture EXRs, compare pixel values against reference
- Phase 6: Sequence test — frame range with varying layers
- Phase 7: Round-trip test — load EXR → process → save → reload → compare

---

### Section 10: Tradeoffs & Risks

| Decision | Risk | Mitigation |
|---|---|---|
| **Dynamic ports on LoadImage** (vs separate LoadExr node) | Increases LoadImage complexity significantly | Clear `ParsedImage` enum separation. Standard path unchanged. |
| **Instance-aware SpecProvider** | Every `connect()` call now needs instance access (perf) | `spec()` is cheap (returns cached struct). No pixel decode in spec path. |
| **Lazy decode** | First evaluate() of a layer has decode latency | Show loading indicator on viewer. Cache means subsequent evaluations are instant. |
| **Preserving NaN/Inf** | May surprise users expecting clamped values | Document in node tooltip. Add explicit Sanitize node later if needed. |
| **Auto-disconnect on layer disappear** | Could break complex graphs unexpectedly | Toast notification explains exactly what happened + which nodes affected. Undo stack preserves previous state. |
| **exr crate DWAA/DWAB limitation** | Some studio EXRs use these compressions | Error toast explains the limitation. Can revisit if `exr` crate adds support. |
| **Mask as semantic alias (not true 1ch)** | 4× memory overhead for single-channel AOVs | Acceptable for now. True 1ch Mask is a future optimization if memory becomes an issue. |

#### Explicitly NOT Supporting (and why)

| Feature | Reason |
|---|---|
| **Deep EXR data** | Fundamentally different data model (samples-per-pixel). Would require new pipeline. |
| **YCA chroma subsampling** | Extremely rare. Reconstruction is complex. Skip with warning. |
| **Per-channel output ports** | Blender uses per-layer granularity. Per-channel would create dozens of ports. Users can use existing SeparateRGBA node on extracted layers. |
| **Native N-channel processing** | Would require replacing `Image` (always RGBA) with a tensor type. Massive refactor. Layers are converted to RGBA at extraction time instead. |

#### Future Extensibility

- **Selective decode param**: If memory is tight, add a multi-select param to choose which layers to decode
- **Layer preview thumbnails**: Small decode (quarter-res) for inspector panel — deferred, not in MVP
- **Cryptomatte support**: Special handling for `Crypto*` layers — separate feature, builds on this foundation
- **OCIO color space per layer**: EXR metadata can specify color space per channel — hook into existing `cascade-ocio` when ready
- **True single-channel Mask**: If memory pressure from large EXR AOVs becomes an issue, `Mask` could become a real 1-float-per-pixel type. Escalation triggers: multiple 4K+ AOVs in a single graph; WASM memory ceiling hit.
