# Batch Performance Pass

## Goal

Make desktop batch loading and browsing responsive by removing eager processed thumbnail rendering, replacing hand-rolled media strip virtualization, and adding lazy native source thumbnails.

## Checklist

- [x] Add TanStack Virtual and shared horizontal media-strip behavior.
- [x] Make viewer filmstrip navigational/current-preview only.
- [x] Make LoadImageBatch node carousel virtualized and thumbnail-backed.
- [x] Add lazy native batch thumbnail bridge and runtime cache.
- [x] Add bulk path-backed batch loading to avoid per-image dirty/cache churn.
- [x] Make LoadImageBatch preview evaluation honor preview scale and use byte-bounded cache.
- [x] Add targeted runtime/frontend tests.
- [x] Run validation and create checkpoint commits without pushing.
