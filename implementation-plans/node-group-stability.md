# Node Group Stability, Rename & Share/Import

**Source:** Phase 1.1 roadmap (`implementation-plans/roadmap/1.1-node-group-stability.md`)
**Scope:** Fix known group bugs, add rename UX, build proper share/import flow.
**Effort:** Large (1–2 weeks)

---

## Known Bugs (from user testing)

Four concrete issues identified from hands-on testing with a color-replacement group node:

| # | Issue | Root Cause | Severity |
|---|---|---|---|
| 1 | No obvious UI to rename a group | `GroupNameEditor` exists in Inspector panel only — not discoverable | UX gap |
| 2 | No color picker (or other default controls) on unconnected group inputs | `derive_input_port()` uses `..Default::default()` — drops `default`, `ui_hint`, `min`, `max`, `step` | Bug (all types) |
| 3 | Changing slider values on group node doesn't propagate to internal nodes | Internal evaluator caches GroupInputNode output; cache key never changes because injected values bypass `param_revision` | Bug (critical) |
| 4 | Dragging .cnode onto canvas appears to do nothing | Import likely works but has zero user feedback; no toast, no dialog, no visual indication | UX gap |

---

## Bug 1: GroupInputNode Caching — Values Don't Propagate ✅ FIXED

**This is the most critical bug. Sliders, color pickers, and all input defaults on group nodes are broken.**

### Root Cause (traced through full code path)

When a GroupNode evaluates, it injects outer input values into `GroupInputNode` via `inject_inputs()`, then runs the internal evaluator. The internal evaluator has a persistent cache with keys computed from `(frame_time, param_revision, upstream_hash, ...)`.

**GroupInputNode's cache key never changes** because:
1. It has zero upstream connections → `upstream_hash` = 0 always
2. `inject_inputs()` writes to a `RwLock<HashMap>`, bypassing `graph.set_param()` → `param_revision` = 0 always
3. The internal evaluator computes the same cache key every time → always a cache hit → returns stale output

**Code path:**
```
Frontend: setInputDefault(groupNodeId, "key_tolerance", Float(0.5))
    → graph.set_param stores on outer node → outer node marked dirty
    → Outer evaluator re-evaluates GroupNode
        → GroupNode::evaluate() calls group_input.inject_inputs(ctx.inputs)
        → Internal evaluator checks GroupInputNode cache key → CACHE HIT (stale!)
        → Returns old value, never re-executes GroupInputNode
```

**Affected files:**
- `crates/cascade-nodes-std/src/group.rs` — `GroupNode::evaluate()` (line 518)
- `crates/cascade-core/src/eval.rs` — `compute_node_cache_key()` (line ~770)

### Fix

Mark GroupInputNode dirty in the internal graph before each evaluation. This forces the internal evaluator to re-execute GroupInputNode and propagate the new values downstream.

```rust
// In GroupNode::evaluate(), after inject_inputs:
group_input.inject_inputs(ctx.inputs.clone())?;
state.internal_graph.mark_dirty(self.group_input_id);  // ← ADD THIS
```

**Tradeoff**: This eliminates internal caching for GroupInputNode's subtree. Acceptable because:
- The outer evaluator already caches GroupNode's final output — redundant internal caching adds no value when inputs change
- When outer inputs DON'T change, the outer evaluator returns the cached GroupNode output without entering `evaluate()` at all
- For nested groups, each level has its own outer cache, so the same logic applies recursively

**Verification**: After fixing, the promoted params path (`self.definition.promotions` loop) already calls `state.internal_graph.set_param()` which marks dirty correctly. Only the injected inputs path was broken.

---

## Bug 2: Group Input Ports Missing Metadata (No Color Picker, No Defaults) ✅ FIXED

**Affects ALL types, not just Color. Any group input derived from a connectable param loses its default value, UI hint, min/max/step.**

### Root Cause

`GroupNode::derive_input_port()` in `cascade-nodes-std/src/group.rs` (line 392-412) creates a `PortSpec` but discards all metadata:

```rust
// CURRENT (broken):
Ok(PortSpec {
    name: conn.from_port.clone(),
    label: conn.from_port.clone(),
    ty: input_port.ty.clone(),
    ..Default::default()  // ← DROPS default, min, max, step, ui_hint!
})
```

The target node's input spec (found via `to_spec.all_inputs()`) DOES contain the metadata — `all_inputs()` converts promotable params to `PortSpec` with `default`, `ui_hint`, etc. But `derive_input_port()` only copies `ty`.

**Impact chain:**
1. Group input PortSpec has `ui_hint: None`, `default: None`
2. Frontend's BaseNode checks `input.default != null` and `input.ui_hint` to decide whether to render inline controls
3. No metadata → no inline control → no color picker, no slider, no checkbox

### Fix

Copy the metadata from the source input port in both `derive_input_port()` AND `derive_output_port()`:

