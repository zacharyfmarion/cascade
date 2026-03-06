# Phase 4.1 — Introduce `EvalSession` (cascade-core)

## 1) Goal and scope
Introduce an `EvalSession` that bundles "evaluation environment" dependencies (registry, color management, optional AI provider, project format, auxiliary caches, and future resources) so `Evaluator::evaluate()` no longer grows parameters as features are added.

### Scope
- Add `EvalSession` (cloneable) and simplify evaluator entrypoint to: `evaluate(&mut self, graph, session, viewer_node_id, output_port, frame_time)`.
- Make `EvalContext` extensible via TypeMap pattern so new services don't add fields.
- Keep cascade-core focused on graph/eval mechanics.

### Non-goals
- No async render refactor (Phase 6.1), Value unification (Phase 4.2), or ResourceStore (Phase 4.3).

---

## 2) `EvalSession` design
### What goes in EvalSession (as services)
- `NodeRegistry` access (read-only), Color management (`dyn ColorManagement`), Optional AI provider, `Format` (project format), AI node cache, `preview_scale`.

### What stays as evaluate() params
- `graph: &mut Graph`, `viewer_node_id`, `output_port`, `frame_time` (per-evaluation query).

### Thread-safety
- `Clone + Send + Sync`, internally uses `Arc` for all shared services.

---

## 3) TypeMap ("Services") design
- `Services` stores `Arc<T>` keyed by `TypeId`: `HashMap<TypeId, Arc<dyn Any + Send + Sync>>`.
- API: `get<T>() -> Option<Arc<T>>`, `require<T>() -> Result<Arc<T>, CascadeError>`, `contains<T>()`.
- Trait-object services use wrapper newtypes: `ColorManagementSvc`, `AiProviderSvc`, etc.
- Performance: one HashMap access + downcast per lookup (per-node scale, not per-pixel).

---

## 4) `EvalContext` evolution
Keep focused on per-node data + services handle. Add convenience methods: `ctx.color_management()`, `ctx.ai_provider()`, `ctx.project_format()`, `ctx.preview_scale()`, `ctx.resources()` (reserved for Phase 4.3).

---

## 5) Migration strategy
1. Add new types without changing behavior.
2. Introduce `evaluate_with_session()` keeping old `evaluate()` as wrapper.
3. Update evaluator internals to thread `&session`.
4. Switch `EvalContext` to hold `&Services`.
5. Update external call sites; delete old wrapper.

---

## 6) Edge cases
- Missing required service → structured `CascadeError::MissingService { service, node_id }`.
- Optional services (AI) → missing means None.
- Default values (preview_scale) → safe default 1.0 if missing.

---

## 7) Compatibility with ResourceStore (Phase 4.3)
ResourceStore is another session service: `ResourceStoreSvc(Arc<ResourceStore>)`. Reserve `ctx.resources()` accessor.

---

## Step-by-step implementation checklist
- [ ] Add `services.rs` implementing `Services` + `EvalSessionBuilder`.
- [ ] Add service wrapper newtypes.
- [ ] Add `EvalSession` with builder; ensure `Clone + Send + Sync`.
- [ ] Add `CascadeError::MissingService`.
- [ ] Add `evaluate_with_session()` and re-implement old API as wrapper.
- [ ] Refactor evaluator internals to pass `&session.services()` into `EvalContext`.
- [ ] Update nodes to use `ctx.*()` helpers.
- [ ] Add tests for Services/session + missing service behavior.
- [ ] Migrate external call sites; remove old wrapper.

## Risks and mitigations
- **Compile break:** keep old wrapper temporarily.
- **Service boilerplate:** provide EvalContext convenience accessors.
- **Future async render:** make everything `Arc<... + Send + Sync>` now.

**Effort estimate:** Medium (1–2 days)
