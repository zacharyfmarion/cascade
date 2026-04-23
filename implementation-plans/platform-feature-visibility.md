# Platform Feature Visibility

## Goal

Hide platform-specific features when they are not usable on the current runtime surface, starting with the desktop download CTA in the desktop app and desktop-only video nodes in the web app.

## Approach

Add shared runtime-surface helpers in the web app, expose node surface metadata in serialized node discovery, and use a filtered authoring catalog for node creation surfaces while preserving the full node spec list for compatibility with loaded projects. Keep existing wrong-platform nodes visible, but present them as unsupported instead of interactive.

## Affected Areas

- `crates/cascade-core/src/types.rs`
- `crates/cascade-wasm/src/lib.rs`
- `apps/tauri/src-tauri/src/lib.rs`
- `apps/web/src/platform/`
- `apps/web/src/App.tsx`
- `apps/web/src/components/AboutModal.tsx`
- `apps/web/src/components/NodeLibrary.tsx`
- `apps/web/src/components/CanvasContextMenu.tsx`
- `apps/web/src/components/AiAssistant.tsx`
- `apps/web/src/ai/`
- `apps/web/src/store/graphStore/slices/graphSlice.ts`
- `apps/web/src/components/nodes/LoadVideoNode.tsx`
- `apps/web/src/components/nodes/ExportVideoNode.tsx`
- frontend and Rust tests covering platform visibility

## Checklist

- [x] Review repo guidance, checkout state, and existing implementation plan patterns
- [x] Create a working branch for the feature
- [x] Add shared runtime-surface and feature-visibility helpers
- [x] Expose desktop-only node surface metadata in serialized node discovery
- [x] Hide desktop download CTAs on desktop surfaces
- [x] Filter desktop-only video nodes from web authoring surfaces and AI discovery
- [x] Keep wrong-platform video nodes visible with disabled unsupported-state UI
- [x] Add regression tests for runtime helpers, node filtering, store guardrails, and Rust metadata
- [x] Run required validation commands
- [ ] Commit changes and open a draft PR against `main`
