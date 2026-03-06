# Phase 6.2 — Tile-based processing (Implementation Plan)

## Bottom line
Introduce a **Region-of-Interest (ROI) / tile request pipeline** in the evaluator so it can compute and cache **small image tiles** instead of full-frame intermediates for nodes that opt in (per-pixel + local-neighborhood filters). Keep everything **backward compatible**: nodes that can't tile keep using full-buffer evaluation, and the viewer can still request a full image when needed.

## Effort estimate
**Large (3d+)** (core evaluator + cache plumbing + first wave of tileable nodes + basic progressive UI)

---

## 1) Goal and scope

### Goals
- **Reduce peak memory** and make caching more effective by storing **tile-sized intermediates** instead of full-frame images.
- Enable **progressive rendering** (tiles appear as they complete) to improve perceived responsiveness.
- Preserve current correctness guarantees (linear f32 RGBA processing, existing cache invalidation, pull-based evaluation).

### When tiling helps
- Large images (4K+) with deep graphs where caching full intermediates is expensive.
- Interactive workflows where the viewer effectively needs only **part** of the image (pan/zoom, partial invalidation, small UI preview).
- Local operations (per-pixel transforms, neighborhood filters with bounded radius).

### When tiling hurts
- Graphs that always require the full frame and are dominated by very cheap per-pixel ops (tiling overhead can exceed savings).
- Nodes with global dependencies (histograms, normalization, reductions) where tiles must coordinate or are meaningless.
- GPU nodes if implemented as "one dispatch per tile" without batching (dispatch/readback overhead).

