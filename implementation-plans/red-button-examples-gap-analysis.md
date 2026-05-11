# Red Button Examples Gap Analysis

## Goal

Use three practical examples to validate whether Cascade can handle common image-editing workflows end to end:

- Batch resize/export
- Watermark overlay
- Social media variant generator

These examples should double as product probes. If an example cannot be represented as a bundled `.casc` project without special setup, the missing piece should become a feature gap.

## Current Support Summary

### Batch Resize / Export

Status: partially supported.

Existing pieces:

- `load_image_batch` exists and evaluates one batch item per frame.
- `export_image_batch` exists and accepts image plus filename inputs.
- Web/WASM batch export renders each frame and downloads `batch.zip`.
- Resize, crop, color adjustment, and export nodes already exist.

Gaps:

- Desktop/Tauri does not expose `batchClear`, `batchAddImage`, or `getBatchInfo`, so the current batch UI is effectively web-only.
- Batch-selected files are held in engine memory but are not added to `projectAssets`, so batch examples cannot currently be shipped as self-contained bundled `.casc` files.
- Native project packaging explicitly notes that batch manifests are not represented yet.
- Export naming is fixed to source stems inside `batch.zip`; there is no user-facing naming template, output directory, prefix/suffix, dimensions token, or variant token.
- There is no resize-to-fit/max-dimension node. The existing Resize node uses fixed width and height, so aspect-ratio-preserving batch resize needs a custom node or manual per-image dimensions.

Example plan:

1. Add or fix persistent batch asset support so examples can bundle several source images.
2. Add Tauri batch bridge methods matching the WASM bridge.
3. Create a bundled example graph:
   - Load Image Batch
   - Resize or Fit Resize
   - optional Photo Adjust / Curves
   - Export Image Batch
4. Add thumbnail and catalog entry under Getting Started.

### Watermark Overlay

Status: mostly supported as a graph, not yet ergonomic as a reusable example.

Existing pieces:

- Single-image loading supports embedded bundled assets.
- GPU composite nodes include Alpha Over and Blend.
- Transform nodes include Resize, Translate, Crop, and GPU Transform 2D.
- Project format settings can control generator canvas size.
- Groups/custom nodes can package reusable node graphs.

Gaps:

- There is no dedicated Watermark node with position preset, margin, scale-to-width, opacity, and anchor controls.
- Transform 2D uses center-based translation/scale, not anchor-based layout, so "bottom-right with 48 px margin" is awkward.
- Logo/image sizing is fixed/manual; no "scale logo to 12% of background width" behavior.
- Text/metadata is available as generator nodes, but filename-driven text is not connected to batch metadata in a polished way.
- A production example needs bundled logo/source assets and clear graph naming.

Example plan:

1. Build the first example with existing primitives:
   - Load Image Batch or Load Image
   - Load logo image
   - Resize/Transform logo
   - Translate logo
   - Alpha Over
   - Export Image or Export Image Batch
2. If the graph is too fussy, promote a custom group named Watermark Overlay.
3. If group controls are still awkward, implement a first-class GPU Watermark/Overlay node.
4. Add the example as both a single-image compositing demo and, after batch persistence lands, a batch watermark demo.

### Social Media Variant Generator

Status: possible only as a manual multi-output graph.

Existing pieces:

- Crop and Resize can create fixed-size variants.
- Multiple Export Image nodes can exist in one project.
- Project resolution can be changed manually.
- Groups can encapsulate repeated transform logic.

Gaps:

- There is no multi-export action that renders all export nodes in one command.
- There is no variant/list type, collection output, or fan-out node for "generate square, portrait, landscape" from one source.
- There are no aspect-ratio presets, safe-area guides, or fit/fill crop controls.
- The app does not expose a focal point/smart crop workflow.
- Export filenames do not include variant tokens.

Example plan:

1. Start with a manual graph:
   - Load Image
   - three Crop/Resize branches: square, portrait, landscape
   - three Export Image nodes
2. Use this as the example only if users can understand the separate export actions.
3. Prefer adding a batch/multi-export workflow before making this a headline example.
4. Longer term, add a Variant Generator custom node/group with explicit outputs:
   - square
   - portrait
   - landscape

## Recommended Feature Order

1. Batch asset persistence and bundled batch example support.
2. Desktop/Tauri batch bridge parity.
3. Fit Resize node or Resize mode that preserves aspect ratio.
4. Watermark Overlay group or first-class node with anchor/margin controls.
5. Multi-export / render-all-export-nodes action.
6. Variant preset node or grouped example once multi-export exists.

## Candidate Catalog Entries

- Batch Resize Export: Getting Started; required nodes `load_image_batch`, `resize`, `export_image_batch`.
- Watermark Overlay: Getting Started or Compositing; required nodes `load_image`, `gpu_kernel::transform_2d`, `gpu_kernel::alpha_over`, `export_image`.
- Social Media Variants: Getting Started; required nodes `load_image`, `crop`, `resize`, `export_image`.
