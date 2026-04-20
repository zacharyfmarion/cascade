# Custom Group Project Load Hydration

## Goal

Make project load rebuild the root graph UI from the engine's authoritative post-import state so custom group nodes render correctly after reopen, while failing fast if the engine/store contract is violated.

## Approach

Add a shared root-graph hydration helper in the graph store layer, replace ad hoc project/root rebuild logic with that helper, tighten load error handling, and add regression tests for successful and failed hydration.

## Affected Areas

- `apps/web/src/store/graphStore/`
- `apps/web/src/components/NodeCanvas.tsx`
- `apps/web/src/__tests__/`
- `apps/web/e2e/`

## Checklist

- [x] Confirm root cause and identify the authoritative engine/store hydration boundary
- [x] Add shared root hydration helper and route project/root rebuild paths through it
- [x] Harden project load and new-project state cleanup/error handling
- [x] Add store-level regression coverage for custom group hydration and failed loads
- [x] Add E2E regression coverage for custom group save/load rendering
- [x] Run required frontend validation and targeted tests
- [ ] Prepare PR notes and draft PR against `main`
