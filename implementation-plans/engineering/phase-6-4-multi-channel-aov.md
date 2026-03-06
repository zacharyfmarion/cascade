# Phase 6.4 — Multi-channel / AOV system (Implementation Plan)

## 1) Goal and scope

### Goal
Enable a single `Image` value to carry **N named channels** (AOVs) in addition to (or instead of) the traditional RGBA quartet, while preserving Cascade's existing "RGBA-first" workflows and performance characteristics.

### In-scope workflows
- **EXR round-trip fidelity**: load multi-layer/multi-channel EXR → process (at least RGBA) → save EXR with original auxiliary channels intact.
- **AOV-aware nodes**:
  - Nodes that operate on **specific channels** (e.g., grade only `beauty.RGB`, normalize `N`, remap `Z`).
  - Nodes that **extract/pack/merge** channels (e.g., Extract `Z` → view, Merge `N.XYZ` into RGB for debug).
- **Viewer channel inspection**: choose which channel(s) to display (RGBA composite or single-channel display).

### Non-goals (explicitly out of Phase 6.4)
- Per-channel **color management** rules beyond "color channels use image color space; data AOVs are raw linear scalars/vectors".
- Different resolutions/data windows per channel, deep EXR, multipart EXR with different sizes, time-sampled AOVs.
- Full GPU support for arbitrary channel counts (Phase 6.4 will preserve GPU nodes as RGBA-centric; see §6).

---

## 2) Image struct redesign

### Primary recommendation: **Interleaved variable-stride storage + named channel metadata**
Keep the existing mental model (one contiguous float buffer, SIMD/Rayon-friendly) but generalize stride from `4` to `channel_count`.

#### Proposed conceptual model
- `Image`
  - `width`, `height`
  - `data_window` (unchanged)
  - `color_space` (unchanged; applies to "color-role channels")
  - `channels: ChannelSet` (new)
  - `data: Arc<Vec<f32>>` (still f32; now length = `width * height * channels.len()`)

- `ChannelSet`
  - ordered list of `ChannelDesc` (order defines per-pixel layout)
  - lookup map `name -> index` (for fast channel index resolution)

- `ChannelDesc`
  - `name: ChannelName` (string-like, validated; see §3)
  - `role: ChannelRole` (optional but strongly recommended for UX + safety)
    - Examples: `Color`, `Alpha`, `Depth`, `Vector`, `Normal`, `Mask/ID`, `Unknown`

#### Performance implications
- CPU nodes can still do:
  - `data.par_chunks_exact_mut(stride)` with `stride = channels.len()`
  - same parallelization strategy as today, with only a dynamic stride
- Keep a **fast-path for pure RGBA** (stride==4 and canonical channel set) to avoid regressions in hot nodes:
  - Provide helper APIs that return `&mut [f32; 4]` views when safely possible.
  - Nodes that are RGBA-only should keep near-identical loop structure.

#### Why not planar now?
Planar (one buffer per channel) is attractive for "touch only Z" operations, but it explodes the surface area (new alloc patterns, more code churn, GPU upload complexity). Interleaved gets us to "named channels" with the least architectural disruption.

---

## 3) Channel naming convention

### Naming rules (align with OpenEXR conventions)
Use OpenEXR-style channel names, optionally grouped:
- **Ungrouped**: `R`, `G`, `B`, `A`, `Z`
- **Grouped**: `layer.channel` (e.g., `beauty.R`, `beauty.G`, `beauty.B`, `motion.X`, `motion.Y`, `N.X`, `N.Y`, `N.Z`)

### Canonical internal conventions (recommendation)
- Treat **RGBA** as the canonical "primary color" set:
  - `R`, `G`, `B`, `A` (case-sensitive, matching common EXR practice)
- Prefer `Z` for depth, `N.X/Y/Z` for normals, `motion.X/Y` for motion vectors.
- Cryptomatte: preserve channel names verbatim (they are standardized but complex); do not normalize beyond validation.

### `ChannelName` validation
- Allowed: `[A-Za-z0-9_]+` segments separated by `.` (no empty segments).
- Store and compare names **case-sensitively** (matches EXR reality; avoids lossy transforms).

---

## 4) Node port type system

### Keep `Value::Image(Image)` as the single image transport
Avoid a second image value type unless we discover a hard requirement. Instead, extend the **type system metadata** around "image ports" to express channel requirements.

### Extend `ValueType::Image` with channel constraints (conceptually)
Add a channel-constraint field to port specs (not to runtime values):
- `AnyChannels` — accepts any channel set
- `Requires(names...)` — must contain specific channels (e.g., `Z`)
- `RgbaOnly` — must be exactly RGBA (or at least must contain RGBA and ignore extras; decide per node)
- `HasColor` — must have a color-role triple (RGB) + optional alpha

This belongs in the **node spec / port spec** layer (where you already declare IO contracts). Connection validation should use these constraints to produce user-facing errors early.

