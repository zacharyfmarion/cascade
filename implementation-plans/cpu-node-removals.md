# CPU Node Removal Plan

## Goal
Remove specified CPU node structs and their `impl Node` blocks from `crates/cascade-nodes-std/src/`, while preserving all other nodes and required helpers/imports.

## Scope
- `crates/cascade-nodes-std/src/color.rs`
- `crates/cascade-nodes-std/src/color_ops.rs`
- `crates/cascade-nodes-std/src/blend.rs`
- `crates/cascade-nodes-std/src/matte.rs`
- `crates/cascade-nodes-std/src/filter_ops.rs`
- `crates/cascade-nodes-std/src/transform.rs`
- `crates/cascade-nodes-std/src/utility.rs`

## Checklist
- [x] Remove listed structs/impls from remaining files
- [x] Clean up unused helpers/imports after removals
- [x] Fix syntax errors from large deletions
- [ ] Run `lsp_diagnostics` on changed files (no build)

## Notes
- Do not modify `lib.rs`
- Do not touch GPU files
- Keep blend enums/helpers used elsewhere
