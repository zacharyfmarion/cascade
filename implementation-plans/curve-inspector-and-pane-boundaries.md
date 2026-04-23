# Curve Inspector And Pane Boundaries

## Goal

Fix live curve editing in the Inspector for Curves params, remove the temporary debug throw in `CurvesNode`, and add shared error boundary fallbacks around all major docked panes so isolated render failures do not crash the whole app.

## Approach

- Trace how Inspector renders `CurveEditor` and make it use the same live/draft-aware param flow that the node UI now uses.
- Replace the node-specific boundary helper with a shared component that can wrap both nodes and docked panes while preserving useful console diagnostics.
- Remove the temporary forced Curves render error used to verify the fallback UI.

## Affected Areas

- `apps/web/src/components/Inspector.tsx`
- `apps/web/src/components/nodes/CurvesNode.tsx`
- `apps/web/src/components/panels/PanelComponents.tsx`
- shared boundary component(s) under `apps/web/src/components/`
- `apps/web/src/store/graphStore/nodeDraftStore.ts`
- focused frontend tests

## Checklist

- [x] Inspect the current Inspector curve-edit path and pane component registration.
- [x] Introduce a shared error boundary wrapper usable by nodes and panes.
- [x] Fix Inspector curve editing to reflect live changes while dragging.
- [x] Remove the temporary Curves debug throw and keep fallback sizing reasonable.
- [x] Add or update focused frontend tests for the shared boundary behavior and inspector curve path.
- [x] Run frontend validation (`yarn test`, `yarn lint`, `npx tsc -b --noEmit`).