### Node authoring ergonomics
Provide helper functions/macros in `cascade-core` to reduce friction:
- `require_channels(image, ["Z"])?`
- `rgba_indices(image)? -> (r,g,b,a)`
- `channel_index(image, "motion.X")?`

---

## 5) Per-pixel processing changes (CPU)

### Replace hardcoded `4` with `stride = image.channels.len()`
- Update generic image-processing utilities to operate on `stride`.
- Add **explicit RGBA-only helpers** for hot paths:
  - `image.is_canonical_rgba()`
  - `image.pixels_rgba_mut_par()` (fast path)
  - `image.pixels_mut_par()` (generic path, yields `&mut [f32]` per pixel)

### How nodes should behave
- **RGBA-only nodes** (most current nodes):
  - Require RGBA presence; either:
    - **Option A (simpler, safer)**: enforce `RgbaOnly` (exact RGBA) and error otherwise.
    - **Option B (better UX)**: enforce "must contain RGBA", operate on RGBA, and **preserve extra channels** unchanged (see §8 + §12).
- **AOV utility nodes** (new):
  - Extract, rename, delete, merge channels.
- **Channel-agnostic nodes**:
  - Operations like crop/resize should apply to *all channels* consistently.

---

## 6) GPU kernel changes

### Phase 6.4 recommendation: keep GPU kernels RGBA-centric, preserve extras on the CPU boundary
Variable-channel compute on GPU is a large architectural shift (buffer-based IO, channel packing, dynamic indexing). For Phase 6.4:
- GPU nodes operate on **RGBA** only.
- When a GPU node receives an image with extra channels:
  - Extract/upload only RGBA to GPU.
  - Compute RGBA output as today.
  - Reattach/preserve extra channels (policy-driven; see below).

### Define a channel preservation policy for nodes
Add an opt-in flag in node spec metadata (or a default in evaluator glue):
- `ChannelPolicy::Replace` — output contains only what node produces (typical for generators)
- `ChannelPolicy::PreserveFromInput(port="in")` — copy all non-written channels from a specific input image

For existing GPU color nodes, default to **PreserveFromInput("image")** to avoid "EXR AOVs disappear" surprises.

### Escalation path (future, not Phase 6.4)
- Pack channels in groups of 4 into multiple textures (RGBA16F/32F array) or a storage buffer.
- Generate shader code that reads/writes arbitrary channel indices.
This becomes Phase 6.5+ once real workloads justify it.

---

## 7) UX considerations

### Viewer node
- Add a **Channel selector**:
  - Modes: `RGBA` (composite), `Single channel` (grayscale), `Vector2` (optional debug), `Vector3` (optional debug)
- Populate from `image.channels`:
  - show grouped names with hierarchy (e.g., `beauty ▸ R/G/B/A`, `N ▸ X/Y/Z`)
- Display defaults:
  - If RGBA exists → default `RGBA`
  - Else → default first channel as grayscale

### Node parameter UI
- For AOV utility nodes, add:
  - dropdown channel pickers (by name)
  - "create if missing" toggles only where sensible (otherwise error)

### Connection validation messaging
- When connecting outputs/inputs with constraints, show:
  - "Missing required channel(s): Z"
  - "Node requires RGBA, but image has only: N.X, N.Y, N.Z"

---

## 8) Edge cases / compatibility rules

### Mixing RGBA-only and multi-channel images
- If node is RGBA-only:
  - If image has RGBA + extras: operate on RGBA, **preserve extras** by default (recommended).
  - If image lacks RGBA: error "RGBA required".
- If node is channel-agnostic (resize/crop): apply to all channels.
- If node outputs a new image but has an obvious "primary input":
  - preserve extras unless semantics say otherwise.

### Backward compatibility with existing projects
- Existing graphs that assume RGBA should continue to evaluate unchanged.
- If any node becomes stricter (e.g., previously accepted anything), ensure error messages are actionable.

---

## 9) EXR integration

### Loading EXR
Current behavior: dynamic output ports per EXR layer, each output is an RGBA `Image`.

Phase 6.4 approach (minimal disruption):
- Keep existing per-layer outputs (for current UX stability).
- Add an optional output (or mode param) to emit a **single multi-channel Image**:
  - Channels are named with the layer prefix: `layer.R`, `layer.G`, `layer.B`, `layer.A`, plus any additional channels in that layer.
  - If EXR has unlayered channels, they remain unprefixed.

### Saving EXR (SaveExr node)
- If input image is multi-channel:
  - write all channels, preserving `layer.channel` names
  - if channels contain unlayered `R/G/B/A`, write them as default layer RGBA
- If input is RGBA-only: unchanged behavior.

### "Should layers become channels?"
Internally, yes: represent layers as channel name prefixes. This avoids inventing a second hierarchy (Image → Layers → Channels) unless forced by later EXR features.

---

## 10) Performance impact

### Memory
- Multi-channel increases memory linearly: `width * height * channel_count * 4 bytes`.
- Preserve `Arc<Vec<f32>>` sharing and copy-on-write patterns to avoid unnecessary clones when only metadata changes.

