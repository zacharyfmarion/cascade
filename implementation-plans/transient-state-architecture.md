# Transient State Architecture — Per-Node Draft Stores

## Problem

High-frequency UI interactions (slider drags, color pickers, curve editing) trigger full React re-render storms across the entire node graph.

**Root cause**: `setParamLive()` calls `set({ nodes: newNodes })` on every slider tick, which:
1. Clones the entire `nodes` Map
2. Triggers Zustand subscriptions for ALL components reading from `nodes`
3. `ProcessingNode` selects `s.nodes.get(id)?.params ?? {}` — creates a new object ref every time ANY node's params change
4. `BaseNode` subscribes to `s.connections` — the entire connections array

**Impact**: 50 nodes on canvas = 50+ component re-renders per slider tick (~54ms per pointermove). The viewer never updates because the main thread is saturated with React work.

**Affected interactions**: slider drags, color picker drags, curve point manipulation, ramp stop dragging, inline input port controls, and any future high-frequency parameter editing.

## Architecture

### Core Principle

Split state into **durable** (saved, undo'd, low-frequency) and **transient** (ephemeral, high-frequency, scoped). High-frequency edits update only a per-node transient store + the Worker engine. The durable Zustand store updates only on commit boundaries (pointerup).

### Three Layers

#### Layer 1 — Durable Graph Store (existing Zustand store)

The `nodes` Map changes only on:
- Structural edits (add/delete/connect nodes)
- Param commits (pointerup after drag, Enter key, etc.)
- Undo/redo

`setParamLive()` no longer calls `set({ nodes: ... })`. The durable store is untouched during drags.

#### Layer 2 — Per-Node Draft Stores (new)

Each node gets its own tiny Zustand vanilla store. Module-level registry, NOT inside the main store.

```ts
// store/graphStore/nodeDraftStore.ts

type NodeDraftState = {
  committed: Record<string, ParamValue>;
  draft: Record<string, ParamValue>;
  interactingKeys: Set<string>;
};

// Module-level registry
const stores = new Map<string, StoreApi<NodeDraftState>>();

function getOrCreate(nodeId: string, committed: Record<string, ParamValue>): StoreApi<NodeDraftState>;
function remove(nodeId: string): void;

// Hook: components subscribe to ONE node's draft state
function useNodeParam(nodeId: string, key: string): ParamValue;
function useNodeParams(nodeId: string): Record<string, ParamValue>;
```

**Key property**: updating node X's draft store notifies ONLY node X's subscribers. Other nodes don't even run a selector.

#### Layer 3 — ParamController (coordination API)

Thin coordination layer that orchestrates durable store, draft stores, and Worker engine:

```ts
// store/graphStore/paramController.ts

beginParamEdit(nodeId: string, key: string): void
  → Capture undo snapshot (if first key for this node)
  → Mark key as interacting in draft store

setParamLive(nodeId: string, key: string, value: ParamValue): void
  → Update draft store (only this node re-renders)
  → Send to Worker engine via RAF-coalesced setAndRender
  → Do NOT touch durable nodes Map

commitParamEdit(nodeId: string): void
  → Flush all draft values → durable nodes Map (single set() call)
  → Push undo snapshot
  → Clear draft + interactingKeys
  → Final full-res render

cancelParamEdit(nodeId: string): void
  → Revert draft to committed
  → Re-send committed values to engine
  → Clear interactingKeys
```

### Bonus: connectionsByNodeId

Replace `BaseNode` subscribing to `s.connections` (all connections) with a precomputed adjacency map:

```ts
// In graph store state
connectionsByNodeId: Map<string, Connection[]>
```

Updated whenever connections change. `BaseNode` subscribes to `s.connectionsByNodeId.get(id)` — only re-renders when its own connections change.

## File Changes

### New Files

1. **`apps/web/src/store/graphStore/nodeDraftStore.ts`**
   - `NodeDraftState` type
   - `nodeDraftRegistry` — Map of per-node stores
   - `getOrCreateDraftStore()`, `removeDraftStore()`, `syncCommitted()`
   - `useNodeParam()`, `useNodeParams()` hooks
   - `getEffectiveParam()` — draft[key] ?? committed[key]

2. **`apps/web/src/store/graphStore/paramController.ts`**
   - `beginParamEdit()`, `setParamLive()`, `commitParamEdit()`, `cancelParamEdit()`
   - RAF coalescing for engine updates (reuses existing pattern from liveParamsSlice)
   - Undo snapshot management

### Modified Files

3. **`apps/web/src/store/graphStore/slices/liveParamsSlice.ts`**
   - `setParamLive()`: Remove `set({ nodes: newNodes })`. Delegate to ParamController.
   - `setParamCommit()`: Delegate commit to ParamController.
   - `setInputDefaultLive/Commit`: Same pattern for input defaults.
   - Keep RAF coalescing + preview scale logic.

4. **`apps/web/src/components/nodes/ProcessingNode.tsx`**
   - Replace `useGraphStore(s => s.nodes.get(id)?.params ?? {})` with `useNodeParams(id)`
   - Reads effective params (draft during drag, committed otherwise)

5. **`apps/web/src/components/nodes/BaseNode.tsx`**
   - Replace `useGraphStore(s => s.connections)` with `useGraphStore(s => s.connectionsByNodeId?.get(id) ?? [])`
   - Add stable reference via `useShallow` or custom equality

6. **`apps/web/src/store/graphStore/slices/graphSlice.ts`**
   - Maintain `connectionsByNodeId` map on connection add/remove/clear
   - Sync committed params to draft stores on node add/import/undo

7. **`apps/web/src/store/graphStore/store.ts`**
   - Add `connectionsByNodeId` to GraphState interface

## Implementation Order

### Phase A1: Core Infrastructure
- Create `nodeDraftStore.ts` with registry, hooks
- Create `paramController.ts` with edit lifecycle

### Phase A2: Wire Sliders (ProcessingNode)
- ProcessingNode uses `useNodeParams()` instead of reading from `nodes` Map
- Slider onChange calls `paramController.setParamLive()`
- Slider onChangeCommit calls `paramController.commitParamEdit()`

### Phase A3: Wire Inline Input Controls (BaseNode)
- InlineInputControl uses `useNodeParam()` for its value
- Same ParamController API

### Phase A4: connectionsByNodeId
- Add derived adjacency map to graph store
- Update on addConnection/removeConnection/clearConnections
- BaseNode subscribes per-node

### Phase A5: Verification
- TypeScript typecheck passes
- ESLint passes
- Manual test: drag slider on HSV node → viewer updates smoothly, no re-render storm

## Edge Cases

- **Undo during active drag**: Cancel the drag (clear draft, revert to committed). The undo system snapshots before the drag started, so undo is clean.
- **Node deletion while interacting**: `removeDraftStore(nodeId)` in node removal path. ParamController silently no-ops for missing nodes.
- **Engine/UI divergence on cancel**: `cancelParamEdit` re-sends committed values to the Worker engine.
- **Store hydration on import/undo**: `syncCommitted()` updates all draft stores' committed values from the durable `nodes` Map.
- **Multiple simultaneous drags**: Each key tracks independently in `interactingKeys`. Commit flushes all dirty keys.

## Success Criteria

- Dragging a slider on one node causes ZERO re-renders on other nodes
- Viewer updates at ~30fps during slider drags
- Undo/redo is unaffected — only committed values enter the undo stack
- No regressions in param editing, node creation, or document save/load
