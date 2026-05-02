# Examples Pane

## Goal

Add a bundled example-project browser so new users can discover practical Cascade workflows from an empty node editor.

## Approach

- Ship example metadata in TypeScript and example projects as bundled `.casc` files under `apps/web/public/examples/`.
- Add an Examples panel beside Node Library and expose a layout-store helper that focuses or creates it.
- Add a graph-store action that opens examples through the existing bundled project loader, preserving unsaved-change prompts.
- Add an empty node-editor CTA that focuses the Examples panel.
- Cover catalog, layout, store, and CTA behavior with frontend tests.

## Affected Areas

- `apps/web/src/examples/`
- `apps/web/src/components/ExamplesPanel.tsx`
- `apps/web/src/components/NodeCanvas.tsx`
- `apps/web/src/components/panels/PanelComponents.tsx`
- `apps/web/src/store/layoutStore.ts`
- `apps/web/src/store/graphStore/`
- `apps/web/public/examples/`
- `apps/web/src/__tests__/`

## Checklist

- [x] Add example catalog and bundled example assets.
- [x] Implement example loading in the project store.
- [x] Add Examples panel and layout focus behavior.
- [x] Add empty editor CTA.
- [x] Add frontend tests.
- [x] Run frontend validation.
- [x] Replace synthetic starter plates with credited bundled Pexels assets.
- [x] Update the Voronoi custom effect to use a real jittered Voronoi shader.
- [x] Switch Pixel Art Palette Grade from the Pixelate group wrapper to the core GPU Pixelate node.
