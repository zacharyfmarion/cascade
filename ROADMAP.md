# Compositor Roadmap: Production-Grade Node Library

Gap analysis and prioritized plan for reaching moderately production-grade compositing capabilities.

---

## Current State (Inventory)

~50 registered nodes across 8 categories:

| Category | Nodes | Assessment |
|----------|-------|------------|
| **Input** | LoadImage, LoadImageSequence | Minimal |
| **Output** | Viewer, ExportImage, ExportImageSequence, ExportVideo | Decent |
| **Color** | BrightnessContrast, HueSaturation, Invert, Levels, **Curves** (per-channel, monotone cubic), ColorBalance, ChannelShuffle, Threshold, Posterize, Gamma, **Grade**, **Clamp**, ColorRamp, ColorPalette, SeparateHSVA, CombineHSVA, WhiteBalance, Vibrance, GradientMap, ToneMap, ColorConvert | **Strong** |
| **Filter** | GaussianBlur, Sharpen, EdgeDetect, Dilate, Erode, Median, Vignette, Glow, LensDistortion | Decent |
| **Composite** | Blend (19 modes), AlphaOver, **Merge** (14 Porter-Duff ops, bbox control) | Good |
| **Transform** | Resize, Crop, Flip, Rotate, Translate, Transform2D | Decent |
| **Generator** | SolidColor, Noise, Gradient, Checkerboard, RasterizeField, FloatConstant, IntegerConstant, Shape | Good |
| **Matte** | Premultiply, Unpremultiply, SetAlpha, ExtractChannel, ChromaKey, Despill, LuminanceKey, DifferenceMatte, EdgeBlur, MatteExpand, MatteShrink | **Good** |
| **Channel** | SeparateRGBA, CombineRGBA, CopyChannels, ChannelShuffle, ExtractChannel | **Good** |
| **Utility** | MapRange, Math | Minimal |
| **Other** | GroupNode system, GpuScript, AiInpaint | Nice extras |

---

## Tier 1: Critical Gaps (Blocking for Real Compositing)

### 1. No Mask/Roto Tools

Production compositing is 60% masking. Current coverage is thin.

**Missing nodes:**
- **Roto / Bezier shape masks** — editable bezier splines with per-point feathering, animatable per-frame. The most-used node in Nuke. The existing `Shape` node only does rectangles/ellipses/polygons, not freeform splines.
- **Luminance Key / Luma Matte** — key on brightness, not just color. Essential for sky replacements, window pulls.
- **Difference Matte** — compare clean plate vs. footage to generate matte. Standard green screen workflow.
- **IBK / Advanced Keyer** — ChromaKey uses simple Euclidean distance in RGB. Production keyers work in YCbCr/HSV, output core/soft/eroded mattes, and handle spill, translucency, and hair detail.
- **Matte operations** — dedicated EdgeBlur (blur just the matte edge), MatteShrink, MatteExpand, InvertMatte applied specifically to alpha channels.

### 2. ~~No Merge / Multi-Input Compositing Node~~ ✅ DONE

Blend and AlphaOver are 2-input only with no resolution negotiation.

**Missing:**
- **Merge node** with explicit bounding box control (union, intersection, A, B) and support for mismatched resolutions.
- **Porter-Duff operations beyond Over** — Stencil, Mask, In, Out, Atop, Xor.

### 3. ~~No Format / Resolution Awareness~~ ✅ DONE

This is architectural. Currently images are bare width×height pixel buffers.

**Missing concepts:**
- **Pixel aspect ratio**
- **Display window vs. data window** (bounding box)
- **Format** (project resolution)
- **Reformat node** — conform images to project resolution with letterbox/pillarbox/fit/fill/distort options
- **Overscan** — rendering beyond frame boundaries for filter effects near edges

When two images of different sizes meet at a Blend node, coordinates just clamp. There's no way to place a smaller image centered or at an offset within a larger canvas.

### 4. No 2D Tracking / Stabilization

**Missing nodes:**
- **Tracker** — track point(s) across frames, output transform data
- **Stabilize** — apply inverse of tracked motion
- **Corner Pin** — 4-point perspective distort (screen/sign replacement)

Without tracking, the most basic VFX shot (putting something on a wall, replacing a screen) is impossible.

---

## Tier 2: Major Gaps (Painful to Work Without)

### ~~5. Curves Node is Oversimplified~~ ✅ DONE

~~Current Curves uses 5 fixed control points with a cubic spline. Needs:~~
- ~~Arbitrary control point count (add/remove)~~
- ~~Per-channel curves (separate R, G, B, master)~~
- ~~Interactive curve editor widget in the UI~~

