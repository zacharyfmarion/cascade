# Roadmap Reconciliation: Cross-Plan Engineering Compatibility

## Executive Summary

Most plan collisions come from **three cross-cutting axes**: (a) **document/package formats + ID remapping**, (b) **undo/state scoping**, and (c) **async EngineBridge + Worker execution**. Standardizing these foundations once makes the rest of the roadmap additive rather than repeatedly re-solving import/export, sanitization, and state management.

---

## 1. Dependency Graph

### Key Prerequisite "Spines"

```
Spine A: Bridge/Execution
  1.5 EngineBridge async → (2.3 ProjectStorage, 3.1 AI Orchestrator, 1.2/3.2 live preview, 3.3 async AI)

Spine B: Import/Formats
  (1.1, 2.1, 2.2, 2.3) all converge on shared ID remap + sanitization

Spine C: AI Connectivity
  1.3 API Access → (3.1 AI Polish, 3.2 GPU Shader Gen, 3.3 AI Processing)
```

### Plan-by-Plan Dependencies

| Plan | Depends On | Feeds Into |
|------|-----------|------------|
| 1.1 Groups | — | 2.1, 2.2, 2.3 |
| 1.2 AI+GPU Script | 1.1 (GPU in groups), 1.5 (async) | 3.2 |
| 1.3 AI API Access | — | 3.1, 3.2, 3.3 |
| 1.4 I/O Maturity | — | 2.4, 2.1/2.3 (assets) |
| 1.5 Frontend Polish | — | 2.3, 3.1, 1.2/3.2 (live preview) |
| 2.1 Templates | 1.1 (groups), shared import pipeline | 2.2, 2.4 |
| 2.2 Share | shared import pipeline, 1.2/3.2 (safety) | — |
| 2.3 Project Org | 1.5 (async bridge) | 3.1 (persistence) |
| 2.4 Batch/CLI | 1.4 (formats), runtime APIs | optionally 3.3 |
| 3.1 AI Polish | 1.5 (async render), 1.3 (transport) | — |
| 3.2 GPU Shader Gen | 1.2 (DSL/compiler), 1.3 (AI calls) | — |
| 3.3 AI Processing | 1.3 (transport), 1.5 (async) | — |

### What Can Run in Parallel
- **1.4 I/O Maturity** is independent of 1.1/1.5/1.3
- **2.4 CLI** can start once runtime API boundaries are clear
- **2.1 Templates** and **2.2 Share** can parallelize IF they share CompositionDoc + ImportPipeline
- **1.1 Groups** and **1.3 AI API Access** are independent

---

## 2. Shared Infrastructure

### A) Canonical CompositionDoc Format

**Problem:** Four plans define competing graph serialization wrappers: TemplatePackage (2.1), SharePayload (2.2), ProjectDocV2 (2.3), EffectPackage (3.2).

**Solution:** Define ONE canonical `CompositionDoc` (graph DSL + node params + engine version + asset refs + metadata + version) and make everything else a wrapper:

| Format | Relationship to CompositionDoc |
|--------|-------------------------------|
| TemplatePackage (2.1) | `{meta, composition: CompositionDoc, bundled_assets}` |
| SharePayload (2.2) | `{mode, composition: CompositionDoc(sanitized), policy_flags}` |
| ProjectDocV2 (2.3) | `{compositions: [CompositionDoc], workspace_state, history_refs}` |
| EffectPackage (3.2) | `{meta, effect_defs, optional demo: CompositionDoc fragment}` |
| Group Export (1.1) | `CompositionDoc fragment (subset of graph)` |

### B) Unified ImportPipeline (Rust Engine-Side)

**Used by:** Group import/export/duplication (1.1), Templates (2.1), Share remix (2.2), Project load (2.3)

```rust
ImportPipeline::import(
    source: CompositionDoc,
    policy: ImportPolicy,  // safe_mode, allow_gpu_scripts, allow_external_assets, etc.
) -> Result<ImportResult, CascadeError>

struct ImportResult {
    graph: Graph,
    id_map: HashMap<OldId, NewId>,
    warnings: Vec<ImportWarning>,  // missing nodes, version mismatch, etc.
}
```

### C) Shared Sanitization Module

**Used by:** Share export (2.2), Template export (2.1), Project export (2.3), Effect packaging (3.2)

Strips: API keys, absolute file paths, machine-specific state, localStorage references.
Preserves: GLSL code, node params, connections, metadata (per 1.4 policy).

### D) Async Render Request API

**Used by:** Worker rendering (1.5), AI render-and-inspect (3.1), Live preview (1.2/3.2), Batch rendering (2.4)

