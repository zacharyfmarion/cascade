# Bundled Casc Assets

## Goal

Add an explicit bundled project save path while keeping normal `.casc` saves lightweight and reference-based. Bundled saves should produce a portable zip-backed `.casc` containing project JSON plus deduplicated media assets, and both desktop and web should load bundled files.

## Approach

- Keep default desktop Save/Save As as plain JSON that preserves external references.
- Add a `bundleMedia` project-save option exposed by desktop and web save flows.
- Introduce package helpers that read/write zip-backed `.casc` files with `cascade.json` and content-hashed `assets/` blobs.
- Make load-image paths persist into the engine graph so unbundled desktop saves can round-trip references.
- Strip active loader path params and stale DSL shadows from bundled manifests once those assets are packed, so DSL serialization does not rediscover machine-local paths.
- Add broad unit coverage for package detection, dedupe, JSON compatibility, missing assets, and frontend bundled-save behavior.

## Affected Areas

- Runtime document asset metadata and migration compatibility.
- Tauri save/load commands and menu wiring.
- Web project store, engine bridges, and JSZip package helpers.
- Unit tests in Rust and frontend Vitest.

## Checklist

- [x] Add package manifest/data model helpers with Rust unit tests.
- [x] Update Tauri save/load to support default references and optional bundled packages.
- [x] Update web save/load to support bundled `.casc` packages.
- [x] Add menu/store actions for Save Bundled Copy.
- [x] Remove packed asset loader paths from bundled manifests.
- [x] Add extensive Rust and frontend unit tests.
- [x] Run required validation.
- [x] Open draft PR against main.