```rust
// FIXED:
Ok(PortSpec {
    name: conn.from_port.clone(),
    label: conn.from_port.clone(),
    ty: input_port.ty.clone(),
    default: input_port.default.clone(),    // ← ADD
    min: input_port.min,                     // ← ADD
    max: input_port.max,                     // ← ADD
    step: input_port.step,                   // ← ADD
    ui_hint: input_port.ui_hint.clone(),     // ← ADD
})
```

**Affected files:**
- `crates/cascade-nodes-std/src/group.rs` — `derive_input_port()` (line ~406), `derive_output_port()` (line ~428)

**Note:** This fix works for the `derive_interface()` path (connection-derived ports). For `explicit_inputs`/`explicit_outputs` (user-edited via `updateGroupInterface`), metadata must also be preserved — verify this path separately.

---

## Bug 3: Rename UI Not Discoverable ✅ FIXED

### Current State

The rename functionality is fully implemented:
- **Backend**: `rename_group_internal()` in `cascade-wasm/src/lib.rs` (line 2086) — updates GroupDefinition name, rebuilds all instances
- **Frontend**: `GroupNameEditor` in `Inspector.tsx` (line 192) — text input with debounced commit, calls `graphSlice.renameGroup()`

But `GroupNameEditor` only appears in the **Inspector panel** when a group node is selected. If the user doesn't have the Inspector open (or doesn't click the group node), they'll never find it.

### Proposed UX (two complementary entry points)

**A. Inline rename on the node (like Blender)**
- Double-click the group node's title text → in-place text input
- Enter or click-away to confirm, Escape to cancel
- This is the fastest path for renaming while working on the canvas
- Implementation: Modify `GroupNodeComponent.tsx` (or `BaseNode.tsx` header) to support an editable title state

**B. Pencil icon in the breadcrumb when inside the group**
- When viewing a group's internals, the breadcrumb shows `Root > Node Group`
- Add a small pencil/edit icon next to the group name in the breadcrumb
- Clicking it opens an inline edit field in the breadcrumb
- Implementation: Modify the breadcrumb component to accept an `onRename` callback for group-level entries

**C. Polish the existing Inspector rename**
- After rename, update the breadcrumb label for the active editing context (currently stale until re-enter)
- Validate: disallow empty string, trim whitespace
- Verify re-render flow: `renameGroup()` → `listNodeTypes()` → `nodeSpecs` update → GroupNodeComponent re-renders with new title

**Affected files:**
- `apps/web/src/components/nodes/GroupNodeComponent.tsx` — inline title editing
- `apps/web/src/components/NodeCanvas.tsx` — breadcrumb rendering (or wherever breadcrumbs are rendered)
- `apps/web/src/components/Inspector.tsx` — polish existing `GroupNameEditor`
- `apps/web/src/store/graphStore/slices/graphSlice.ts` — `renameGroup()` should update `editingStack[].label`

---

## Bug 4: Import UX — Silent Success/Failure ✅ FIXED

### Current State

The import code IS wired up and should work technically:
1. **Drag-and-drop**: `NodeCanvas.tsx` `onDrop` handler (line 762) filters `.cnode` files, reads text, calls `importCustomNodes(text)`
2. **Engine**: `engineWorker.ts` (line 893) does `JSON.parse(json)` then calls `eng.import_custom_nodes(pkg)`
3. **Store action**: `graphSlice.importCustomNodes()` calls engine, refreshes `nodeSpecs`, logs to console

**Problems:**
- Zero visual feedback — no toast on success, no error indicator on failure
- User expects the node to appear ON THE CANVAS where they dropped it, or at least a clear confirmation
- Console.log is the only indication (`[CustomNodes] Imported N custom node(s)`)
- The imported node type silently registers in the library under its original category — user has to discover it
- No way to manage imported custom nodes after the fact (list, remove, re-import)

### Proposed UX

**A. Immediate feedback on drag-and-drop import (Web)**
- Show a visual drop zone indicator when dragging a `.cnode` file over the canvas (CSS overlay like "Drop to import custom node")
- On successful import:
  - Toast: "Imported 'Node Name' — added to Custom Nodes category"
  - Auto-place an instance of the imported node at the drop position (not just register it — actually add it to the canvas)
- On failure:
  - Toast with structured error: "Import failed: Unknown node type 'blur_special' inside package"

**B. Import button in the node library**
- Add an "Import .cnode" button at the top or bottom of the node library/add-node panel
- Opens native file picker for `.cnode` files
- Shows confirmation dialog before importing:
  - Node name(s), category, description
  - Warnings for any missing internal node types
  - "Import" / "Cancel"

**C. Custom Nodes category**
- All user-imported nodes should appear under a dedicated **"Custom Nodes"** category (or keep the category from the package but add a "Custom" badge)
- This makes them easy to find after import

