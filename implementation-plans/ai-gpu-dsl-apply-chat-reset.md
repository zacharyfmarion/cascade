# AI GPU DSL Apply And Chat Reset Plan

## Goal

Fix AI-authored GPU DSL so it uses the same production apply path as the visible DSL editor, rejects custom definition names that collide with built-ins, and resets chat state when a new/opened project starts.

## Checklist

- [x] Route AI `write_graph` / `edit_graph` through `applyDsl()`.
- [x] Preserve DSL shadow metadata after successful AI applies.
- [x] Reject custom GPU/group definition names that collide with built-in node names.
- [x] Reset AI chat on project lifecycle changes, not ordinary graph edits.
- [x] Add regression tests for AI GPU writes, name collisions, and chat reset.
- [x] Run frontend tests, lint, and typecheck.
