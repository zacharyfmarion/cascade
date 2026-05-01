# First-Class Asset DSL

## Goal

Make bundled assets first-class project resources in the save/load and DSL layers. Bundled projects should preserve accurate DSL by referencing packed assets with canonical `asset://sha256/<hash>` URIs instead of deleting DSL shadows or omitting loader params.

## Approach

- Add project-level asset storage state (`external`, `bundled`, or unset before first save).
- Keep loader graph params wire-compatible as strings for now, but treat `asset://sha256/...` as internal project asset references at package, DSL, and executor boundaries.
- Rewrite packed asset graph params and DSL shadow text to canonical asset URIs during bundled package creation.
- Repair older bundled files with stripped loader params on load by deriving asset URI params from the package manifest.
- Add a first-save asset storage prompt and a Project settings control for the current project.
- Document the technical debt and future goal of migrating loader params to a true `AssetRef` param model.

## Affected Areas

- Web project store, project package helper, DSL executor/serializer tests, and settings/modal UI.
- Tauri project package save/load helpers and asset metadata serialization.
- Runtime document asset metadata compatibility.
- Documentation under `docs/`.

## Checklist

- [x] Add asset URI helpers and project asset storage state.
- [x] Replace strip/delete bundled save behavior with URI rewriting and DSL preservation.
- [x] Repair loaded bundled manifests and resolve `asset://` edits through project assets where possible.
- [x] Add first-save prompt and Project settings control.
- [x] Update Tauri package writing to emit URI params and preserve DSL metadata.
- [x] Add Technical Debt doc for the AssetRef decision.
- [x] Add/update frontend and Rust tests.
- [x] Run focused and required validation.
