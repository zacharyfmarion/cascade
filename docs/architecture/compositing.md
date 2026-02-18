# Compositing Architecture

This document describes the coordinate system, image representation, and compositing logic used in the engine. The system is designed to handle images of arbitrary sizes and resolutions in a shared coordinate space.

## 1. Coordinate System

The engine uses a global integer coordinate space defined by `i32` values for both the X and Y axes. Every image carries two primary spatial definitions:

- **data_window (RectI)**: Defines the rectangular region that contains actual pixel data. It follows a half-open `[min, max)` convention. Coordinates within this window map to memory in the pixel buffer.
- **format (Format)**: Defines the display canvas, consisting of a `display_window` and a `pixel_aspect_ratio`. This represents the intended output resolution (e.g., 1920x1080).

The `data_window` is independent of the `display_window`. It can be smaller (a cropped element), larger (an overscan image), or shifted into negative coordinates (a translated element).

## 2. Image Sampling

The primary API for retrieving pixel data is `Image::get_rgba(x: i32, y: i32)`. This method handles coordinate mapping and bounds checking:

- If `(x, y)` is inside the `data_window`, it returns the pixel color from the buffer.
- If `(x, y)` is outside the `data_window`, it returns transparent black `[0.0, 0.0, 0.0, 0.0]`.

Internally, `Image::index_of(x, y)` converts global coordinates to a buffer index relative to the `data_window.min`. Pixel data is stored densely only for the region defined by the `data_window`, ensuring no memory is wasted on empty areas of the global coordinate space.

## 3. Compositing Nodes (AlphaOver, Blend)

Compositing nodes combine multiple inputs by iterating over the union of their spatial domains.

- **Output data_window**: Calculated as the union of all input `data_windows`.
- **Output format**: Inherited from the first or primary input (e.g., the background input for AlphaOver).

During execution, every pixel in the union `data_window` is sampled for all inputs using `get_rgba(x, y)`. Because sampling outside a `data_window` returns transparent black, images of different sizes and positions can be blended without explicit alignment steps.

All pixel-level loops are parallelized using Rayon's `par_chunks_exact_mut(4)`, which processes four `f32` channels (RGBA) at a time for optimal SIMD performance.

## 4. Format Propagation Rules

Information flows through the graph according to these rules:

- **Single-input nodes**: Nodes like color corrections or simple filters pass the input's `format` and `data_window` to the output unchanged.
- **Multi-input nodes**: These nodes take their `format` from the primary input. The output `data_window` is the union of all input windows.
- **Generators**: Nodes such as SolidColor or Noise produce resolution-independent `Fields`. These are rasterized to the `project_format` when they reach a node that requires a concrete `Image`.
- **Transform nodes**: These nodes modify the `data_window`. For example, a Translate node offsets the window, while a Crop node intersects it with a fixed region.

## 5. Transform Nodes

Transform nodes modify the spatial relationship between an image's pixel data and the global coordinate space.

### Translate

A zero-cost metadata-only operation. The pixel buffer is shared via `Arc` clone — no pixel data is copied. Only the `data_window` is offset by `(dx, dy)`.

### Crop

The crop rectangle is specified in global coordinates `(x, y, width, height)`. The output `data_window` is the intersection of this rectangle with the input's `data_window`. Pixels are sampled from the input using `get_rgba()`. If the crop rect doesn't overlap the input at all, a 1×1 transparent image is produced.

### Rotate

Rotation happens around the center of the input's `data_window` in global coordinates. The four corners of the `data_window` are forward-transformed to compute the output bounding box. During pixel evaluation, an inverse rotation maps each output pixel back to source coordinates. Both nearest-neighbor and bilinear sampling are supported.

### Resize

Resize produces a completely new resolution. The output `format` and `data_window` are both set to `(0,0)→(out_w, out_h)` via `Format::from_dimensions()`. Three filter modes are available: nearest-neighbor, bilinear, and bicubic (Mitchell-Netravali). The input's `color_space` is preserved.

### Transform2D

A unified translate + rotate + scale operation in a single pass. The pivot point is specified as a normalized fraction `(0..1)` of the input's `data_window` dimensions, mapped to global coordinates. The output bounding box is computed by forward-transforming all four corners of the input's `data_window` through the scale → rotate → translate pipeline. The inverse transform maps output pixels back to source local coordinates for sampling.

### Flip

Flips pixel data horizontally and/or vertically within the existing `data_window`. Both `format` and `data_window` are passed through unchanged.

## 6. Field Rasterization

`Fields` represent images as continuous functions of `(u, v) → [r, g, b, a]`. The UV space is normalized such that `(0,0)` to `(1,1)` maps exactly to the `display_window` of the current `format`.

When a `Field` is connected to an input expecting an `Image`, the evaluator automatically triggers rasterization. The domain for this operation is determined by the first sibling `Image` input's domain. If no `Image` inputs exist in the node, the `project_format` is used as the default rasterization target.

## 7. Masks

Masks are standard `Image` types. Their influence is determined by their luminance, calculated using the BT.709 coefficients: `0.2126R + 0.7152G + 0.0722B`.

Mask sampling follows the same global coordinate system via `get_rgba(x, y)`. This ensures that a mask correctly aligns with the image it is modifying, even if their `data_windows` differ. The `mask_utils::apply_mask()` function performs a linear interpolation (lerp) between the original pixel and the processed pixel based on the mask's luminance value.
