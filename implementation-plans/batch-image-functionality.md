# Batch Image Functionality

## Goal

Make batch image processing a first-class workflow in Cascade across web and desktop.

The intended user flow is:

- Web: select images, build a graph, render the batch, download a ZIP.
- Desktop: select images or an input folder, choose an output folder, render files directly into that folder with progress/cancel support.

This should support bundled examples later, but the first goal is to make real user batch work reliable.

## Current State

Implemented:

- `LoadImageBatch` stores an in-memory list of images and exposes `image` and `filename` outputs per frame.
- `ExportImageBatch` exists as a graph output node with PNG/JPEG format params.
- WASM exposes `batch_clear`, `batch_add_image`, and `get_batch_info`.
- Web `renderBatch()` iterates frames, calls `exportImage()`, and downloads `batch.zip`.
- `ExportImageSequence` on desktop already has output-folder selection and background render-job progress.

Current gaps:

- Tauri does not expose batch loading/info commands, so desktop batch nodes cannot load images today.
- Desktop batch export should write files to a selected folder instead of downloading a ZIP.
- Batch inputs are stored only in node memory and are not represented in `projectAssets`, so saved projects and bundled examples do not preserve batch sources.
- Native packaging explicitly skips batch manifests.
- Export naming is hardcoded to original source stems and duplicate suffixes; no template/prefix/suffix support.
- Batch UI exposes only "Select Images"; desktop users will expect folder input as well.

## Architecture

Keep the graph model simple:

- `LoadImageBatch` remains the source of batch frames.
- `ExportImageBatch` remains the render target.
- Batch export determines the number of frames by walking upstream from the export node to exactly one `LoadImageBatch`.

Platform behavior diverges only at the UI/bridge layer:

- Web renders to ZIP in the browser.
- Desktop renders directly to an output folder through a native background job.

Persist batch sources as project assets rather than fake paths:

- Each batch item should be stored as a project asset entry keyed by node id plus item id/index.
- The loader node should also have a compact manifest asset that preserves stable ordering and original filenames.
- Bundled `.casc` projects should include those assets and hydrate the engine-side `LoadImageBatch` automatically on open.

## Implementation Plan

### Phase 1: Desktop Bridge Parity

- Add Tauri commands:
  - `batch_clear(node_id)`
  - `batch_add_image(node_id, filename, data)`
  - `get_batch_info(export_node_id)`
- Implement matching `TauriEngine` methods.
- Register the commands in `invoke_handler`.
- Add unit tests or frontend engine tests for bridge calls.

Acceptance:

- `LoadImageBatchNode` can select multiple images in desktop builds.
- `ExportImageBatchNode` can resolve upstream batch count/filenames in desktop builds.

### Phase 2: Desktop Output Folder Export

- Add `output_dir` to `ExportImageBatch` params, hidden/promotable like `ExportImageSequence`.
- Add a native runtime method, likely `start_render_batch(export_node_id)`, modeled on `start_render_sequence`.
- The native batch job should:
  - Validate output directory before spawning.
  - Walk upstream to find exactly one `LoadImageBatch`.
  - Render frames `0..batch_count`.
  - Write files using source stems by default.
  - Deduplicate collisions with suffixes.
  - Report progress as image index/count.
  - Support cancel through existing job cancellation.
- Add Tauri command and `TauriEngine.renderBatch`.
- Update `ExportImageBatchNode`:
  - Web: keep `Render & Download Zip`.
  - Desktop: show `Select Output Folder`, then `Render Batch`.

Acceptance:

- Desktop renders individual `.png`/`.jpg` files into the selected folder.
- Web behavior remains ZIP download.
- Progress and cancel work on both platforms.

### Phase 3: Batch Asset Persistence

- Extend web `loadBatchFiles()` to add selected files to `projectAssets`.
- Define project asset records for batch frames, probably:
  - `type: "image_batch_frame"`
  - `source: "embedded" | "packed" | "external"`
  - `node_id`
  - `index`
  - `original_filename`
  - `hash`
  - `uri`
  - optional embedded `data`