### Non-goals (explicitly out of Phase 6.2)
- Perfect ROI propagation for all geometry/resampling nodes (do minimal viable subset first).
- Tile-aware GPU subgraph batching (that's Phase 6.3).
- Multi-channel/AOV-aware tiling semantics (Phase 6.4), beyond "tiles must not block it later."

---

## 2) Tile system design

### 2.1 Coordinate system and terminology
- **Image pixel space**: integer pixel coordinates in the image's canonical space (same space used for `width/height` today).
- **ROI / Region**: a rectangle in pixel space, e.g. `(x, y, w, h)`; always clamped to the image bounds.
- **Tile**: a region produced by snapping ROI requests to a regular grid (e.g. 256×256).
- **Halo / overlap**: extra pixels needed around an output region to compute a local operator correctly (e.g., convolution radius).

> Key constraint: tile evaluation must preserve semantics for nodes that rely on absolute coordinates/UV. That means tiles need a notion of **global origin** (see 2.4).

### 2.2 Proposed core types (in `cascade-core`)
Minimal set that keeps complexity contained:

```rust
struct PixelRect { x: i32, y: i32, w: u32, h: u32 }       // ROI in global pixel space
struct TileSize { w: u32, h: u32 }                        // default 256×256
struct TileIndex { tx: u32, ty: u32 }                     // tile grid coordinates
struct Halo { left: u32, right: u32, top: u32, bottom: u32 }

struct TileId {
  node_id: NodeId,
  output_port: String,
  frame_time: FrameTime,
  param_revision: u64,
  upstream_hash: u64,
  tile_index: TileIndex,
  tile_size: TileSize,
  // reserved: channel_set / aov_id (Phase 6.4), lod (future)
}
```

### 2.3 Tile grid + snapping rules
- Compute tile grid from the output image's bounds:
  - `tiles_x = ceil(width / tile_w)`
  - `tiles_y = ceil(height / tile_h)`
- A tile's **output rect** is derived from `(tx, ty)` and clamped at edges (last tiles smaller).
- When the viewer asks for ROI, the evaluator **snaps** to the minimal set of tiles covering that ROI.

### 2.4 Carrying global origin / data windows
To avoid tile seams and wrong UV math:
- A tile result should carry:
  - `tile_rect` in **global pixel coordinates**
  - the parent image's `color_space`, `format`, and domain/data-window semantics
- Recommendation (minimal): keep using the existing `Image` type for tile outputs, but ensure:
  - `Image.width/height` matches the tile buffer (local dimensions)
  - `Image.data_window` (or equivalent) encodes the **global rect** the tile represents
  - provide helper(s) that compute UV from global coords consistently (so nodes don't accidentally treat tiles as full-frame)

If `data_window` currently means something else, introduce a separate `ImageOrigin { x, y }` or `ImageRegion` field rather than overloading semantics.

### 2.5 Halo rules (local-neighborhood ops)
- For a neighborhood operator with radius `r`, output tile `(rect_out)` requires an input rect:
  - `rect_in = expand(rect_out, r)` then clamp to image bounds.
- Use a generalized `Halo` instead of a single radius (supports asymmetric kernels later).
- If halo is so large that `rect_in` becomes near-full-frame, prefer full evaluation (avoid worst-case overhead).

### 2.6 Tile size selection
Default: **256×256** (≈ 1 MiB per RGBA f32 tile: `256*256*4*4 = 1,048,576 bytes`).
Heuristics:
- Disable tiling for tiny images: if `width*height <= (tile_w*tile_h)` or if tile count is very small (e.g., ≤4 tiles).
- Allow a runtime knob (engine setting) for tile size; keep a conservative default.

---

## 3) Node classification + declaration in NodeSpec

### 3.1 Categories
1. **Embarrassingly per-pixel** (tileable, zero halo)  
   Examples: invert, brightness/contrast, clamp, color matrix.
2. **Local-neighborhood** (tileable, bounded halo)  
   Examples: blur with known radius, sharpen, edge detect (fixed kernel), morphology (bounded).
3. **Geometry / resampling** (tileable *later*, ROI mapping needed)  
   Examples: resize, transform, warp. ROI mapping depends on transform and filter.
4. **Global / reduction** (not tileable in v1)  
   Examples: histogram equalization, auto-exposure, global normalization.
5. **Generators** (tileable if they can render a region deterministically from coordinates)  
   Examples: constant color, checkerboard, gradients. (Often easy wins.)

### 3.2 How to declare tiling support (minimal change)
Extend `NodeSpec` with an optional tiling capability descriptor:

```rust
enum TilingKind { None, PerPixel, Neighborhood /* later: Geometry */ }

struct TilingSpec {
  kind: TilingKind,
  // For Neighborhood: halo as a function of params (dynamic)
  // Implemented via a new node method rather than embedding logic in spec.
}
```

And add a new optional trait (opt-in) implemented by tileable nodes:

```rust
trait TileableNode {
  fn tiling_kind(&self) -> TilingKind;
  fn halo(&self, params: &Params) -> Halo;               // zero for PerPixel
  fn evaluate_tile(&self, ctx: &TileEvalContext, out: &PixelRect) -> Result<Image, CascadeError>;
}
```

**Backward compatibility:** nodes without `TileableNode` are treated as `TilingKind::None` and keep the existing full-frame `evaluate()` path.

---

## 4) Evaluator changes (pull-based evaluation with tiles)

### 4.1 High-level design choice
**Primary recommendation:** graph-level tiling driven by the evaluator.  
- The viewer requests an ROI (initially "full frame"), evaluator decomposes into tiles, and requests tiles recursively upstream.
- Nodes remain mostly unaware of the tiling scheduler; they just implement "evaluate this region" when they opt in.

This avoids "per-node bespoke tiling orchestration" and keeps one control plane (the evaluator) for caching, scheduling, and progress.

### 4.2 New evaluator entrypoints
Add an internal "region evaluation" API:

- `evaluate_output_region(node_id, port, region) -> TileStream | Vec<TileResult> | Image`
- Existing "evaluate full image" becomes `evaluate_output_region(..., full_rect)` then stitch.

### 4.3 ROI propagation rules (v1)
Implement only what's needed for v1 tileable nodes:
- **Per-pixel**: input ROI == output ROI for each input.
- **Neighborhood**: input ROI == expand(output ROI, halo).
- **Blend/composite (per-pixel)**: same ROI for all inputs.
- Any node not covered: evaluator falls back to requesting **full-frame** at that node boundary.

This staged approach keeps Phase 6.2 shippable without solving all ROI math.

### 4.4 Stitching and boundary behavior
- Evaluator is responsible for:
  - Requesting needed upstream tiles
  - Stitching them into a contiguous input buffer for a node tile evaluation (especially when halo spans multiple upstream tiles)
  - Cropping halo out of the output tile (if node computed on a halo-inflated buffer)
- Define a consistent edge policy for halo sampling (clamp-to-edge vs transparent-black), and enforce it in the stitch step to prevent artifacts.

### 4.5 Scheduling + concurrency
- Use Rayon to evaluate multiple tiles in parallel, but cap oversubscription:
  - Prefer one layer of parallelism (tiles) over nested `par_chunks_exact_mut` inside every tile evaluation.
  - Practical approach: keep node internals using Rayon for now, but add a guard to avoid "Rayon-in-Rayon blowup" later (measure first).

### 4.6 Cancellation / invalidation
- Reuse existing dirty propagation + param revision keys.
- Add lightweight cancellation for in-flight tile jobs when a new request supersedes them (important for interactive scrubbing).

---

## 5) Cache interaction (tile-level caching)

### 5.1 Cache model
- Replace/augment image-level cache entries with **tile entries**:
  - `CacheEntry::Tile { tile_id, image_tile }`
- Maintain the existing byte-budget LRU; tiles simply become the unit of eviction.

### 5.2 Cache keys
Tile key must include:
- Node identity + output port
- Frame time (or equivalent)
- Param revision
- Upstream hash (already used)
- Tile index + tile size
- (Reserve fields for Phase 6.4 channel/AOV identifiers)

### 5.3 Memory savings (order-of-magnitude)
Assuming 4K (3840×2160), RGBA f32:
- Full image ≈ `3840*2160*16 ≈ 132.7 MB` (your ~126MB estimate is in the same ballpark depending on exact dims/overheads)
- 256×256 tile ≈ **1.0 MB**
- Total tiles for full-frame: `ceil(3840/256)=15`, `ceil(2160/256)=9` → **135 tiles**  
  If you compute/store *all* tiles, you're close to full-image memory, plus overhead.  
  The win comes from:
  - caching only the tiles actually needed (ROI, progressive view, partial recompute)
  - evicting fine-grained intermediates instead of "all-or-nothing" images

### 5.4 Cache policy tweaks (recommended)
- Prefer keeping:
  - most recent tiles near the viewer ROI
  - tiles at the leaf/viewer outputs
- Keep policy simple initially: standard LRU-by-bytes is fine; add priority later only if needed.

---

## 6) GPU tiling (interaction with GPU dispatch)

### 6.1 Recommendation for Phase 6.2
Start with **CPU tiling end-to-end**, and treat GPU nodes as:
- **Full-frame only** in v1 (simplest, least risk), OR
- "Tile-capable but experimental" behind a flag

This reduces the chance Phase 6.2 gets blocked by GPU dispatch/readback overhead and texture view limitations.

### 6.2 If implementing GPU tiles (minimal viable)
- Allocate tile-sized textures via the existing (or upcoming) **GPU texture pool** (Phase 2.4).
- For each tile:
  - Upload/copy input tile (including halo) into a tile texture
  - Dispatch compute for that tile extent
  - Read back only the tile extent
- Ensure the kernel's coordinate math uses global pixel origin (pass tile origin uniforms).

### 6.3 Forward-compatibility with Phase 6.3 batching
Design the evaluator's GPU tile path so it can later batch:
- multiple tiles per dispatch (texture arrays / atlases), or
- fuse consecutive GPU nodes per tile (tile-aware subgraph batching)

In Phase 6.2, just keep interfaces ready (tile origin, region uniforms, pooled textures).

---

## 7) UX considerations (progressive rendering)

### 7.1 Progressive tile display
- Viewer requests full-frame region → evaluator streams tile completions.
- Frontend displays completed tiles immediately:
  - keep the last good image as background
  - overlay updated tiles as they arrive
- Provide a "refining…" indicator when not all tiles are complete.

### 7.2 Progress reporting
- Progress = `completed_tiles / total_tiles_requested`
- Optional: show a subtle tile grid overlay in debug mode (helps diagnose seams/halo bugs).

---

## 8) Edge cases

- **Image edges**: halo expansion must clamp; define and test edge sampling policy.
- **Non-multiple-of-tile-size** images: last row/column tiles are smaller; must not assume fixed extents.
- **Tiny images**: disable tiling (tile overhead > benefit).
- **Mixed tile/non-tile chains**:
  - If a non-tile node appears upstream, it produces full-frame; downstream tile nodes then crop regions from it.
  - If a non-tile node is downstream, it forces full-frame evaluation for that branch.
- **Undo/redo + cache**:
  - Ensure param revision changes invalidate affected tiles the same way they currently invalidate full images.
  - Avoid retaining tiles from older revisions beyond LRU eviction (correctness first).

---

## 9) Error handling

- **Per-tile failures**:
  - Treat tile computation as `Result<TileImage, CascadeError>`.
  - If any tile fails for a "final full-frame" request, surface a structured error (don't silently fill).
  - For progressive UI, optionally keep the previous tile image and mark the tile as "failed" in overlay state.
- **Artifact prevention**:
  - Require that neighborhood nodes declare correct halo; evaluator enforces halo stitching consistently.
  - Add tests that compare tiled vs full evaluation for representative nodes.

---

## 10) Performance analysis + measurement strategy

### 10.1 When tiling wins
- Memory-bound graphs where full intermediates cause cache churn.
- Partial updates (small ROI invalidated) where recomputing full frame is wasteful.
- Deep graphs where only the viewer-visible region matters.

### 10.2 When tiling loses
- Very cheap nodes + full-frame always needed (tile scheduling + stitching overhead).
- Excessive halo (large-radius blurs) causing high redundant compute.
- GPU per-tile dispatch/readback overhead without batching.

### 10.3 Measurement plan
- Add benchmarks that run the same graph in:
  1) full-frame mode (baseline)
  2) tiled mode (full ROI)
  3) tiled mode (partial ROI, e.g. 25% viewport)