Implemented: Monotone cubic Hermite interpolation (Fritsch-Carlson), 4 independent curves (Master/R/G/B), SVG-based interactive curve editor with click-to-add, drag-to-move, right-click-to-delete, custom CurvesNode React component with channel tabs.

### 6. No Distort / Warp Nodes

Beyond LensDistortion:
- **IDistort / STMap** — distort using a UV map image (essential for CG integration)
- **Corner Pin / Perspective Transform** — 4-point warp
- **Mesh Warp** — freeform grid deformation
- **Spherize / Twirl / Wave** — creative distortions

### ~~7. No Motion Blur~~ ✅ PARTIALLY DONE

- **Vector blur / Directional blur** — blur along a vector field (from 3D motion vectors)
- ~~**Radial blur** — zoom-style blur~~ ✅ DONE
- ~~**Directional blur** — blur in a specific direction~~ ✅ DONE

~~Only isotropic Gaussian blur exists.~~ Directional and radial blur implemented. Vector blur (from motion vectors) remains for future CG integration work.

### 8. No Time Operations

For sequence/video work:
- **TimeOffset** — shift footage in time
- **TimeWarp / Retime** — speed up, slow down, reverse
- **FrameHold** — freeze on a specific frame
- **FrameBlend** — blend adjacent frames (cheap slow-mo)

`FrameTime` exists in the engine but no nodes manipulate it.

### 9. No Expression / Scripting for Params

Production compositors link parameters with expressions ("blur sigma = distance × 0.5"). The `promotable` system allows connections but there's no expression language. The Math node only does basic operations.

### 10. ~~Incomplete Channel Handling~~ ✅ DONE

- No **Separate/Combine RGBA** nodes (HSVA exists but not RGBA)
- No **Copy** node to selectively copy channels between images
- No **Shuffle2** equivalent (combine channels from two different sources)
- `ChannelShuffle` only works within a single image

---

## Tier 3: Nice-to-Have (Differentiators)

### 11. No 3D Compositing Awareness

- No deep compositing support
- No Z-depth channel or multi-channel EXR support
- No ZDefocus (depth-of-field from Z channel)
- No fog/atmosphere from depth
- No position pass support
- Image format is fixed at RGBA — no arbitrary AOV channels

### 12. Missing Common VFX Nodes

- ~~**Grade** node (lift/gamma/gain per channel — the workhorse of color correction in Nuke)~~ ✅ DONE
- ~~**Clamp** — clamp pixel values to a range~~ ✅ DONE
- **Unpremult → operation → Premult** convenience (toggle on nodes)
- **Mirror / Tile / Offset** for texture work
- **Grain** — add/remove film grain
- **Denoise** — spatial or temporal denoising
- **MotionBlur2D** on transforms (Translate/Rotate produce hard edges)
- **Text** node — render text to image
- **Dot** (pass-through for graph organization)

### ~~13. Blend Node Correctness Issues~~ ✅ DONE

~~Output alpha uses `base_a.max(blend_a)` which is incorrect for proper alpha compositing — should follow Porter-Duff rules per blend mode. This produces visible fringing with semi-transparent elements.~~
~~Output clamps to [0,1] which prevents HDR compositing (values >1.0 are meaningful).~~

Fixed: Alpha now uses Porter-Duff "over" formula (`blend_alpha + base_a * (1 - blend_alpha)`). RGB clamping removed to preserve HDR values.

### ~~14. GaussianBlur Dark Halo Artifacts~~ ✅ DONE

~~The blur implementation blurs all 4 channels including alpha. For compositing, you almost always want to blur RGB only and keep alpha intact, or blur alpha separately. Blurring premultiplied RGBA together creates dark halos around edges.~~

Fixed: Off-by-one in sliding window subtraction index corrected. Premultiply/unpremultiply sandwich added so transparent pixels don't bleed black into RGB. Sharpen node also fixed. Glow node switched from O(w×h×r) naive blur to O(w×h) sliding window (~10-20x speedup). Reference test added against naive Gaussian convolution.

---

## Architectural Constraints

1. **Field abstraction is clever but limiting** — Fields compose well for generators and color ops but can't do spatial filters (blur, sharpen, dilate) since those need neighboring pixel access. Every filter node must rasterize first, creating an impedance mismatch.

2. **No concept of "format" on connections** — the graph connects `Image` or `Field` values but carries no resolution metadata. A production compositor needs bounding box negotiation between nodes.

3. **No multi-channel / AOV system** — `Value::Image` is always RGBA. No way to carry depth, motion vectors, normals, cryptomatte, or arbitrary passes through the graph. This blocks CG integration workflows.