- Create a batch manifest asset per node:
  - `type: "image_batch"`
  - ordered list of frame/item asset URIs and filenames.
- Update project hydration so opening a project replays the manifest into `LoadImageBatch`.
- Update browser bundled-project packaging to include batch frame assets and the manifest.
- Update native `project_package.rs`, replacing the current "not represented" skip with actual batch manifest URI rewriting/packing.

Acceptance:

- Save/reopen preserves batch selections.
- Bundled `.casc` files can contain batch sources.
- Example projects can ship with several batch inputs.

### Phase 4: Input Folder UX

- Desktop `LoadImageBatchNode` should offer:
  - Select Images
  - Select Folder
- Folder selection should filter supported image extensions and sort by filename.
- Web can keep file selection only unless folder upload is explicitly added with browser directory APIs.
- Store original filenames consistently; for desktop external assets, prefer durable file references when project asset storage is external.

Acceptance:

- Desktop users can pick a folder of images without multi-selecting files manually.
- Unsupported files are skipped and accepted images are sorted by filename.

### Phase 5: Export Naming

- Add naming params to `ExportImageBatch`:
  - `filename_template`, default `{name}`
  - collision behavior: append numeric suffix
- Supported tokens:
  - `{name}` original stem
  - `{index}` zero-based index
  - `{index1}` one-based index
  - `{width}`
  - `{height}`
  - `{ext}`
- Use the same naming function in web ZIP and desktop folder export.
- Add tests for token replacement, sanitization, and duplicate names.

Acceptance:

- Users can export `thumb_{name}.png`, `{index1}_{name}.jpg`, etc.
- Web and desktop produce matching names for the same graph/settings.

### Phase 6: Example Enablement

- Create a bundled batch example once persistence is complete:
  - Load Image Batch
  - Existing batch-safe processing nodes
  - optional light Photo Adjust/Curves
  - Export Image Batch
- Add catalog entry and thumbnail.
- Add an example smoke test that opens the bundled project and verifies batch info is present.

Acceptance:

- The example opens with bundled images already loaded.
- Web can render ZIP.
- Desktop can choose a folder and render individual files.

## Testing Strategy

- Rust:
  - `LoadImageBatch` order, filenames, decode errors.
  - `ExportImageBatch` naming params.
  - native `start_render_batch` happy path, no batch upstream, multiple batch upstream, cancel/error paths.
- Frontend:
  - `LoadImageBatchNode` web and desktop UI branches.
  - `ExportImageBatchNode` web ZIP branch and desktop output-folder branch.
  - `batchExportSlice` naming and progress behavior.
  - project save/load restores batch assets.
- Packaging:
  - bundled `.casc` includes batch manifest and frame assets.
  - opening bundled project hydrates engine batch state.
- Manual:
  - Web: select images, render ZIP, inspect filenames.
  - Desktop: select folder, select output folder, render files, cancel mid-render.

## Open Questions

- Should desktop external projects store batch input folders as durable folder references, per-file references, or only bundled assets?
- Should `LoadImageBatch` support recursive folders or only the selected folder's direct children?
- Should EXR/tiff/webp remain accepted for batch input if export is PNG/JPEG only?
- Should output overwrite existing files, skip them, or always add collision suffixes?
- Should web eventually support directory upload with `webkitdirectory`, or keep multi-file selection only?
- Fit/aspect-ratio resize is intentionally out of scope for this plan.

## Recommended First Slice

Start with Phase 1 and Phase 2 together. That gives desktop users a coherent batch workflow without waiting for packaging work:

- Select images.
- Select output folder.
- Render files directly.
- Show progress/cancel.

Then do persistence/packaging as the next slice so examples can be safely built on top of the working workflow.

## Checklist

- [x] Add desktop runtime/Tauri batch bridge parity.
- [x] Add native desktop folder batch rendering.
- [x] Split batch node UI between web ZIP and desktop folder export.
- [x] Persist and hydrate batch assets in `.casc` projects.
- [x] Pack and rewrite batch assets in bundled projects.
- [x] Add batch export naming templates.
- [x] Add focused Rust/frontend tests.
- [x] Run targeted validation.
