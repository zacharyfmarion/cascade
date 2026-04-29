# Targeted Group DSL Fix

## Goal

- [x] Keep the DSL editor as a document-level projection while the canvas is inside a group.
- [x] Lay out DSL-created group input/output boundary nodes so they are visible when entering the group.
- [x] Update AI guidance to use only the supported group DSL syntax.
- [x] Add regression tests and validate with frontend test, lint, and typecheck.

## Notes

- This is intentionally not the larger multi-tab graph-view/session refactor.
- The existing group editing mutation routing stays in place.
- Root/document DSL edits are not applied while viewing a group, because the current store routes mutations to group internals in that context.
