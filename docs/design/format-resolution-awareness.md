# Design: Format & Resolution Awareness

## Problem

Every image in the processor is a bare `(width, height, Vec<f32>)` buffer. There's no concept of where that image lives in a shared coordinate space, what the intended output resolution is, or how to composite two images of different sizes. This blocks all real compositing workflows.

## Design Principles

1. **Format and bounding box live on `Image`**, not on connections or the graph. They're runtime-derived values that flow through the pipeline like pixel data does.
2. **Dense storage for data window only** — pixels are allocated only for the region that has data, not padded to the full display format. This keeps WASM memory usage sane when compositing small elements over large backgrounds.
3. **Half-open integer rectangles** — `[min, max)` convention everywhere. Pixel centers are at `(x + 0.5, y + 0.5)` in float space. This is the convention that minimizes off-by-one bugs in resizing, cropping, and sampling.
4. **Backward compatible** — existing nodes that don't care about format continue to work unchanged. We add sensible defaults so `data_window == display_window == (0,0)→(w,h)` matches legacy behavior.
5. **Project format threaded through evaluation** — generators and Field rasterization need to know the intended output resolution. This comes from a project-level setting, not guesswork.

---

## New Types

### Geometry primitives (`cascade-core/src/types.rs`)

```rust
/// Integer 2D point in pixel index space.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IVec2 {
    pub x: i32,
    pub y: i32,
}

/// Half-open pixel rectangle: x in [min.x, max.x), y in [min.y, max.y).
/// Empty when min.x >= max.x or min.y >= max.y.
/// Coordinates can be negative (data extending left/above origin).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RectI {
    pub min: IVec2,
    pub max: IVec2,
}
```

**`RectI` operations:**

| Method | Behavior |
|--------|----------|
| `is_empty()` | `min.x >= max.x \|\| min.y >= max.y` |
| `width()` / `height()` | `max - min` (returns `i32`, can be 0 or negative) |
| `area()` | `width.max(0) * height.max(0)` as `u64`, checked |
| `contains(x, y)` | point inside half-open range |
| `union(other)` | smallest rect covering both (identity for empty) |
| `intersect(other)` | overlap region (may be empty) |
| `expand(px)` | grow by `px` pixels on all sides (saturating) |
| `translate(dx, dy)` | shift origin |
| `from_dimensions(w, h)` | `(0,0)→(w,h)` convenience for legacy |

### Format

```rust
/// Pixel aspect ratio as a rational number.
/// 1:1 for square pixels (most common). 
/// Anamorphic footage uses non-square (e.g., 2:1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PixelAspectRatio {
    pub num: u32,  // >= 1
    pub den: u32,  // >= 1
}

impl Default for PixelAspectRatio {
    fn default() -> Self { Self { num: 1, den: 1 } }
}

impl PixelAspectRatio {
    pub fn is_square(&self) -> bool { self.num == self.den }
    pub fn as_f32(&self) -> f32 { self.num as f32 / self.den as f32 }
}

/// A named output format (display window + pixel aspect).
/// This is the "canvas" the viewer displays.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Format {
    pub display_window: RectI,
    pub pixel_aspect: PixelAspectRatio,
}

impl Format {
    /// Common constructor: 1920x1080 square pixels, origin at (0,0).
    pub fn hd() -> Self {
        Self {
            display_window: RectI::from_dimensions(1920, 1080),
            pixel_aspect: PixelAspectRatio::default(),
        }
    }

    pub fn width(&self) -> u32 { self.display_window.width().max(0) as u32 }
    pub fn height(&self) -> u32 { self.display_window.height().max(0) as u32 }
}
```

### Updated Image

```rust
#[derive(Clone, Debug)]
pub struct Image {
    /// The display format this image belongs to (the "canvas").
    pub format: Format,

    /// The region of the format that actually contains pixel data.
    /// May be smaller (cropped), equal to (standard), or larger
    /// (overscan/filter expansion) than format.display_window.
    /// May have negative coordinates. May be empty.
    pub data_window: RectI,

    /// Pixel data, densely packed RGBA f32, row-major, for
    /// data_window ONLY. Length = data_window.width * data_window.height * 4.
    /// Empty vec if data_window is empty.
    pub data: Arc<Vec<f32>>,

    /// Color space (unchanged from current).
    pub color_space: ColorSpaceId,
}
```

**Key `Image` methods:**

```rust
impl Image {
    /// Backward-compatible constructor: data_window == display_window == (0,0)→(w,h).
    pub fn from_f32_data(width: u32, height: u32, data: Vec<f32>) -> Self { ... }

    /// Full constructor with explicit format and data window.
    pub fn new_with_domain(
        format: Format,
        data_window: RectI,
        data: Vec<f32>,
        color_space: ColorSpaceId,
    ) -> Self { ... }

    /// Data dimensions (NOT format dimensions).
    pub fn data_width(&self) -> u32 { self.data_window.width().max(0) as u32 }
    pub fn data_height(&self) -> u32 { self.data_window.height().max(0) as u32 }

    /// Convert global pixel (x, y) to index into self.data.
    /// Returns None if outside data_window.
    pub fn index_of(&self, x: i32, y: i32) -> Option<usize> { ... }

    /// Sample pixel at global coords. Returns transparent black outside data_window.
    /// This is the primary API multi-input nodes should use.
    pub fn get_rgba(&self, x: i32, y: i32) -> [f32; 4] { ... }

    /// Is data_window empty?
    pub fn is_empty(&self) -> bool { self.data_window.is_empty() }

    /// Legacy convenience: pixel count of data_window.
    pub fn pixel_count(&self) -> usize { ... }
}
```

