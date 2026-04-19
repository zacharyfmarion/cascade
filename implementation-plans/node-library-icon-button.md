# Node Library Icon Button + Tailwind/Radix Foundation

## Goal

Replace the full-width "Import .compnode" button in the Node Library with a compact icon button to the right of the search field. Introduce Tailwind CSS v3 and Radix UI as the production styling foundation.

## Approach

Install Tailwind CSS v3, postcss, autoprefixer, `@radix-ui/react-tooltip`, and `class-variance-authority`. Copy `Tooltip` and `IconButton` UI primitives from openscad-studio (direct copy — same stack). Wrap the app root with `TooltipProvider`. Replace the import button with an `<IconButton title="Import custom node">` inline in the search row.

## Affected Areas

- `apps/web/package.json` — new deps
- `apps/web/tailwind.config.js` — new
- `apps/web/postcss.config.js` — new
- `apps/web/src/index.css` — `@tailwind utilities` directive
- `apps/web/src/components/ui/Tooltip.tsx` — new (Radix-based)
- `apps/web/src/components/ui/IconButton.tsx` — new (cva + Tailwind)
- `apps/web/src/App.tsx` — `TooltipProvider` wrapper
- `apps/web/src/components/NodeLibrary.tsx` — icon button in search row

## Checklist

- [x] Install deps
- [x] Create `tailwind.config.js` and `postcss.config.js`
- [x] Add `@tailwind utilities` to `src/index.css`
- [x] Create `Tooltip.tsx`
- [x] Create `IconButton.tsx`
- [x] Update `App.tsx` with `TooltipProvider`
- [x] Update `NodeLibrary.tsx`
- [ ] `yarn lint` passes
- [ ] `npx tsc -b --noEmit` passes
- [ ] Draft PR opened
