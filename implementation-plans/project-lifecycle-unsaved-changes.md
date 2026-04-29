# Project Lifecycle And Unsaved Changes

## Goal

Add a real document lifecycle so New, Open, Save, Save As, refresh, and close behave predictably across web and desktop.

## Checklist

- [x] Add project identity and guarded lifecycle state/actions to the graph store.
- [x] Add an in-app unsaved changes modal with Save, Discard, and Cancel.
- [x] Wire File menu, shortcuts, file picker, and Tauri close/quit events through guarded actions.
- [x] Hydrate desktop frontend state from the persistent native engine after refresh.
- [x] Add dev-only desktop save divergence protection.
- [x] Add store/component tests for lifecycle prompts and save/open behavior.
- [x] Run frontend validation and commit.

## Notes

- Browser refresh can only use native `beforeunload`.
- Desktop Save tracks the last opened/saved path; Save As always prompts.
- Web Save downloads a `.casc` and does not track a writable path.