---

## Evaluation Context Changes

### Project Format

Add a `project_format` to `EvalContext` so generators and field rasterization know the intended output resolution:

```rust
pub struct EvalContext<'a> {
    pub inputs: HashMap<String, Value>,
    pub params: &'a HashMap<String, ParamValue>,
    pub frame_time: FrameTime,
    pub color_management: &'a dyn ColorManagement,
    pub ai_provider: Option<&'a dyn crate::ai::AiProvider>,
    pub project_format: &'a Format,  // NEW
}
```

**Where project format comes from:** A new field on the engine / graph root level, set by the user in project settings (defaulting to 1920x1080). Threaded from the top-level `evaluate()` call down to every node.

### Cache Key Update

`project_format` must be included in the cache key (or its hash). Without this, generators cached at one resolution would return stale results when the project format changes:

```rust
struct CacheKey {
    frame_time: FrameTime,
    param_revision: u64,
    upstream_hash: u64,
    project_format_hash: u64, // NEW
}
```

### Field Rasterization Update

Current behavior (eval.rs lines 111-132): fields are rasterized to the dimensions of the first Image input on the node. New behavior:

- If the node has Image inputs → rasterize to the **union of all input data_windows**, carrying the format from the first Image input.
- If the node has no Image inputs (pure generator) → rasterize to `project_format.display_window`.

```rust
// In Field:
pub fn rasterize_to_domain(&self, domain: &ImageDomain) -> Image {
    // Rasterize into data_window, mapping UV coords relative to format.display_window
    ...
}
```

---

## Format Propagation Rules

Every node that produces an Image output has an implicit "format policy." Here are the rules by category:

### Single-input color ops (BrightnessContrast, Invert, Levels, etc.)

**Rule:** Pass through format and data_window unchanged. These nodes transform pixels in-place without spatial dependence.

**Migration effort:** Minimal. These nodes already create output buffers matching input dimensions. They just need to copy `format` and `data_window` from input to output.

```rust
// Before:
let output = Image::from_f32_data(image.width, image.height, data);

// After:
let output = Image::new_with_domain(image.format.clone(), image.data_window, data, image.color_space.clone());
```

### Spatial filters (GaussianBlur, Sharpen, Dilate, Erode, Median)

**Rule:** Format passes through. Data window can optionally expand by the kernel radius to avoid edge artifacts.

For now, keep data_window == input data_window (existing behavior). Later, add an "overscan" parameter:

```rust
// Future:
let expanded = input.data_window.expand(kernel_radius as i32);
```

### Multi-input compositing (AlphaOver, Blend, future Merge)

**Rule:**
- **Format:** Use the format from the first/primary input (A/base/background). If only B is connected, use B's format. Fall back to project_format.
- **Data window:** Union of all input data windows.
- **Sampling:** Use `image.get_rgba(x, y)` for all inputs. Pixels outside any input's data_window are transparent black.

This is the key architectural payoff — two images of different sizes "just work" because they share a global coordinate space.

```rust
let output_format = background.format.clone();
let output_window = background.data_window.union(foreground.data_window);
let mut data = vec![0.0f32; output_window.area_checked()? * 4];

for y in output_window.min.y..output_window.max.y {
    for x in output_window.min.x..output_window.max.x {
        let bg = background.get_rgba(x, y);
        let fg = foreground.get_rgba(x, y);
        // ... composite ...
    }
}
```

### Generators (SolidColor, Noise, Gradient, Checkerboard)

**Rule:** Format = `ctx.project_format`. Data window = `project_format.display_window`. These nodes have no spatial input to inherit from.

```rust
let format = ctx.project_format.clone();
let data_window = format.display_window;
```

### Transform nodes

| Node | Format | Data window |
|------|--------|-------------|
| **Crop** | Unchanged | `input.data_window.intersect(crop_rect)` |
| **Resize** | Display window changes to target dims | Data window scaled proportionally |
| **Rotate** | Unchanged | Expanded to contain rotated bounding box |
| **Translate** | Unchanged | `input.data_window.translate(dx, dy)` |
| **Transform2D** | Unchanged | Transformed bounding box |
| **Reformat** | Target format (see below) | `target.display_window` |

### Viewer / Output

- **Viewer:** Does not modify images. Displays `format.display_window` as the canvas. Can optionally show `data_window` outline as a debug overlay.
- **ExportImage:** Rasterizes the final image to `format.display_window`, filling outside data_window with transparent/black.

