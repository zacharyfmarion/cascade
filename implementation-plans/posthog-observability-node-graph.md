# PostHog Observability Node Graph

## Goal

Add a privacy-safe PostHog observability foundation to the Cascade web app and instrument the core node-graph structural events needed for launch-day product analytics.

## Approach

- Add a small analytics layer in `apps/web` that initializes PostHog from Vite env vars, exposes runtime helpers, and no-ops cleanly when analytics is disabled or unconfigured.
- Extend the settings store and Settings modal with a persistent analytics consent toggle so capture can be disabled locally.
- Instrument the graph store at the existing mutation boundaries so events are emitted only for high-signal graph structure changes, not parameter edits.
- Add focused tests for settings persistence, runtime consent behavior, and graph event payloads.

## Affected Areas

- `apps/web/package.json`
- `apps/web/src/main.tsx`
- `apps/web/src/components/SettingsModal.tsx`
- `apps/web/src/store/settingsStore.ts`
- `apps/web/src/store/graphStore/slices/graphSlice.ts`
- `apps/web/src/store/graphStore/slices/selectionSlice.ts`
- `apps/web/src/__tests__/settingsStore.test.ts`
- `apps/web/src/__tests__/graphStore.test.ts`
- `apps/web/src/analytics/`
- `apps/web/src/vite-env.d.ts`
- `docs/analytics.md`

## Checklist

- [x] Review existing frontend/store patterns and the OpenSCAD Studio PostHog reference
- [x] Create a repo implementation plan for the feature
- [x] Add PostHog dependencies and analytics bootstrap/runtime helpers
- [x] Add persistent analytics consent to settings and expose it in the Settings modal
- [x] Instrument node graph structural events in the graph and selection slices
- [x] Add focused frontend tests for consent and event capture
- [x] Document the analytics contract and validation results
