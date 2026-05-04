# GPU Script Preview Scale Regression

## Goal

Restore the existing preview-scale architecture for GPU Script nodes and fix the paths where
preview-scale pixel-space params stopped behaving like full-resolution renders.

## Approach

Remove the new full-scale node flag and rely on the existing `preview_scale` / `pixel_space_params`
mechanism. Preserve GPU Script `pixel_space_params` through frontend manifest parsing, building, and
DSL recompilation. Make normal viewer renders use engine-scaled preview results directly instead of
downscaling them a second time. Resolve the effective preview scale in one frontend helper before
engine renders so minimum-edge clamped previews scale pixel-space params like Gaussian blur sigma by
the actual preview size. Pass preview scale through the desktop root render command.

## Affected Areas

- `apps/web/src/ai/gpuScript.ts`
- `apps/web/src/ai/dsl/executor.ts`
- `apps/web/src/store/graphStore/kernel.ts`
- `apps/web/src/store/graphStore/slices/renderSlice.ts`
- `apps/web/src/engine/tauriEngine.ts`
- `apps/tauri/src-tauri/src/lib.rs`
- Frontend regression tests for manifest preservation, render scaling, and Tauri bridge forwarding

## Checklist

- [x] Remove the invented full-scale node API
- [x] Restore live render scaling to the existing preview-scale path
- [x] Stop normal viewer renders from double-downscaling engine preview results
- [x] Thread preview scale through the desktop root render command
- [x] Preserve GPU Script `pixel_space_params` through DSL recompilation
- [x] Use one frontend helper for effective preview scale before engine renders
- [x] Add regression tests for the missed frontend and bridge paths
- [x] Run focused and required validation
