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
- [ ] Capture after-change empirical lock-wait comparison in desktop dev logs.
