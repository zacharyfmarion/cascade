# Web Bundled Asset Save

## Goal
Make web project saving match the desktop bundled asset behavior: first save should prompt for asset storage, and saved web projects should reopen with real image bytes instead of broken zero-byte assets.

## Approach
- Keep file-loaded web projects in the unset asset-storage state until first save so the asset storage modal can appear.
- Preserve a non-transferred copy of uploaded image bytes before sending image data to the worker.
- Use the preserved project asset bytes when saving bundled or plain JSON web projects.
- Add regression tests for web first-save prompting and non-empty bundled image assets.

## Affected Areas
- `apps/web/src/store/graphStore/slices/assetsSlice.ts`
- `apps/web/src/__tests__/graphStore.test.ts`
- `implementation-plans/web-bundled-asset-save.md`

## Checklist
- [x] Preserve uploaded image bytes across worker transfer.
- [x] Keep web asset storage unset before first save.
- [x] Add regression coverage for web prompt and bundled bytes.
- [x] Run focused frontend validation.
