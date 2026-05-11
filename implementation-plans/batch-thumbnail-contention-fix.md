# Batch Thumbnail Contention Fix

## Goal

Make desktop batch source thumbnails stop blocking main viewer renders by moving thumbnail decode/resize/encode work outside the global app/engine lock.

## Checklist

- [x] Add batch source snapshot types and `LoadImageBatch` snapshot API.
- [x] Add runtime bridge method for thumbnail source snapshots.
- [x] Add a Tauri-side thumbnail cache and generate thumbnails outside the app lock.
- [x] Align viewer filmstrip thumbnail max edge/concurrency with node thumbnails.
- [x] Add Rust/frontend tests for snapshot, cache, and filmstrip behavior.
- [x] Run validation commands.
- [x] Capture after-change empirical lock-wait comparison in desktop dev logs.

## Empirical Result

After the change, desktop dev logs show thumbnail and viewer lock contention has been removed:

- `tauri.get_batch_thumbnail lock_wait=0.0ms` while cold thumbnail generation still spends time in `engine`/encode work.
- `tauri.render_viewer lock_wait=0.0ms` for active frame renders.
- Remaining click latency is now active-frame evaluation, e.g. `runtime.render_viewer_result eval=540.2ms` for frame 1.

Follow-up candidates:

- Add in-flight thumbnail dedupe so the node carousel and viewer strip do not cold-encode the same source thumbnail at the same time.
- Profile/optimize `LoadImageBatch -> graph -> Viewer` active-frame evaluation, now that thumbnail contention is out of the way.
