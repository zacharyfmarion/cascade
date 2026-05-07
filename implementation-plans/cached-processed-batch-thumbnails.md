# Cached Processed Batch Thumbnails

Add opportunistic processed thumbnail caching for batch viewer filmstrips and make source/processed thumbnails preserve aspect ratio with fixed-height, variable-width tiles.

## Checklist

- [x] Create the requested local checkpoint commit.
- [x] Update shared thumbnail loading to return dimensions with bounded URL caching.
- [x] Extend `MediaVirtualStrip` to support variable-width estimates.
- [x] Cache processed thumbnails in `Viewer` only from already-rendered active frames.
- [x] Use fixed-height, aspect-preserving thumbnails in the viewer filmstrip.
- [x] Use the same aspect-preserving strip behavior in `LoadImageBatchNode`.
- [x] Add frontend tests for source thumbnail dimensions, cache invalidation, and non-current render boundaries.
- [x] Run the requested Rust/frontend validation.
- [x] Commit locally without pushing.
