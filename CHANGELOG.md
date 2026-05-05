# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [0.2.1] - 2026-05-05

### Fixed
- Fixed macOS release builds so packaged DMGs no longer depend on Homebrew OpenColorIO libraries at launch.
- Fixed desktop close and Cmd+Q behavior so unsaved projects show the existing unsaved-changes prompt and clean or discarded projects close correctly.

## [0.2.0] - 2026-05-04

### Added
- Added bundled example projects and source assets so new users can explore finished Cascade workflows from the editor.
- Added a Compare Viewer node for side-by-side visual review.
- Added a Photo Adjust group for common color and tonal adjustments.
- Added hardened cnode package support and expanded DSL execution, serialization, and semantic validation coverage.

### Changed
- Moved macOS release builds to the local release pipeline for signed, notarized desktop artifacts.
- Refined editor controls with studio-styled buttons, toggles, and a personalized empty state.
- Updated the default image model to GPT Image 2.

### Fixed
- Restored preview-scale handling for pixel-space GPU parameters.
- Fixed duplicate DSL parameter mirrors and DSL input-default roundtripping.
- Improved live preview downscaling limits and web image sequence playback/caching.
- Fixed rotate edge sampling to zero-fill out-of-bounds pixels.

## [0.1.0] - 2026-04-24

### Added

- Node-based image processing engine with a Rust core and React node editor UI
- 35+ GPU kernel nodes for per-pixel color, blend, matte, transform, and utility operations (Brightness/Contrast, Hue/Saturation, Color Balance, Curves, Blur, Sharpen, Glow, Blend, AlphaOver, Merge with 14 Porter-Duff modes, Keying, and more)
- CPU standard node library including GaussianBlur, Dilate, ColorRamp, Invert, Resize, SeparateRGBA, CombineRGBA, CopyChannels, Shape, Text, Merge, KeyMix, and masking nodes
- Desktop application via Tauri v2 (macOS Apple Silicon)
- Web application deployed to Cloudflare Pages
- EXR file support with multi-layer dynamic output ports and lazy decoding
- Node groups with cycle detection and parameter passthrough
- Project save/load with automatic document migration
- AI assistant powered by Replicate — RemoveBackground, Upscale, GenerateImage, Inpaint, and DepthEstimate nodes
- Graph DSL editor (Monaco-based) with bidirectional sync to the node graph
- WASM multi-threading via wasm-bindgen-rayon for parallelised browser rendering
- OpenColorIO (OCIO) integration for display and view transforms
- Batch image processing pipeline (LoadImageBatch + ExportImageBatch)
- Video I/O support via macOS AVFoundation
- Viewer with channel isolation, pixel inspector, and gain/gamma controls
- Live parameter drag with worker-offloaded renders and preview scaling
- Undo/redo with serialised operation queuing
- 24 colour themes with syntax colour support
- Node library import, keyboard shortcuts modal, and toast notification system
- PostHog analytics integration
- macOS release workflow with notarisation and Homebrew cask distribution

### Fixed

- Accurate pixel-space parameter scaling across preview and commit render passes
- Stable custom group node rehydration after project load
- Correct alpha handling in Blend, GaussianBlur, Sharpen, and Glow nodes
- Worker viewer serialisation stability
- Transform 2D edge sample zero-fill for correct boundary behaviour

