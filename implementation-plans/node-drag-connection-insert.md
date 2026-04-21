# Node Drag Connection Insert

## Goal

Allow dragging an existing node over an existing connection and dropping to insert that node into the connection, matching the auto-insert behavior that already exists when dragging a node from the node library.

## Approach

Refactor the edge hit-testing and compatibility checks in `NodeCanvas` into shared helpers, then reuse that insertion path from both the library-drop flow and the in-canvas node drag-stop flow. Add focused frontend regression tests for the extracted insertion logic.

## Affected Areas

- `apps/web/src/components/NodeCanvas.tsx`
- `apps/web/src/components/`
- `apps/web/src/**/*.test.ts`

## Checklist

- [x] Inspect the existing library-drop insertion flow and drag handlers
- [x] Extract shared edge hit-testing and insertion eligibility helpers
- [x] Reuse shared insertion logic for in-canvas node drags
- [x] Add focused frontend regression coverage
- [x] Run frontend validation and prepare PR handoff