```typescript
interface RenderRequest {
    requestId: string;
    targetNodeId: string;
    options: RenderOptions;
}

interface RenderResponse {
    requestId: string;
    imageData: ArrayBuffer;  // Transferable
    metadata: RenderMetadata;
    diagnostics: Diagnostic[];
}
```

Must support: cancel, progress events, diagnostic events (shader compile errors).

### E) Error Handling Extensions

**1.4** adds I/O error variants. **1.2/3.2** add shader compile errors. **1.5** adds Worker/async errors. **3.3** adds AI provider errors.

**All should flow through ONE diagnostics pipeline:**
- Rust: `CascadeError` variants → `EngineErrorDto` (WASM bridge) → `EngineError` (frontend)
- UI: per-node error attribution + toast notifications + status bar

---

## 3. Conflicts & Incompatibilities

### ⚠️ CONFLICT A: Undo Stacks — Per-Group (1.1) vs Per-Composition (2.3)

**Problem:** 1.1 proposes per-group undo stacks in kernel.ts. 2.3 proposes per-composition undo stacks. Having both independently will cause state divergence when operations cross scopes (e.g., editing inside group affects outer connections).

**Resolution:** **One UndoManager with scoped transactions:**
- Composition-level is authoritative (2.3)
- Group-level undo becomes a *filtered view* or "local transaction grouping" for UX, not a separate history store
- UndoManager stores transactions tagged with scope `{ compositionId, groupPath? }`
- When inside a group, undo shows only transactions for that scope; global undo shows everything

### ⚠️ CONFLICT B: AI Infrastructure — AiTransport (1.3) vs AiProvider (3.3)

**Problem:** Risk of building two overlapping abstractions for AI calls.

**Resolution:** **Single layered stack:**
```
AiProvider (3.3)     → operation API (bg removal, SR, etc.) + cost + caching
    ↓ uses
AiClient/Transport (1.3)  → request execution (proxy vs direct) + key storage
```
Providers call transport, not vice versa. AiProvider handles "what model/operation", AiTransport handles "how requests travel".

### ⚠️ CONFLICT C: EngineBridge Async (1.5) vs Synchronous Assumptions

**Problem:** 1.5 makes all bridge methods async and moves engine to Worker. Other plans (1.2 hot reload, 3.1 orchestrator, 2.2 embed) may assume synchronous access.

**Resolution:** Make **async the semantic contract everywhere** from day one:
- WASM sync impl just wraps results in `Promise.resolve()` (zero overhead)
- All downstream code already written against async interface
- Worker migration becomes transparent — just swap the bridge implementation

### ⚠️ CONFLICT D: ID Remapping — Three Separate Implementations

**Problem:** 1.1 (group import), 2.1 (template import), 2.2 (share remix) each describe their own ID remapping logic.

**Resolution:** **One ImportPipeline** (see §2B above). All three entrypoints call the same engine API with different `ImportPolicy` flags.

### ✅ COMPATIBLE: Schema Formats

TemplatePackage, SharePayload, ProjectDocV2, EffectPackage — these are compatible as long as they all wrap CompositionDoc. No format conflict if the canonical core is shared.

### ✅ COMPATIBLE: GPU Script Safety (2.2) + Shader Safety Linter (3.2)

2.2 gates untrusted GPU Script execution in safe mode. 3.2 adds a static safety linter. These compose naturally: safe mode can use the linter as its implementation.

---

## 4. Recommended Implementation Order

### Wave 0: Foundations (do first, unblocks everything)
1. **1.5 EngineBridge async contract** — CoreBridge/DesktopBridge + event/cancel/progress skeleton
2. **Define CompositionDoc + versioning + ImportPipeline** — even as a minimal RFC + first implementation
3. **Unified UndoManager** with scope tags — reconcile 1.1 and 2.3 approaches

### Wave 1: Core Stability (parallel track)
4. **1.1 Node Group Stability** — aligned to ImportPipeline semantics
5. **1.3 AI API Access** — transport layer + key management
6. **1.4 I/O Maturity** — independent, can parallel with 1.1/1.3
7. **1.2 AI + GPU Script Integration** — depends on 1.1 (GPU in groups) + 1.5 (async)

### Wave 2: Growth Features (parallel track)
8. **2.3 Project Organization** — built on unified UndoManager + async bridge
9. **2.1 Templates** — wrapper around CompositionDoc + ImportPipeline
10. **2.2 Share as URL** — wrapper around CompositionDoc + sanitization
11. **2.4 Batch/CLI** — uses cascade-runtime public API

