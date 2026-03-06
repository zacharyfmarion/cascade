# Engine-Side Preview Scaling for Live Slider Drags

## Problem

During slider drags, `render_viewer` processes images at full resolution. For a 4K image, a LoadImage → HueSatValue → Viewer pipeline takes ~1.3s per render:
- HueSatValue per-pixel processing: ~600ms
- Color management conversion: ~400ms  
- Pixel serialization + postMessage transfer: ~200ms

With the fire-and-coalesce pattern (at most 1 render in-flight), the viewer updates every ~1.7s — too slow for interactive preview.

Currently, `downscaleRenderResult` on the main thread only shrinks pixels AFTER the full computation — it's cosmetic, not computational.

## Goal

Render at reduced resolution during live preview so that per-pixel processing, color management, and transfer ALL operate on fewer pixels. At 0.5× scale on a 4K image, that's 1/4 the pixels → ~300ms renders → 3-5fps preview.

## Design: Downscale at Source Nodes (Option A+)

**Recommended by Oracle.** Downscale images at source node boundaries (LoadImage) so ALL downstream nodes automatically process fewer pixels.

### Architecture

#### 1. Thread `preview_scale` through EvalContext (Rust)

Add `preview_scale: f32` to `EvalContext` (default 1.0). Source nodes that generate images consult this value.

```rust
// In EvalContext or as an additional evaluate() parameter
pub struct RenderOptions {
    pub preview_scale: f32,  // 1.0 = full res, 0.5 = half res
}
```

#### 2. Downscale at LoadImage boundary

`LoadImage::evaluate()` checks `preview_scale`. If < 1.0 and the image is large enough, it returns a `resize_nearest()` result instead of the full-res image. All downstream nodes (HueSatValue, Blur, etc.) then process the smaller image naturally — no changes needed in any processing node.

```rust
// In LoadImage::evaluate()
let image = /* load/cache full-res image */;
if ctx.preview_scale < 1.0 {
    let new_w = (image.width as f32 * ctx.preview_scale).round().max(1.0) as u32;
    let new_h = (image.height as f32 * ctx.preview_scale).round().max(1.0) as u32;
    if new_w < image.width || new_h < image.height {
        return resize_nearest(&image, new_w, new_h);
    }
}
```

#### 3. Minimum resolution clamp

Small images don't benefit from downscaling (they're already fast to process). Clamp to a minimum pixel budget to avoid crunching small images to nothing:

```rust
const MIN_PREVIEW_PIXELS: u32 = 64 * 64;  // Never go below ~4K pixels
const MIN_PREVIEW_DIM: u32 = 32;           // Never go below 32px on either axis

let new_w = (image.width as f32 * scale).round().max(MIN_PREVIEW_DIM as f32) as u32;
let new_h = (image.height as f32 * scale).round().max(MIN_PREVIEW_DIM as f32) as u32;
if new_w * new_h < MIN_PREVIEW_PIXELS || new_w >= image.width {
    // Skip downscale — image is small enough already
    return image;
}
```

#### 4. Adaptive scale (future enhancement)

Instead of a fixed 0.5× scale, target a pixel budget (e.g., ~1 megapixel):

```
target_pixels = 1_000_000
current_pixels = width * height
scale = sqrt(target_pixels / current_pixels).min(1.0)
```

This means large images (4K = 8M pixels) get scale ≈ 0.35, while smaller images (1080p = 2M pixels) get scale ≈ 0.71. Small images stay untouched.

#### 5. WASM bridge — no code duplication

Refactor `render_viewer` into a shared inner function:

```rust
// Shared implementation
async fn render_viewer_impl(&mut self, id: NodeId, frame: u64, preview_scale: f32) -> Result<JsValue, JsValue> {
    // ... evaluate with preview_scale in context
    // ... match on value, color convert, serialize
}

// Existing API (unchanged)
pub async fn render_viewer(&mut self, viewer_node_id: &str, frame: u64) -> Result<JsValue, JsValue> {
    self.render_viewer_impl(parsed_id, frame, 1.0).await
}

// New API for preview
pub async fn render_viewer_scaled(&mut self, viewer_node_id: &str, frame: u64, scale: f32) -> Result<JsValue, JsValue> {
    self.render_viewer_impl(parsed_id, frame, scale).await
}
```

