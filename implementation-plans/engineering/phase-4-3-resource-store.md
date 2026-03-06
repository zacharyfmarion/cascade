# Phase 4.3 — Introduce `ResourceStore` (eliminate `as_any_mut()` downcasting)

## 1) Goal and scope
Replace engine-driven mutation of node internals (via `Node::as_any_mut()` downcasting) with an **engine-owned, typed, thread-safe `ResourceStore`** keyed by **`(NodeId, resource_key)`**, accessible to nodes via `EvalContext`.

### In scope
- Add `ResourceStore` (owned by `EvalSession`).
- Add `ctx.resources` to `EvalContext`.
- Remove `as_any()` / `as_any_mut()` from `Node` trait.
- Migrate: LoadImage, AI nodes, GroupNode.

### Non-goals
- Tile-aware storage (Phase 6.2), async render integration (Phase 6.1).

---

## 2) ResourceStore design
- **Key:** `(NodeId, &'static str)`.
- **Value:** typed resource cell stored as `Arc<dyn Any + Send + Sync>` (concrete type typically `RwLock<T>`).
- **API:** `get<T>()`, `get_or_insert_with()`, `set<T>()`, `remove_node()`, `remove()`.
- **Thread safety:** `Send + Sync` by construction; individual resources separately lockable.
- **Lifecycle:** runtime-only, not serialized; engine calls `remove_node(id)` on deletion.

---

## 3) Resource types to migrate
- **LoadImage:** source bytes + decode cache.
- **AI nodes:** cached provider outputs.
- **GroupNode:** internal runtime graph/evaluator state.

---

## 4) Node trait changes
Remove `as_any()` / `as_any_mut()`. Nodes access runtime state only through `EvalContext.resources`.

---

## 5) EvalContext integration
Add `NodeResourceAccessor` providing `get<T>(key)`, `get_or_default<T>(key)`, `get_or_insert_with(key, init)`.

---

## 6) Engine-side resource injection
- `Engine::set_node_resource<T>(node_id, key, value)` — triggers dirty propagation for semantic input changes.
- Bridge calls this instead of downcasting nodes.

---

## 7) Edge cases
- Cleanup on node deletion: `resources.remove_node(node_id)`.
- GroupNode internal graph has own NodeId space; kept inside GroupRuntime resource.
- No cross-node sharing (by design).

---

## Step-by-step implementation checklist
- [ ] Add `ResourceStore` type + `TypedResourceKey<T>` + `ResourceError`.
- [ ] Plumb into `EvalSession` as `Arc<ResourceStore>`.
- [ ] Expose via `EvalContext` as `NodeResourceAccessor`.
- [ ] Add engine APIs: `set_node_resource<T>`, `remove_node_resources(node_id)`.
- [ ] Migrate LoadImage: define keys, update bridge, update evaluation.
- [ ] Migrate AI nodes: move caches into resources.
- [ ] Migrate GroupNode: move runtime state into resource.
- [ ] Remove `as_any()` / `as_any_mut()` from Node trait.
- [ ] Add tests: resource lifecycle, concurrent access, deletion cleanup.

## Risks and mitigations
- **Cache invalidation bugs:** ensure only external injection triggers dirty propagation.
- **Deadlocks:** keep resource locks short; decode outside locks.
- **Key collisions:** require `&'static str` keys as `const`.

**Effort estimate:** Medium (1–2 days)
