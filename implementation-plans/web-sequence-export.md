# Web Sequence Export

## Goal

Make image sequence export work in the web/WASM app by routing browser exports through the existing frame-by-frame ZIP renderer, while keeping desktop/Tauri sequence export on the native background job path.

## Approach

- Treat `renderSequence` as a native desktop job capability instead of a universal engine method.
- Remove unsupported WASM worker job stubs that mask the web ZIP fallback.
- Keep web sequence export in the Zustand export slice: derive the default range from connected sequence metadata, prepare each selected frame, export the connected output node for that frame, and download a ZIP.
- Add regression coverage so a web-like engine with a rejecting native job method no longer surfaces "Sequence rendering is not supported in WASM engine".

## Affected Areas

- `apps/web/src/engine/workerEngine.ts`
- `apps/web/src/engine/engineWorker.ts`
- `apps/web/src/store/graphStore/slices/batchExportSlice.ts`
- `apps/web/src/__tests__/graphStore.test.ts`

## Checklist

- [x] Create feature branch and implementation plan.
- [x] Refactor web sequence export to avoid unsupported WASM render jobs.
- [x] Add frontend regression coverage for web sequence ZIP export.
- [x] Run targeted frontend tests and validation.
- [x] Prepare local changes for draft PR handoff.