#### 6. Cache key includes scale

Add quantized scale to `CacheKey` so preview and full-res entries don't collide:

```rust
pub struct CacheKey {
    pub frame_time: FrameTime,
    pub param_revision: u64,
    pub upstream_hash: u64,
    pub project_format_hash: u64,
    pub preview_scale_q: u16,  // round(scale * 1024) — quantized to avoid float fragmentation
}
```

#### 7. Field rasterization

For `Value::Field` results, rasterize at `(w * scale, h * scale)` instead of full project format resolution.

#### 8. Resize utility

Make `resize_nearest` public in `cascade-nodes-std/src/transform.rs` (currently private). Re-export from `cascade-nodes-std/src/lib.rs`.

### TypeScript Changes

#### EngineBridge interface (`bridge.ts`)
Add optional `scale` parameter to `renderViewer`:
```typescript
renderViewer(viewerNodeId: string, frame: number, scale?: number): Promise<ViewerResult> | ViewerResult;
```

#### Worker (`engineWorker.ts`)
`setAndRender` accepts `scale` parameter, calls `eng.render_viewer_scaled(viewerId, frame, scale)` during live renders:
```typescript
async setAndRender(mutation, frame, scale?) {
    // ... set param
    for (const viewerId of viewers) {
        const raw = scale && scale < 1
            ? await eng.render_viewer_scaled(viewerId, BigInt(frame), scale)
            : await eng.render_viewer(viewerId, BigInt(frame));
    }
}
```

#### paramController (`paramController.ts`)
Pass `livePreviewScale` through `setAndRender` during drags. Remove `downscaleRenderResult` from the live render path (engine handles it now). Keep `downscaleRenderResult` only as a fallback for non-Worker paths.

On commit, call `setAndRender` without scale (defaults to 1.0 = full resolution).

### Full-res on commit

The "re-upscaling" happens automatically:
1. **During drag**: `dispatchLiveRender` calls `setAndRender(mutation, frame, 0.5)` → engine evaluates at half-res → viewer shows slightly blurry preview
2. **On pointerup**: `commitRender` calls `setAndRender(mutation, frame)` (no scale) → engine evaluates at full-res → sharp result replaces preview

### Gotchas

- **Always resize in linear f32** (before color conversion). Never downscale RGBA8 — that would introduce banding.
- **Color space preservation**: `resize_nearest` already preserves `image.color_space` from the source.
- **Coordinate mapping**: The viewer component needs to know the image was downscaled so mouse coordinates (for pixel inspection etc.) map correctly. Return `preview_scale` metadata alongside the result, or the viewer can infer from the width/height ratio vs. the expected full-res dimensions.
- **Other source nodes**: If nodes like `LoadImageSequence`, `LoadImageBatch`, or generated images (gradients, noise) create full-res outputs, they should also consult `preview_scale`. Start with `LoadImage` only and add others incrementally.
- **Quantize scale in cache key**: Use `(scale * 1024.0).round() as u16` to avoid float fragmentation creating thousands of near-identical cache entries.

## Implementation Order

1. Make `resize_nearest` public in `cascade-nodes-std`
2. Add `preview_scale` to evaluator context / `RenderOptions`
3. Implement downscale in `LoadImage::evaluate()`
4. Add `render_viewer_scaled` to WASM bridge (shared impl, no duplication)
5. Update cache key to include quantized scale
6. Thread `scale` through TypeScript: bridge → Worker → paramController
7. Remove `downscaleRenderResult` from live render path
8. Add minimum resolution clamp
9. Verify: `cargo check`, `cargo test`, `npx tsc`, `yarn lint`

## Expected Impact

| Image size | Current render | At 0.5× scale | Speedup |
|-----------|---------------|---------------|---------|
| 4K (3840×2160) | ~1300ms | ~325ms | 4× |
| 1080p (1920×1080) | ~350ms | ~90ms | 4× |
| 720p (1280×720) | ~150ms | ~40ms | 4× |
| Small (400×300) | ~15ms | skip (already fast) | 1× |

At 0.5× scale, preview FPS during drags: ~3-5fps (4K) to ~10-25fps (1080p).

## Status

- [ ] Phase 1: Rust-side preview scaling
- [ ] Phase 2: TypeScript integration  
- [ ] Phase 3: Adaptive scaling + minimum clamp