- Track:
  - total wall time
  - peak RSS / allocated bytes
  - cache hit rate and bytes evicted
  - per-node time distribution
- Success criteria (v1): measurable memory reduction and no regressions >X% on baseline full-frame for common graphs (choose X after initial measurement).

---

## 11) Migration strategy (opt-in, backward compatible)

- Default engine behavior: **tiling disabled** or **enabled only for safe nodes** behind a setting.
- Nodes opt in by implementing `TileableNode` (or equivalent) and setting `NodeSpec.tiling`.
- Convert nodes in waves:
  1) trivial per-pixel ops (zero halo)
  2) bounded-radius filters (blur/sharpen with declared halo)
  3) simple generators (constant/gradient) if they exist
- Maintain a "tiled-vs-full equivalence" test suite per converted node.

---

## 12) Step-by-step implementation checklist

### High-level action plan (≤7 steps)
1. Add ROI/tile primitives and a tile request API in the evaluator.
2. Implement tile-level cache entries + keys + eviction accounting.
3. Add `TileableNode` opt-in interface + `NodeSpec` declaration.
4. Implement ROI propagation + stitching for PerPixel and Neighborhood nodes.
5. Convert a small starter set of nodes + add equivalence tests.
6. Add progressive tile streaming to the viewer pipeline (basic UI).
7. Benchmark and tune tile size/thresholds; adjust defaults.

