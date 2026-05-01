# AI Result Bundled Assets

## Goal
Ensure generated AI node outputs persist across project saves, including bundled `.casc` packages, by treating cached AI results as first-class project assets.

## Approach
- Serialize cached AI node image outputs into the project asset manifest as `ai_result` entries.
- For bundled saves, write AI result bytes into the zip asset store and reference them by hash-backed `asset://sha256/...` metadata.
- For external/plain JSON saves, embed AI result bytes because generated output has no durable filesystem path.
- On project load, hydrate `ai_result` assets back into the runtime AI node cache via the engine API.
- Add regression tests that prove packed and embedded AI results survive save/load boundaries.

## Affected Files
- `apps/tauri/src-tauri/src/lib.rs`
- `apps/web/src/store/graphStore/projectPackage.ts`
- `apps/web/src/store/graphStore/__tests__/projectPackage.test.ts`
- `implementation-plans/ai-result-bundled-assets.md`

## Checklist
- [x] Add helpers for collecting cached AI result assets.
- [x] Include AI result assets in desktop external and bundled save paths.
- [x] Hydrate AI result assets on desktop load.
- [x] Add regression tests for packed save and load hydration.
- [x] Run focused Rust validation.
