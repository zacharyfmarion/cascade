# Red Button Examples Implementation

## Goal

Ship three bundled, DSL-backed examples that validate common image editing workflows: batch resize/export, watermark overlay, and social media variants.

## Approach

- Extend the existing `resize` node with an aspect-preserving `Fit Within` mode while preserving exact resize defaults.
- Keep watermark as a root-graph example composed from existing nodes, not a built-in group or primitive.
- Add a root export-all workflow for multiple `Export Image` nodes.
- Package the new examples as bundled `.casc` files with valid DSL shadow metadata and packed assets.

## Affected Areas

- `crates/cascade-nodes-std` resize behavior and tests.
- `apps/web/src/ai/dsl` tests and example compatibility coverage.
- `apps/web/src/store/graphStore` export-all behavior.
- `apps/web/public/examples` bundled projects, thumbnails, and catalog entries.

## Checklist

- [x] Add native resize fit mode and Rust tests.
- [x] Add native resize cover mode and tests.
- [x] Add export-all store/menu behavior and frontend tests.
- [x] Add DSL tests for resize and example graph shapes.
- [x] Generate bundled example `.casc` files with DSL shadows and assets.
- [x] Simplify watermark example to a rasterized text overlay.
- [x] Register examples in the catalog and credits.
- [x] Run targeted frontend and Rust validation.
