# Node Editor Empty State Personalization

## Goal

Make the empty node editor feel more tailored by rotating the title copy for first-time and returning users, while keeping drag-and-drop image flows unobstructed.

## Approach

- Detect first-time usage from existing Cascade-owned localStorage keys used by settings, layout, and theme persistence.
- Choose from ten empty-state title variants split between first-time and returning users.
- Hide the empty-state CTA while file content is being dragged over the node editor.
- Update focused frontend tests for title variants, returning-user behavior, and drag hiding.

## Affected Areas

- `apps/web/src/components/NodeCanvas.tsx`
- `apps/web/src/components/__tests__/NodeCanvasExamplesCta.test.ts`

## Checklist

- [x] Inspect existing localStorage persistence patterns.
- [x] Add empty-state title variant selection.
- [x] Hide the empty state during drag-and-drop.
- [x] Update focused frontend tests.
- [x] Run frontend validation.