### Wave 3: AI Polish (parallel track)
12. **3.1 AI Assistant Polish** — depends on async render/inspect (1.5) + transport (1.3)
13. **3.2 AI GPU Shader Generation** — depends on 1.2 substrate
14. **3.3 AI Processing Nodes** — depends on transport (1.3) + async (1.5)

---

## 5. Architectural Risks

### Risk: Worker Rendering (1.5) vs AI Render-and-Inspect (3.1)

**Issue:** If Worker API is "fire and forget" without cancel/progress + deterministic snapshotting, the AI orchestrator will race stale renders.

**Mitigation:** Design Worker API with explicit `requestId` + cancel + progress events from the start. The render-and-inspect tool (3.1) is just another render request with a thumbnail capture hook.

### Risk: Share Payload (2.2) vs EffectPackages (3.2)

**Issue:** If SharePayload is graph-only and ignores effect definitions/assets, sharing effect-based graphs requires external fetches.

**Mitigation:** SharePayload must support embedded effect definitions (inline EffectPackage or reference to gallery IDs). Decide which approach in the CompositionDoc design.

### Risk: ProjectDocV2 (2.3) vs Templates (2.1) + Shares (2.2)

**Issue:** If ProjectDocV2 invents its own internal graph format, template/share import becomes lossy.

**Mitigation:** ProjectDocV2 compositions are CompositionDoc entries — same format used by templates and shares.

### Risk: CLI (2.4) vs AI Providers (3.3)

**Issue:** If CLI bakes a standalone AI invocation path, you duplicate auth/caching/cost tracking.

**Mitigation:** CLI AI support as optional layer reusing AiProvider trait + AiClient transport. Share the same config (key storage reads from env vars in CLI context).

---

## 6. Consolidation Opportunities

| Opportunity | Plans Affected | Effort Saved |
|---|---|---|
| **Unified ImportPipeline** | 1.1, 2.1, 2.2, 2.3 | ~3-5 days (avoid 4 separate remappers) |
| **Shared sanitization module** | 2.1, 2.2, 2.3, 3.2 | ~1-2 days (one implementation vs four) |
| **Single "Effect" concept** | 1.2, 2.1, 3.2 | ~2-3 days (GpuScript = Effect instance) |
| **One diagnostics pipeline** | 1.2, 1.4, 1.5, 2.4, 3.2 | ~1-2 days (shared error display) |
| **CompositionDoc standard** | 2.1, 2.2, 2.3, 3.2 | ~2-3 days (one format, not four) |
| **Layered AI stack** | 1.3, 3.1, 3.2, 3.3 | ~1-2 days (AiProvider→AiTransport, not two systems) |

**Total estimated savings: ~10-17 days** by building shared infrastructure upfront.

---

## 7. Missing Cross-Cutting Concerns

### Schema Migration & Versioning (CRITICAL — not owned by any plan)

Every serialized format (CompositionDoc, TemplatePackage, SharePayload, ProjectDocV2, EffectPackage) needs:
- `schemaVersion` field
- Forward-compatibility rule: unknown fields ignored
- Backward-compatibility rule: old data auto-migrated on load
- Version-gate rule: reject data from unknown future versions with clear message

**Recommendation:** Define this policy ONCE in a `VERSIONING.md` and enforce it across all formats.

### Security Model for Safe Mode (partially addressed)

2.2 gates GPU scripts in safe mode. But the full "untrusted content" policy should also cover:
- External asset URLs (can they be loaded in safe mode?)
- AI provider calls (should shared graphs trigger API calls?)
- Filesystem paths (never in browser, gated in desktop)

**Recommendation:** Define a `SafetyPolicy` enum used by ImportPipeline, not just share-specific logic.

### Performance Budgets (not addressed)

Combined features will stress:
- Worker message overhead (1.5 + 3.1 render loops)
- Shader compile cache size (1.2 + 3.2 many effects)
- AI queue backpressure (3.1 + 3.3 concurrent requests)
- Share payload size limits (2.2 with embedded effects from 3.2)
- IndexedDB storage across autosave (2.3) + AI cache (3.3) + user templates (2.1)

**Recommendation:** Set explicit budgets per feature and enforce them in code.

---

## Action Items

1. [ ] Define `CompositionDoc` canonical format with versioning policy
2. [ ] Implement `ImportPipeline` in cascade-core (ID remap + sanitization + validation)
3. [ ] Design unified `UndoManager` with scope tags (composition + group)
4. [ ] Make `EngineBridge` async-first with cancel/progress/diagnostics events
5. [ ] Layer AI as `AiProvider` (3.3 operations) → `AiTransport` (1.3 connectivity)
6. [ ] Define `SafetyPolicy` for untrusted content across all import/share paths
7. [ ] Write `VERSIONING.md` with schema migration policy for all formats
