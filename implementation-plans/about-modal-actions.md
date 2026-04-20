# About Modal Actions

## Goal

Update the web About modal to use the new product description, simplify the desktop CTA, remove the GitHub releases and Homebrew copy, and add top-right GitHub and Mac download icon links using the same interaction pattern as OpenSCAD Studio.

## Approach

Refactor the modal so its copy and outbound links are defined in one place, then update the layout to support the top-right icon actions and a single primary download CTA. Add focused frontend test coverage for the exported About modal content configuration instead of broad UI rendering infrastructure.

## Affected Areas

- `apps/web/src/components/AboutModal.tsx`
- `apps/web/src/__tests__/AboutModal.test.ts`

## Checklist

- [x] Define the About modal copy and outbound links in a single module
- [x] Update the modal layout with top-right GitHub and Mac download icon links
- [x] Remove GitHub releases/Homebrew copy and rename the primary CTA
- [x] Add focused regression coverage for the About modal content and links
- [x] Run frontend validation for the touched files