4. **No streaming / tile-based processing** — every node materializes full-resolution buffers. At 4K+ this becomes a memory bottleneck.

---

## Prioritized Implementation Order

Foundational work first, then nodes that unlock real workflows.

### Phase 1: Foundations

| # | Item | Type | Why |
|---|------|------|-----|
| 1 | ~~Format/resolution awareness on images + Reformat node~~ | Architecture + Node | ✅ DONE — Format, RectI, data_window, display_window, PixelAspectRatio all implemented |
| 2 | ~~Merge node with Porter-Duff ops and bbox control~~ | Node | ✅ DONE — 14 operations (Over, Under, In, Out, Atop, Xor, Stencil, Mask, Plus, Multiply, Difference, Screen, Max, Min), 4 bbox modes, opacity, mix, mask input. Verified against canonical Porter-Duff reference. |
| 3 | ~~Separate/Combine RGBA + Copy channels~~ | Nodes | ✅ DONE — SeparateRGBA, CombineRGBA, CopyChannels (Shuffle2-style, 2 inputs, per-channel source selection from A or B) |

### Phase 2: Color & Correction

| # | Item | Type | Why |
|---|------|------|-----|
| ~~4~~ | ~~Proper Curves (per-channel, arbitrary control points, UI widget)~~ ✅ | ~~Node + Frontend~~ | Monotone cubic Hermite, 4 channels, interactive SVG editor |
| 5 | ~~Grade node (lift/gamma/gain)~~ | Node | ✅ DONE — Per-channel lift/gamma/gain with mask support and field passthrough |
| 6 | ~~Clamp node~~ | Node | ✅ DONE — Per-channel min/max with optional alpha clamp, mask support, field passthrough |

### Phase 3: Masking & Keying

| # | Item | Type | Why |
|---|------|------|-----|
| 7 | Roto/mask shapes with bezier splines + feathering | Node + Frontend | The core masking tool (deferred) |
| ~~8~~ | ~~Luminance Key + Difference Matte~~ ✅ | ~~Nodes~~ | LuminanceKey (brightness/channel keying with soft range), DifferenceMatte (clean plate comparison) |
| ~~9~~ | ~~Matte operation nodes (EdgeBlur, shrink, expand)~~ ✅ | ~~Nodes~~ | EdgeBlur (alpha-edge-only blur), MatteExpand (dilate), MatteShrink (erode) |

### Phase 4: Transform & Distort

| # | Item | Type | Why |
|---|------|------|-----|
| 10 | Corner Pin transform | Node | Screen replacement, sign replacement |
| 11 | STMap / IDistort | Node | CG integration workflow |
| ~~12~~ | ~~Directional blur + Radial blur~~ ✅ | ~~Nodes~~ | DirectionalBlur (angle + length), RadialBlur (zoom-style, center point) |

### Phase 5: Time & Tracking

| # | Item | Type | Why |
|---|------|------|-----|
| 13 | Time nodes (offset, hold, retime) | Nodes | Required for any sequence work |
| 14 | 2D Tracker + Stabilize | Nodes | Unlocks matchmove workflows |

### Phase 6: Bug Fixes & Polish

| # | Item | Type | Why |
|---|------|------|-----|
| ~~15~~ | ~~Fix Blend node alpha compositing (Porter-Duff correctness)~~ ✅ | ~~Bug fix~~ | Porter-Duff "over" alpha, HDR-safe RGB |
| ~~16~~ | ~~Fix GaussianBlur alpha handling~~ ✅ | ~~Bug fix~~ | Off-by-one fix, premultiply sandwich, Sharpen/Glow also fixed |
| ~~17~~ | ~~Dot node (pass-through)~~ ✅ | ~~Node~~ | Pass-through for graph organization |
| ~~18~~ | ~~Text node~~ ✅ | ~~Node~~ | Render text to RGBA with ab_glyph, embedded font, multi-line, alignment |

---

## Pre-Release: AI Proxy Architecture

The AI nodes (Depth Estimate, Inpaint) call the Replicate API. In the browser, requests are proxied through a Cloudflare Worker (`workers/replicate-proxy/`) to avoid CORS. The Tauri desktop app calls Replicate directly (no CORS in native HTTP).

**Before release, rethink this approach:**
- The shared Cloudflare Worker means all users' API requests route through a single proxy. At scale this could hit free-tier limits (100K req/day) and creates a single point of failure.
- Options to evaluate: (1) let users deploy their own worker via one-click template, (2) move AI calls to a lightweight backend, (3) use Replicate's streaming API with server-sent events from a backend, (4) for the web version, require the desktop app for AI features.
