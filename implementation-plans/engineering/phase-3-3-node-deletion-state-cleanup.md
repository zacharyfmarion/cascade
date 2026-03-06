# Phase 3.3 — Clean up state on node deletion

## 1) Goal and scope

### Goal
Prevent unbounded memory growth by ensuring **all per-node derived/cached state** is removed whenever a node is removed from the graph (single delete, multi-delete, undo/redo paths, clear/new project, etc.). Today, `renderResults` (partially) and `kernel.renderGenerations` are cleaned, but **`nodeTimings`, `nodeErrors`, `aiNodeStatuses`, and `aiNodeStale` are not**, causing Maps/Records to grow indefinitely over repeated create/delete cycles.

### In scope (must be cleaned on node removal)
- `renderResults` (already partially cleaned for viewer nodes; ensure correct behavior for all deleted node IDs)
- `nodeTimings: Map<string, number>` (renderSlice)
- `nodeErrors: Map<string, EngineError>` (renderSlice)
- `aiNodeStatuses: Record<string, string>` (aiSlice)
- `aiNodeStale: Record<string, boolean>` (aiSlice)
- `kernel.renderGenerations` (already cleaned; confirm coverage for batch delete and non-viewer deletion if applicable)

### Out of scope (explicitly not part of Phase 3.3)
- Redesigning undo history semantics (full cache snapshot restore) — we'll align cleanup behavior with current "derived state recomputes" model.
- Introducing new state management libraries or persistence layers.

---

## 2) Design decisions

### Primary recommendation: centralize cleanup behind a single helper owned by **graphSlice**
**Decision:** Implement a centralized `cleanupDeletedNodesState(nodeIds: string[])` helper and call it from every graph-level removal path (`removeNode`, `removeNodes`, `clearGraph`, and any "replace graph" operations).

**Why graphSlice owns it**
- Node lifecycle (create/delete) is already coordinated in `graphSlice.ts` (e.g., calling `engine.removeNode`, removing from `nodes`, filtering connections, cleaning viewer `renderResults`, cleaning `kernel.renderGenerations`, etc.).
- The state to clean spans slices, but **the event that triggers cleanup is "node removed from graph"**, which is graphSlice responsibility.
- Avoids "each slice must remember to subscribe to deletions" complexity.

### Where the helper should live
- **Preferred:** `apps/web/src/store/graphStore/slices/graphSlice.ts` as a private helper (or exported only for tests).
- If the file becomes too large, extract to a small internal module:
  - `apps/web/src/store/graphStore/nodeLifecycle.ts` (no new deps), imported by `graphSlice.ts`.

### Shape of the helper
- Accept **an array of node IDs** (even for single delete) so multi-delete is efficient and consistent.
- Perform a **single Zustand `set()`** that:
  - Deletes keys from Maps/Records
  - Deletes `kernel.renderGenerations` entries
  - Cleans `renderResults` entries for those IDs (viewer-only or all; see below)
- Follow existing store update conventions.

### Cleanup policy for `renderResults`
- **Pragmatic default:** delete `renderResults` for *any* deleted node ID (even if only viewer nodes currently write results). It's safe and prevents future regressions if other node types start writing results.

---

## 3) All deletion paths (enumerate + coverage plan)

### Known deletion/removal entry points
1. **Single delete** — `graphSlice.ts` — `removeNode` (approx lines 129–183)
2. **Multi-delete / batch delete** — `graphSlice.ts` — `removeNodes`
3. **Clear graph / new project** — `graphSlice.ts` — `clearGraph`
4. **Undo/redo that deletes nodes** — If undo stack calls `removeNode(s)` internally: covered automatically. If undo/redo restores graph snapshots by directly overwriting `nodes`/`connections`: must add a "diff cleanup" step.
5. **Import/load project** — Typically "clear + add nodes"; ensure it calls `clearGraph` or cleanup for removed IDs.
6. **Group operations** — Deleting a group or ungrouping should funnel into `removeNodes`/`removeNode`.

### Coverage strategy
- **Make `removeNode` call `removeNodes([id])`** so there is only one "real" removal implementation.
- Ensure `clearGraph` uses the same helper by passing `Array.from(state.nodes.keys())`.
- If there exists a "replace graph" function, implement `cleanupForRemovedNodeDiff(prevNodes, nextNodes)`.

