# Web Bundled Asset Save

## Goal
Make web project saving use the only browser-realistic asset behavior: save portable project files with embedded assets, without exposing external reference choices that cannot work reliably on web.

## Approach
- Never show the external-vs-bundled asset storage modal on web.
- Hide `Save Bundled Copy...` on web; keep it on desktop.
- Make web Save/Save As automatically download a bundled `.casc` when assets exist and plain JSON when they do not.
- Show read-only web asset storage status in Project settings instead of the desktop dropdown.
- Preserve a non-transferred copy of uploaded image bytes before sending image data to the worker.
- Use the preserved project asset bytes when saving bundled web projects.
- Prefer freshly exported runtime asset bytes over retained project metadata so regenerated AI outputs replace older saved results.
- Add regression tests for web menu visibility, no-prompt save behavior, Project settings, and non-empty bundled image assets.

## Affected Areas
- `apps/web/src/components/SettingsModal.tsx`
- `apps/web/src/menus/menuDefinition.ts`
- `apps/web/src/store/graphStore/slices/assetsSlice.ts`
- `apps/web/src/store/graphStore/slices/projectSlice.ts`
- `apps/web/src/__tests__/graphStore.test.ts`
- `apps/web/src/menus/__tests__/menuDefinition.test.ts`
- `apps/web/src/components/__tests__/SettingsModal.test.ts`
- `implementation-plans/web-bundled-asset-save.md`

## Checklist
- [x] Preserve uploaded image bytes across worker transfer.
- [x] Keep web asset storage modal unreachable.
- [x] Auto-bundle asset-backed web saves.
- [x] Hide web `Save Bundled Copy...` menu item.
- [x] Make Project settings read-only for web asset storage.
- [x] Prefer latest runtime AI result bytes when saving.
- [x] Add regression coverage for web menu, settings, no-prompt save, and bundled bytes.
- [x] Run focused frontend validation.
