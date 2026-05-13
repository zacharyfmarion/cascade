# Domain-Aware Viewer

## Goal

Render images using both display-window and data-window metadata so sparse, cropped, translated, preview-scaled, and mixed-size batch images display without stretching or losing their intended domain.

## Approach

- Keep node image-domain semantics intact; do not flatten sparse images into full display-window buffers.
- Carry display-window origin and data-window metadata through runtime, WASM, Tauri, and TypeScript viewer results.
- Position the viewer canvas as the data window inside a display-window-sized surface.
- Preserve existing preview downscale and mixed-size batch behavior.

## Affected Areas

- Runtime/WASM/Tauri viewer result transport.
- Frontend viewer result decoding, preview metadata, thumbnails, and canvas rendering.
- Rust and frontend tests for image domain behavior.

## Checklist

- [x] Add viewer domain metadata to Rust render results and bridge payloads.
- [x] Decode and preserve domain metadata in TypeScript viewer results.
- [x] Make the viewer and thumbnails render data windows inside display windows.
- [x] Add tests for normal, crop, translate, preview, compare, and batch paths.
- [x] Rebuild WASM artifacts needed by the web app.
- [x] Run full targeted and workspace validation.
