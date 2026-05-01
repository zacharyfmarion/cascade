# Photo Adjust Group

## Goal

Ship a photographer-friendly built-in `Photo Adjust` group that covers common exposure, white balance, contrast, shadows, highlights, whites, and blacks edits while preserving Cascade's composable node architecture and using the same GPU-kernel node path as the rest of the app.

## Approach

- Add small reusable GPU kernels under explicit `gpu_kernel::` IDs for white balance, exposure, contrast, and luminance-zone adjustment.
- Remove the CPU helper nodes so the public node registry has one source of truth for these operations.
- Give each adjustment kernel one intentional mask input and route the group mask into each internal operation.
- Keep `gpu_kernel::key_mix` available as a standalone optional-mask mixer, but do not use it inside Photo Adjust because per-operation masks already preserve the original image outside the mask.
- Add the built-in `group::photo_adjust` composition using those GPU kernels, with the group control ports visibly wired into the internal node control ports.
- Register `Photo Adjust` only when GPU kernels are available, matching the existing Pixelate group behavior.
- Keep the DSL representation concise by treating `PhotoAdjust(...)` as a built-in node call, not a lifted custom group definition, while storing the controls as scalar input defaults instead of hidden promoted params.
- Add targeted Rust and DSL tests for the new behavior.

## Affected Areas

- `crates/cascade-gpu`: adjustment kernel manifests and optional-mask Key Mix behavior.
- `crates/cascade-nodes-std`: removal of obsolete CPU adjustment and key mix helpers.
- `crates/cascade-runtime`: built-in group registration and runtime tests.
- `apps/web/src/ai/dsl`: built-in group DSL naming and round-trip tests.
- `apps/web/src/engine/mockEngine.ts` and node icons if frontend tests need local specs.

## Checklist

- [x] Rebase/update from latest `main` and create `codex/photo-adjust-group`.
- [x] Implement GPU adjustment kernels and register them under `gpu_kernel::` IDs.
- [x] Remove the CPU adjustment/key mix helpers from `cascade-nodes-std`.
- [x] Add `group::photo_adjust` built-in group with visible control and mask wiring to GPU kernels.
- [x] Gate web Photo Adjust registration on GPU availability.
- [x] Patch DSL built-in group naming/round-trip behavior for scalar input defaults.
- [x] Add/update tests for GPU kernels, runtime group exposure, DSL serialization, and web Photo Adjust behavior.
- [x] Run required Rust/frontend validation.
- [x] Push branch and update the draft PR against `main`.
