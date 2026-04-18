# Desktop Live Preview Scaling

## Goal

Make desktop live parameter drags use reduced-resolution preview rendering so slider interaction matches web responsiveness more closely without changing broader bridge architecture.

## Approach

- Thread `previewScale` through the desktop `setAndRender` path only.
- Teach the Tauri commands and native runtime live-render helpers to evaluate at preview scale during drags and full resolution on commit.
- Limit native live renders to affected viewers instead of all viewers.
- Validate the Rust and TypeScript surfaces touched by the change.

## Affected Areas

- `apps/web/src/engine/tauriEngine.ts`
- `apps/tauri/src-tauri/src/lib.rs`
- `crates/cascade-runtime/src/lib.rs`

## Checklist

- [x] Add desktop bridge support for `previewScale` on live render IPC
- [x] Update Tauri commands to accept and forward preview scale
- [x] Update native runtime live render helpers to use preview scale and affected viewers
- [x] Run targeted validation for Rust and frontend changes
