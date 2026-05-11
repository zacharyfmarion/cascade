# Viewer-Scoped Media Transport

## Goal

Make viewer slideshow/filmstrip UI depend on the active viewer's upstream media source instead of the global first loaded media iterator.

## Checklist

- [x] Add a pure upstream media iterator resolver that requires exactly one reachable loaded iterator.
- [x] Stop `recomputeMediaIteratorState` from auto-selecting the first iterator.
- [x] Sync the active viewer's transport source from the resolver and clear stale/ambiguous sources.
- [x] Render viewer filmstrip UI only from the resolved upstream iterator.
- [x] Add resolver and viewer regression tests.
- [x] Run targeted validation.