### Processing overhead
- Dynamic stride adds negligible overhead if stride is hoisted outside loops and indices are precomputed.
- Preserve RGBA fast paths for hot nodes and viewer render.

### Evaluator cache implications
- Cache keys must include channel metadata (names/order) in upstream hashes; otherwise wrong-channel images could hit stale cache entries.

---

## 11) Error handling

### New error classes (conceptual)
Use `CascadeError` variants for:
- `MissingChannel { required: Vec<String>, available: Vec<String> }`
- `ChannelMismatch { expected: ..., found: ... }`
- `InvalidChannelName { name: String }`
- `DuplicateChannelName { name: String }`

### Where errors should surface
- Prefer early failure at **connection validation** time when possible.
- Runtime evaluation should still validate and return structured errors (especially for dynamically generated ports / loaded media).

---

## 12) Migration strategy

### Data model migration
- Update `Image` constructors:
  - `Image::from_f32_rgba(...)` remains convenience for RGBA
  - `Image::from_f32_channels(channels, data, ...)` for general
- Update existing code by:
  1) replacing assumptions (`stride=4`) with `image.stride()` where appropriate
  2) using RGBA helpers for RGBA-only nodes

### Node behavior migration
- For existing nodes:
  - default to "requires RGBA; preserves extras from primary input" unless the node is a generator or explicitly discards channels
- Add a small set of **AOV utility nodes** early so users can adapt workflows without custom code:
  - `ExtractChannel`, `MergeChannels`, `RenameChannel`, `DeleteChannels` (exact naming TBD)

### Project file compatibility
- If project files only store graphs/specs and not image buffers, no format change is required.
- If any serialized node specs embed assumptions about 4 channels, add a version bump + migration shim.

---

## 13) Step-by-step implementation checklist

### A. Core data model (cascade-core)
- [ ] Introduce `ChannelName`, `ChannelDesc`, `ChannelRole`, `ChannelSet`.
- [ ] Redesign `Image` to store `channels: ChannelSet` and variable-stride `data`.
- [ ] Add APIs:
  - [ ] `channels()`, `channel_index(name)`, `has_channels(names)`
  - [ ] RGBA helpers: `is_canonical_rgba()`, `rgba_indices()`
  - [ ] Iterators: `par_pixels_mut(stride)` + RGBA fast path
- [ ] Update hashing/cache-relevant parts to include channel metadata.

### B. Type system + node spec constraints (cascade-core)
- [ ] Extend port spec to express channel constraints (RGBA-only / requires names / any).
- [ ] Update connection validation to check channel constraints and emit friendly messages.

### C. CPU node updates (cascade-nodes-std)
- [ ] Identify RGBA-only nodes and migrate loops to use RGBA helpers (keep performance).
- [ ] Identify channel-agnostic nodes (resize/crop/transform-like) and apply to all channels.
- [ ] Add AOV utility nodes:
  - [ ] ExtractChannel (single channel → 1-channel image or mapped to RGB for viewing)
  - [ ] MergeChannels (combine channels from multiple inputs; conflict policy)
  - [ ] Rename/Delete channels

### D. GPU interop (cascade-gpu + evaluator glue)
- [ ] For GPU nodes, implement "preserve extras from input" policy in the CPU-side wrapper:
  - [ ] Extract RGBA → GPU
  - [ ] Compute RGBA output
  - [ ] Reattach extra channels from chosen input
- [ ] Add tests ensuring AOVs survive a GPU node round-trip.

### E. EXR I/O (existing EXR nodes)
- [ ] Load: add mode/port to output a single multi-channel image with `layer.channel` names.
- [ ] Save: write all channels from multi-channel image; preserve names.

### F. Viewer + UI (apps/web)
- [ ] Extend viewer rendering path to accept:
  - [ ] RGBA composite if present
  - [ ] single-channel grayscale preview otherwise / selectable
- [ ] Add channel selector UI with grouped display.
- [ ] Surface channel mismatch errors cleanly in node UI.

### G. Tests
- [ ] Unit tests for channel parsing/validation and channel lookup.
- [ ] Integration test: EXR load → run a node → save → reload, verifying channel set preserved.
- [ ] Regression tests: existing RGBA graphs unchanged (pixel equality within tolerance).

---

## 14) Risks and mitigations

### Risk: Widespread churn from stride changes
**Mitigation**: keep RGBA fast-path APIs and migrate nodes mechanically; only a small subset becomes truly channel-generic.

### Risk: UX confusion ("why did my AOVs disappear?")
**Mitigation**: default to preserving extra channels across most RGBA ops; make channel-dropping explicit (DeleteChannels / generators).

### Risk: GPU path inconsistency with CPU channel-generic behavior
**Mitigation**: clearly define node channel policies and enforce them uniformly in evaluator glue; defer true GPU multi-channel compute.

---

## Optional future considerations (post-Phase 6.4)
1) True GPU multi-channel compute via channel packing / storage buffers.  
2) Per-channel color management semantics (only if real workflows demand it).
