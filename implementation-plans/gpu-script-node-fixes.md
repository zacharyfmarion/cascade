# Fix: GPU Script Node Reliability

## Goal

Fix the current GPU Script node regressions so authors can debug compile failures, use the node
inside groups, rely on the AI generation flow, edit script code from the DSL, and get a working
passthrough shader immediately when the node is created.

## Approach

Treat the compiled GPU Script manifest as durable node state instead of frontend-only scratch data.
Persist it in the engine, use it to auto-compile a default passthrough shader on node creation when
GPU support is available, and carry it through group/document serialization so group editing and
reloads keep the real spec.

On the web side, normalize GPU script error extraction, make the script editor read/write the
shared settings store, surface mask support in the inspector model, and extend the DSL
serializer/parser/executor to round-trip GPU script source as an editable multiline string that
recompiles the node when changed.

## Affected Areas

- `crates/cascade-runtime/src/lib.rs`
- `crates/cascade-wasm/src/lib.rs`
- `crates/cascade-gpu/src/manifest.rs`
- `crates/cascade-nodes-std/src/script.rs`
- `apps/web/src/components/ScriptNodeEditor.tsx`
- `apps/web/src/components/Inspector.tsx`
- `apps/web/src/store/graphStore/slices/graphSlice.ts`
- `apps/web/src/store/graphStore/slices/aiSlice.ts`
- `apps/web/src/engine/gpuScriptErrors.ts`
- `apps/web/src/ai/gpuScript.ts`
- `apps/web/src/ai/dsl/{serializer,parser,validator,executor,types}.ts`
- `apps/web/src/__tests__/graphStore.test.ts`
- `apps/web/src/ai/dsl/__tests__/serializer.test.ts`
- Runtime unit tests in `crates/cascade-runtime/src/lib.rs`

## Checklist

- [x] Add a shared default passthrough GPU script manifest helper
- [x] Persist compiled GPU script manifests in engine node params instead of frontend-only state
- [x] Auto-compile new GPU script nodes to a passthrough kernel when GPU is available
- [x] Ensure exported documents include GPU script manifests used by grouped/internal nodes
- [x] Preserve/recover GPU script specs for grouped nodes in the web store
- [x] Fix GPU compile error formatting so structured engine errors show the real message
- [x] Make the script editor use the shared Anthropic settings store
- [x] Surface mask support consistently in the GPU script inspector model
- [x] Extend DSL serialization/parsing for editable multiline GPU script source
- [x] Recompile GPU script nodes when DSL-edited source changes
- [x] Add runtime regression tests for default compilation and grouped/document GPU script manifests
- [x] Add frontend regression tests for grouped GPU script specs, multiline DSL serialization, and error formatting
- [x] Run targeted and required validation commands