---

## 4) UX considerations

### Error badges and timings when deleting then undo'ing
**Recommendation:** Treat render/AI/error state as **derived and ephemeral**:
- On delete: remove error badges/timings/AI statuses immediately.
- On undo (node restored): do **not** restore old error badge/timing/status; the node should re-evaluate and re-populate if still relevant.

### Preserve `aiNodeStatuses` across undo?
**Recommendation:** No — clear them on deletion. On undo, initialize as "unknown"/absent and mark `aiNodeStale[nodeId]=true`.

---

## 5) Edge cases

### Batch deletion
- Ensure the helper accepts a list and deletes keys in a tight loop.
- Avoid N `set()` calls; do 1 `set()` for the entire batch.

### Undo/redo
- If undo/redo uses the same `removeNodes` action: already covered.
- If undo/redo swaps whole graph state: must diff removed IDs and cleanup.

### Race conditions with in-flight renders / async AI updates
**Key risk:** A render (or AI request) finishes after a node is deleted and writes back into `nodeErrors/nodeTimings/renderResults/aiNodeStatuses`, reintroducing "zombie" entries.

**Mitigation (required): add "node still exists" guards on write paths**
- In render completion code: Before writing per-node entries, check `get().nodes.has(nodeId)`.
- In AI status update actions: Same guard.

### Render completes for a node that was just deleted
- With guards, the result is ignored.

---

## 6) Error handling

### What can go wrong
- `engine.removeNode(nodeId)` fails: Do **not** remove local node state; do **not** cleanup caches; surface error to UI as today.
- Partial failure in batch delete: Cleanup only the successfully removed IDs; report the failures.
- Cleanup operations themselves: Should be **best-effort and non-throwing**.

---

## 7) Testing strategy

### Test cases to add
1. **Single node deletion cleans all caches** — Create node, seed caches, delete, assert all entries removed.
2. **Batch deletion cleans all caches for all IDs** — Create A,B,C, seed caches, delete A,B, assert A,B cleaned, C retained.
3. **clearGraph clears per-node caches** — Create nodes, seed caches, clearGraph, assert caches empty.
4. **Zombie render completion is ignored** — Create node, delete, simulate "render finished", assert state remains clean.
5. **Zombie AI status update is ignored** — Same pattern for AI slice.

---

## 8) Step-by-step implementation checklist

### A. Centralize cleanup in graphSlice
- [ ] Create helper `cleanupDeletedNodesState(nodeIds: string[])` in `graphSlice.ts`
- [ ] Ensure it deletes entries from: renderResults, nodeTimings, nodeErrors, aiNodeStatuses, aiNodeStale, kernel.renderGenerations
- [ ] Refactor `removeNode(nodeId)` to delegate to `removeNodes([nodeId])`
- [ ] Update `removeNodes(nodeIds)` to call `cleanupDeletedNodesState(nodeIdsSucceeded)`
- [ ] Update `clearGraph` to compute removedIds and call cleanup

### B. Add "node exists" guards on async write paths
- [ ] In `renderSlice.ts`: guard nodeTimings/nodeErrors/renderResults writes
- [ ] In `aiSlice.ts`: guard aiNodeStatuses/aiNodeStale writes

### C. Kernel cleanup consistency
- [ ] Ensure kernel `renderGenerations` deletion is batch-safe

### D. Tests
- [ ] Add the 5 tests listed in section 7

---

## 9) Risks and mitigations

### Risk: missing a deletion path (state still leaks)
**Mitigation:** Funnel all removal paths through one cleanup helper; add diff-based cleanup for graph overwrites.

### Risk: zombie async updates reintroduce keys after cleanup
**Mitigation:** Add "node exists" guards on all write actions for per-node state.

### Risk: undo UX expectation mismatch
**Mitigation:** Document: "Derived state is recomputed after undo; prior errors/timings/AI status are not restored."

---

## Optional future considerations
- Dev-only assertion to detect "orphan keys" after operations.
- Single `nodeDerivedState` sub-object keyed by nodeId for structurally unavoidable lifecycle cleanup.