### Detailed checklist
- [ ] **Core types**: `PixelRect`, `TileSize`, `TileIndex`, `Halo`, `TileId`
- [ ] **Rect utilities**: clamp, expand, intersect, snap-to-tiles, tile-grid iteration
- [ ] **Evaluator**:
  - [ ] Region request entrypoint
  - [ ] Tile scheduler (generate tile list from ROI)
  - [ ] Recursive ROI propagation for PerPixel/Neighborhood
  - [ ] Stitch upstream tiles into contiguous halo input buffers
  - [ ] Assemble tiles into a full `Image` when needed
  - [ ] Cancellation hook for interactive requests
- [ ] **Cache**:
  - [ ] New cache entry type for tiles
  - [ ] Byte accounting per tile
  - [ ] Key includes tile index/size + existing revision/hash fields
- [ ] **Node API**:
  - [ ] `NodeSpec` tiling metadata
  - [ ] `TileableNode` trait + default adapter/fallbacks
  - [ ] Helper for nodes to read global coords/UV consistently
- [ ] **First converted nodes** (examples):
  - [ ] Invert (PerPixel, halo=0)
  - [ ] Brightness/Contrast (PerPixel, halo=0)
  - [ ] Blur (Neighborhood, halo=radius)
- [ ] **Tests**:
  - [ ] "tiled output == full output" for each converted node
  - [ ] Edge tile tests (partial tiles, image borders, odd sizes)
  - [ ] Mixed chain test (tileable → non-tileable → tileable)
- [ ] **Frontend/progressive UX**:
  - [ ] Tile completion events surfaced from engine bridge/store
  - [ ] Viewer composes tiles into displayed image progressively
  - [ ] Progress indicator
- [ ] **GPU** (optional in Phase 6.2):
  - [ ] Decide: full-frame only vs experimental tile dispatch
  - [ ] If tile dispatch: tile origin uniforms + pooled tile textures
- [ ] **Benchmarks & tuning**:
  - [ ] Add benchmark graphs + ROI scenarios
  - [ ] Tune tile size and "disable tiling for tiny images" thresholds

---

## 13) Risks and mitigations

- **Risk: tile seam artifacts (halo/stitch bugs)**  
  Mitigation: strict halo declaration + edge policy + tiled-vs-full equivalence tests, especially on borders.
- **Risk: overhead dominates for full-frame cheap graphs**  
  Mitigation: thresholds to disable tiling for small images/few tiles; measure before enabling by default.
- **Risk: GPU per-tile dispatch overhead makes GPU slower**  
  Mitigation: keep GPU full-frame in Phase 6.2; design interfaces for batching in Phase 6.3.

---

## Escalation triggers (when to revisit with a more complex design)
- You need correct ROI for geometry/resampling nodes (resize/warp) across production graphs.
- GPU tile mode is required for performance, and dispatch/readback overhead is too high without batching.
- Multi-channel/AOV semantics require tiles to carry channel-set identifiers and cross-channel synchronization.

## Optional future considerations (max 2)
- Add a "tile priority" policy (viewport-first) to improve interactivity under memory pressure.
- Add a debug visualization mode that highlights tile boundaries and halo extents for diagnosing artifacts.
