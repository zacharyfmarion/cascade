# Cascade Button System

## Goal

Replace one-off Cascade button styling with shared button primitives that match the OpenSCAD Studio button API and visual treatment, fixing the low-contrast action buttons across the web app.

## Approach

- Add a shared `Button` primitive and shared control style constants under `apps/web/src/components/ui/`.
- Update `IconButton` to use the same sizing, radius, focus, disabled, active, and hover treatment.
- Add a typed `text.inverse` theme token and replace undefined `--text-on-accent` references.
- Migrate standard text, icon-text, and icon-only action buttons to `Button` or `IconButton`.
- Keep menu/list-row and specialized graph controls semantic while aligning their token usage and contrast.

## Affected Areas

- `apps/web/src/components/ui/`
- `apps/web/src/components/`
- `apps/web/src/components/nodes/`
- `apps/web/src/styles/theme.css`
- `apps/web/src/themes/`
- Frontend component tests covering migrated behavior

## Checklist

- [x] Prepare branch from latest `origin/main`
- [x] Confirm examples CTA exists in the current worktree
- [x] Install frontend dependencies
- [x] Create implementation plan
- [x] Add shared button primitives and theme token
- [x] Migrate app button surfaces
- [x] Add or update focused frontend tests
- [x] Run frontend lint, stylelint, and typecheck
- [x] Run targeted frontend tests
- [x] Start dev server and visually verify key button surfaces
- [x] Open draft PR against `main`
- [x] Remove rounding from specialized settings sidebar tabs and restore preset button height
