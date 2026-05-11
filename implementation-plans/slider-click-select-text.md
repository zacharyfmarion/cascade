# Slider Click Select Text

## Goal

Make clicking a node slider's numeric value editor select the current text immediately, so users can type a replacement value without manually highlighting the existing number.

## Approach

Update the shared `NodeSlider` component so the text input is focused and selected when the slider enters edit mode after a click. Keep selection tied to edit-mode entry only, so subsequent typing is not reselected on every render. Add focused component coverage for the click-to-edit interaction.

## Affected Areas

- `apps/web/src/components/nodes/NodeSlider.tsx`
- `apps/web/src/components/nodes/__tests__/NodeSlider.test.tsx`

## Checklist

- [x] Update shared slider edit-mode focus behavior
- [x] Add frontend test coverage for click-to-select
- [x] Run frontend lint
- [x] Run frontend typecheck