---

## Reformat Node Design

The Reformat node conforms an image from its current format to a target format. This is the only node (besides Resize) that changes the display window.

### Parameters

| Param | Type | Values |
|-------|------|--------|
| `target_source` | Dropdown | `Project`, `Custom` |
| `width` | Int | Target width (when Custom) |
| `height` | Int | Target height (when Custom) |
| `resize_mode` | Dropdown | `None`, `Fit`, `Fill`, `Distort` |
| `filter` | Dropdown | `Nearest`, `Bilinear`, `Bicubic` |
| `center` | Bool | Center in new format (default: true) |

### Resize modes

- **None:** Change format metadata only. Data is not resampled. Useful for "declaring" a format.
- **Fit:** Scale uniformly to fit inside target, maintaining aspect. Letterbox/pillarbox with transparent.
- **Fill:** Scale uniformly to fill target, maintaining aspect. Overflows are cropped.
- **Distort:** Scale non-uniformly to exactly match target dimensions.

---

## Migration Strategy

### Phase 1: Core types (non-breaking)

1. Add `IVec2`, `RectI`, `PixelAspectRatio`, `Format` to `types.rs`.
2. Add `format` and `data_window` fields to `Image` with defaults matching `(0,0)→(width, height)`.
3. Keep existing `Image::from_f32_data(w, h, data)` working — it sets format and data_window to `(0,0)→(w,h)`.
4. Add `Image::new_with_domain(...)` constructor.
5. Add `Image::get_rgba(x, y)` helper.
6. Add `Image::index_of(x, y)` helper.
7. Add `project_format` to `EvalContext`.
8. Update evaluator to thread `project_format` through.
9. Update cache key to include `project_format`.

**At this point:** Every existing node still compiles and works identically. The new fields exist but default to legacy values.

### Phase 2: Generator + Viewer migration

1. Update all generator nodes (SolidColor, Noise, etc.) to set `format = ctx.project_format`.
2. Update Viewer to display based on `format.display_window`.
3. Update WASM/Tauri bridges to send format metadata to the frontend.
4. Add project format setting to the frontend UI.

### Phase 3: Compositing nodes

1. Update AlphaOver to use `get_rgba()` sampling with data_window union.
2. Update Blend to use `get_rgba()` sampling with data_window union.
3. Build the Merge node (new) with Porter-Duff ops and bbox mode parameter.

### Phase 4: Transform nodes

1. Update Crop to narrow data_window via intersection.
2. Update Translate to offset data_window.
3. Update Rotate/Transform2D to compute transformed bounding box.
4. Build Reformat node (new).

### Phase 5: Single-input nodes (batch)

Update all single-input color/filter nodes to copy `format` and `data_window` from input to output. This is mechanical — most nodes just need to change their `Image::from_f32_data(w, h, data)` call to `Image::new_with_domain(input.format, input.data_window, data, ...)`.

---

## Edge Cases

### Empty data windows

Legal. `data.len() == 0`. Nodes should short-circuit (produce empty output or pass-through). The `is_empty()` method makes this check easy.

### Data window extends beyond format

Legal and common. Blur/overscan creates data outside the display window. Viewer clips to display_window. Compositing uses the full data_window for sampling. Export rasterizes to display_window.

### Negative coordinates

Legal. `RectI` uses `i32`. A translated image might have `data_window.min.x = -100`. The `get_rgba()` method handles this seamlessly.

### Integer overflow

`RectI::area()` should be checked:
```rust
pub fn area_checked(&self) -> Result<usize, CascadeError> {
    let w = self.width().max(0) as u64;
    let h = self.height().max(0) as u64;
    let pixels = w.checked_mul(h)
        .ok_or(CascadeError::Other("Data window too large".into()))?;
    let bytes = pixels.checked_mul(4)
        .ok_or(CascadeError::Other("Data window too large".into()))?;
    usize::try_from(bytes)
        .map_err(|_| CascadeError::Other("Data window too large".into()))
}
```

### Pixel aspect ratio mismatch

Multi-input nodes should **warn or error** when pixel aspects don't match. Don't silently composite images with different pixel aspects — require an explicit Reformat. For Phase 1, we can assert square pixels and handle PAR later.

### Field rasterization domain

When a Field arrives at a node with Image inputs: rasterize to the union of input data_windows.  
When a Field arrives at a node with no Image inputs: rasterize to `project_format.display_window`.  
The Field's UV space maps `(0,0)→(1,1)` to the format's display_window (not the data_window).

---

## What This Unlocks

Once format awareness is in place, these become straightforward:

- **Merge node:** Just a multi-input composite with bbox mode param — the architecture handles resolution mismatch.
- **Proper Translate/Position:** Moving an element actually changes its position in the shared coordinate space.
- **Overscan on filters:** Blur can expand its data_window to avoid edge artifacts.
- **Crop vs. SetFormat:** Crop narrows data_window (deletes pixels). Reformat changes the canvas.
- **Multi-resolution workflows:** Work at proxy resolution, switch to full-res for export.
