# Toggle Checkbox Replacement

## Goal

Replace every user-facing checkbox control in the Cascade web UI with a shared Toggle component ported from OpenSCAD Studio, preserving existing settings and node behavior.

## Approach

- Port the OpenSCAD Studio Toggle primitive backed by Radix Switch into `apps/web/src/components/ui/`.
- Add Cascade-native CSS custom property styling for toggle root and thumb states.
- Replace checkbox inputs in settings, inspector, script editor, and node primitives with the shared Toggle.
- Keep semantic labels and disabled behavior intact.

## Affected Areas

- `apps/web/package.json`
- `yarn.lock`
- `apps/web/src/components/ui/Toggle.tsx`
- `apps/web/src/components/ui/index.ts`
- `apps/web/src/styles/theme.css`
- Checkbox usage sites under `apps/web/src/components/`

## Checklist

- [x] Port Toggle component and dependency
- [x] Replace checkbox usages
- [x] Run frontend validation
- [x] Prepare PR handoff
