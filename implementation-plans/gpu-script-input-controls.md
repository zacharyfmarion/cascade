# GPU Script Inputs And Controls Refactor

## Goal

Refactor GPU Script authoring so user-created controls are scalar input ports on the node instead
of separate shader params. Draft interface edits should remain local until `Apply & Compile`
succeeds, then the compiled manifest becomes the durable source of truth for node ports and inline
controls.

## Approach

Extend GPU script manifest ports to carry optional scalar control metadata, update Rust and
TypeScript spec generation so scalar inputs expose defaults/ranges/UI hints, and migrate legacy
manifest `params` into scalar input rows in the editor. Keep the backend compile path responsible
for validating and applying port changes, while the frontend updates local specs and input defaults
after successful compile.

## Affected Areas

- `crates/cascade-gpu/src/manifest.rs`
- `crates/cascade-runtime/src/lib.rs`
- `apps/web/src/ai/gpuScript.ts`
- `apps/web/src/components/ScriptNodeEditor.tsx`
- `apps/web/src/store/graphStore/slices/aiSlice.ts`
- GPU script frontend and runtime regression tests

## Checklist

- [x] Extend manifest port metadata in Rust and TypeScript
- [x] Generate scalar input port specs with defaults/ranges/UI hints
- [x] Refactor `ScriptNodeEditor` to use unified input/control drafts
- [x] Migrate legacy manifest params into scalar inputs on editor load/save
- [x] Update compile success handling to refresh specs and scalar input defaults
- [x] Add frontend and Rust regression tests
- [x] Run focused web and Rust validation
