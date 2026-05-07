# Batch Filmstrip Source Thumbnails

## Goal

Show lazy, low-resolution source thumbnails for visible batch filmstrip items while keeping the
selected item as the only processed preview.

## Checklist

- [x] Add a shared, bounded, concurrent batch source thumbnail hook.
- [x] Reuse the hook in `LoadImageBatchNode`.
- [x] Show source thumbnails for visible non-selected viewer filmstrip batch items.
- [x] Add WASM and worker `getBatchThumbnail` bridge parity.
- [x] Remove full-image thumbnail fallback from the frontend store path.
- [x] Add hook, viewer behavior, and bridge coverage.
- [x] Run validation and commit locally without pushing.
