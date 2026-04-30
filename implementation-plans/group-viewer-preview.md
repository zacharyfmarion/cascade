# Group Viewer Preview

## Goal

- [x] Allow local Viewer nodes inside group edit mode to render group internals.
- [x] Make internal group connection type compatibility match root graph compatibility.
- [x] Route frontend viewer rendering through internal render APIs while editing a group.
- [x] Add Rust and frontend regression coverage.
- [x] Validate the finished change.

## Approach

- Add a runtime API that evaluates an internal Viewer node for a concrete root group instance.
- Expose the API through WASM, Tauri IPC, and the frontend engine bridge.
- Keep root Viewer nodes hidden while inside a group, but make local group Viewer nodes work as preview probes.
- Reuse the existing `Any` compatibility helper for native internal group connections.

## Affected Areas

- Rust runtime group editing and rendering.
- WASM and Tauri engine bridge surfaces.
- Frontend graph store rendering logic.
- Group/runtime tests and frontend store tests.

## Checklist

- [x] Native internal connections use shared type compatibility.
- [x] Runtime can render an internal Viewer using root group inputs.
- [x] WASM and Tauri expose internal viewer rendering.
- [x] Frontend render slice uses internal rendering in group edit mode.
- [x] Tests cover internal Viewer connection/rendering and root rendering regressions.
- [x] Validation passes.
