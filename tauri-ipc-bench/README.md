# Tauri IPC Bench

`tauri-ipc-bench` is a standalone Tauri v2 sandbox kept outside the main Cascade workspace. It is useful for ad hoc IPC experiments without touching the production desktop shell under `apps/tauri`.

The current scaffold is intentionally minimal: a Vite + TypeScript frontend calls a single Rust `greet` command through Tauri IPC. Add benchmark-specific commands here when measuring IPC overhead, payload shape, or frontend/backend serialization behavior.

## Commands

```bash
npm install
npm run dev
npm run build
npm run tauri dev
```

This package uses `package-lock.json`, not the root Yarn workspace.