**D. Desktop: Library folder with auto-loading**
- On desktop (Tauri), define a custom nodes directory: `~/.config/cascade/custom-nodes/` (or configurable in Settings)
- On app startup, scan this directory and auto-import all `.cnode` files
- Settings panel: "Custom Node Libraries" section showing:
  - List of installed custom nodes (name, category, source file)
  - "Add folder" to watch additional directories
  - "Remove" to uninstall a custom node
  - "Reveal in Finder/Explorer" for the source file
- When a `.cnode` file is imported via drag-and-drop or file picker, copy it to the custom nodes directory for persistence

**E. Backend validation during import**
- Schema version check: reject if `NodePackage.version` > supported
- Node type registry check: verify all internal `type_id` references resolve
- Cycle detection on internal graphs
- Return structured errors for each failure mode

**Affected files:**
- `apps/web/src/components/NodeCanvas.tsx` — drop handler feedback, auto-place instance
- `apps/web/src/store/graphStore/slices/graphSlice.ts` — `importCustomNodes()` toast, node placement
- `apps/web/src/components/` — node library import button, drop zone overlay
- `crates/cascade-wasm/src/lib.rs` — `import_custom_nodes()` validation
- `apps/tauri/` — custom node directory scanning, Settings panel

---

## Additional Work Items (from roadmap)

### 5. Connection Handling Fixes
**Priority:** High | **Effort:** Medium

**5a. Type validation across group boundaries**
- [ ] Add `validateGroupConnections(groupDefId)` in `cascade-wasm` — verify outer connection types match inner port types
- [ ] Surface mismatches as `EngineError` to frontend

**5b. Dynamic port changes with existing connections**
- [ ] In `update_interface_internal()`, call `prune_connections_for_node()` on all graph nodes of this group type
- [ ] Return pruned connections so frontend can update state and show toasts

### 6. Undo/Redo Within Groups
**Priority:** High | **Effort:** Large

- [ ] **Undo past group entry**: When snapshot's `editingStack` differs from current, auto-navigate to correct level
- [ ] **Undo of group creation**: Verify full restore (nodes, connections, definition cleanup)
- [ ] **Undo of port operations**: Verify connections broken by port removal are restored

### 7. Nested Group Edge Cases
**Priority:** Medium | **Effort:** Medium

- [ ] **Error propagation**: Wrap internal evaluator errors with full path (`GroupA > GroupB > NodeN: error`)
- [ ] **Breadcrumb viewport**: Save/restore zoom/pan per nesting level (not just fitView)

### 8. GPU Script Compatibility
**Priority:** Medium | **Effort:** Small

- [ ] Test: GPU Script inside group → compile GLSL → verify works
- [ ] Test: GPU Script params through group I/O → verify propagation
- [ ] Test: Hot-reload GLSL inside group → verify outer graph re-evaluates

### 9. Group Duplication
**Priority:** Low | **Effort:** Small

- [ ] `duplicateGroup(groupNodeId)` — deep clone with fresh IDs, register as independent definition
- [ ] Add "Duplicate Group" to context menu

### 10. Testing Strategy
**Priority:** High | **Effort:** Medium

**Rust unit tests:**
- [ ] Group creation/deletion round-trips
- [ ] GroupInputNode value propagation (the caching bug!)
- [ ] `derive_input_port()` metadata preservation
- [ ] ID remapping correctness (import with nested groups)
- [ ] `NodePackage` serialization/deserialization round-trip
- [ ] `rename_group_internal` updates definition and rebuilds all instances

**Integration tests:**
- [ ] Full pipeline: create group → set input defaults → evaluate → verify output
- [ ] Import/export round-trip: export → import → verify identical graph structure (modulo IDs)

**E2E tests (Playwright):**
- [ ] Create group → verify input controls render (color picker, sliders)
- [ ] Change group input default → verify internal nodes receive new value
- [ ] Import .cnode → verify toast + node appears in library
- [ ] Rename group → verify title updates in canvas + breadcrumb

---

## Execution Order

| Phase | Items | Rationale |
|---|---|---|
| **A — Critical Bugs** | Bug 1 (caching), Bug 2 (port metadata) | These are broken fundamentals — groups are unusable without them |
| **B — Rename UX** | Bug 3 (rename) | Small scope, high user value |
| **C — Import UX** | Bug 4 (import flow) | Largest chunk but high impact for sharing |
| **D — Stability** | Items 5-6 (connections, undo) | Fix remaining edge cases |
| **E — Polish** | Items 7-9 (GPU, nesting, duplication) | Lower priority refinements |
| **F — Testing** | Item 10 | Ongoing alongside each phase |

**Phase A is a ~1 day fix.** Two targeted changes (mark dirty + copy metadata) that unblock the entire group feature.

---

## Out of Scope

- **Shared group definitions** (edit one, update all instances) — deferred to future "component" system
- **ResourceStore refactor** — separate engineering initiative; work within current `as_any()` architecture
- **Group version control** — tracking changes to group definitions over time
- **Nested group promotion** — promoting params from deeply nested internal nodes
