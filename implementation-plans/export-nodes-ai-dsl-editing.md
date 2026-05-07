# Fix Export Nodes In AI/DSL Editing

## Goal

Make export destination params representable by Cascade DSL so AI graph edits can safely read, write, and round-trip graphs containing export nodes.

## Approach

- [x] Correct export path/directory node spec types to match their string defaults.
- [x] Add Rust node-spec consistency coverage for scalar non-dropdown params.
- [x] Add frontend DSL parser/validator/serializer tests for `ExportImageBatch`.
- [x] Add AI tool coverage for editing a graph containing `ExportImageBatch` and for schema reporting.
- [x] Run targeted Rust and frontend validation.
