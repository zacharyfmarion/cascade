# Phase 3.4 — Improve EngineBridge abstraction

## Bottom line
Replace the monolithic `EngineBridge` (union return types + optional methods) with an **async-only** `CoreBridge` plus a **desktop-only** `DesktopBridge extends CoreBridge`, and introduce a single **capabilities source of truth** so callers stop probing for method existence. Do this incrementally via a legacy-compatible adapter layer so the current store/components keep compiling while we migrate slice-by-slice.

---

## 1) Goal and scope

### Goals
- **Split the abstraction**:
  - `CoreBridge`: required, always present in **web (WASM/Worker)** and **desktop (Tauri)**.
  - `DesktopBridge extends CoreBridge`: desktop-only features (filesystem + long-running render jobs).
- **Async-only API**: remove `Promise<T> | T` signatures in the *new* bridge; all bridge methods return `Promise<T>`.
- **Centralize feature gating**: remove scattered `if (eng.someMethod)` checks; replace with `engine.capabilities` + `requireX(...)` helpers and/or compile-time narrowing (`DesktopBridge`).
- **Support Phase 2.4 (batch/headless)**: a clean bridge boundary makes it realistic to add "headless runtime" later without dragging UI-only behaviors into core.

### Non-goals (explicitly out of Phase 3.4)
- Adding new rendering features, new nodes, or a full headless CLI renderer.
- Redesigning Zustand slice structure beyond what's needed to adopt the new bridge.
- Overhauling Tauri Rust command surface beyond what's required for parity.

### Current pain points (grounded in repo)
- `apps/web/src/engine/bridge.ts` defines **~64 methods**, with **many `?` optional** and many returning **`Promise<T> | T`**.
- Store slices + controllers contain multiple checks like:
  - `if (eng.setAndRender) ...`
  - `if (eng.loadSequenceFrameData) ...`
  - `if (eng.setSequenceDirectory) ...`
  - and multiple `Promise.resolve(...)` normalizations (e.g. `renderSlice`, `paramController`, `assetsSlice`, `projectSlice`).

---

## 2) Interface taxonomy (every current method categorized)

> Source: `apps/web/src/engine/bridge.ts` (current `EngineBridge`)

### Core (always available in *new* CoreBridge)
Graph editing + minimal engine lifecycle.
- `listNodeTypes`
- `addNode`
- `removeNode`
- `connect`
- `disconnect`
- `setParam`
- `setInputDefault`
- `setPosition`
- `setMuted`
- `exportGraph`
- `importGraph`
- `getNodeSpec`
- `whenIdle`

### Render (render pipeline + per-node IO)
- `renderViewer`
- `exportImage`
- `getImageData`
- `loadImageData`
- `getLastRenderTimings`
- `setAndRender`
- `getAffectedViewers`
- `evaluateBytesOutput`
- `loadPaletteData`
- Color mgmt (currently optional + partially implemented):
  - `getColorManagementInfo`
  - `getViewsForDisplay`
  - `setDisplayView`
  - `setProjectFormat`

### GPU (GPU-specific / scripting)
- `registerGpuKernel`
- `compileScriptNode`
- `setDslHandle`

### AI
- `setAiApiKey`
- `isAiConfigured`
- `runAiNode`
- `getNodeExecutionState`

### Groups (group authoring + internal graph edits)
- `createGroupFromNodes`
- `ungroupNode`
- `getGroupInternalGraph`
- `updateGroupInterface`
- `addInternalConnection`
- `removeInternalConnection`
- `renameGroup`

### Sequence/Video (data ingest + metadata)
- `setSequenceInfo`
- `loadSequenceFrameData`
- `setSequenceDirectory`
- `getSequenceInfo`
- `loadVideoFile`

### Project (document/format IO)
- `exportDocument`
- `importDocument`
- `needsMigration`
- `migrateDocument`

### Batch (batch node data + long-running renders)
- `batchClear`
- `batchAddImage`
- `getBatchInfo`
- `renderSequence`
- `renderVideo`
- `cancelJob`
- `getJobProgress`

### Desktop (Tauri-only filesystem/project + job control)
> These will live on `DesktopBridge` in the new design (compile-time gated).
- `saveProject`
- `loadProject`
- (also *effectively desktop-only today*, even if callable elsewhere and rejects):
  - `renderSequence`, `renderVideo`, `cancelJob`, `getJobProgress`
  - `setSequenceDirectory`, `getSequenceInfo`, `loadVideoFile`
  - `listCustomNodes`, `removeCustomNode`

### Custom nodes / packaging (cross-cutting; kept as "Groups/Packages" feature area)
- `exportGroupAsPackage`
- `importCustomNodes`
- `listCustomNodes`
- `removeCustomNode`
- (Note: `listCustomNodes/removeCustomNode` are desktop-only in practice today; see above.)

### Validation / type system helpers (candidate for extraction)
- `validateEdits`
- `typesCompatible`

---

## 3) Design decisions

### Options considered
1. **Single interface + capability flags only**
   - Pros: one type everywhere.
   - Cons: desktop-only methods still callable unless every call is runtime-gated; TS can't help.
2. **Multiple sub-interfaces (Core + feature interfaces + Desktop)**
   - Pros: TS enforces correct usage; clearer ownership.
   - Cons: more types, but complexity is mostly one-time and reduces ongoing cognitive load.
3. **Mixin pattern / partial composition**
   - Pros: flexible.
   - Cons: hard to reason about and makes migration noisier.

### Chosen approach (primary recommendation)
**CoreBridge + DesktopBridge + explicit capabilities + small `requireX` helpers**.

- `CoreBridge` contains only "should exist everywhere" operations.
- `DesktopBridge extends CoreBridge` adds filesystem and job-control methods.
- `capabilities` is required on `CoreBridge` and is the *only* supported way to gate non-core UX (no method-existence probing).
- Keep feature areas (AI, Groups, Batch, etc.) as:
  - either **always present async methods** (if we commit to parity across web/desktop), or
  - **explicitly gated** methods that throw a typed `CapabilityError` when called without support.
  - (Pick per-feature pragmatically; see "Error handling" section.)

### How the WASM scheduler survives the split
- The FIFO scheduler (`EngineScheduler`) in `wasmEngine.ts` / `engineWorker.ts` remains a **private implementation detail**.
- In the new bridge, *everything is async anyway*, so `scheduler.enqueue(...)` becomes the uniform implementation pattern:
  - `WasmCoreBridge` methods always `return this.scheduler.enqueue(...)`.
  - Worker-based engine continues to proxy async calls; worker-side scheduler remains unchanged.
- `whenIdle()` becomes a required `CoreBridge` method and maps directly to scheduler `.whenIdle()` (or resolves immediately for Tauri).

---

## 4) Migration strategy (incremental, minimal breakage)

### Key constraint
"Existing code using the old interface should compile unchanged during transition."

### Strategy overview
1. **Introduce V2 types without changing existing exports**
   - Keep current `export interface EngineBridge` as `LegacyEngineBridge` (alias it but do not break imports).
   - Add new types in the same module (`apps/web/src/engine/bridge.ts`) to avoid import churn:
     - `CoreBridge`, `DesktopBridge`, `EngineCapabilities`
     - `isDesktopBridge(...)`, `requireDesktop(...)`, `requireCapability(...)`
2. **Add an adapter layer**
   - `toCoreBridge(legacy: EngineBridge): CoreBridge`
     - Wraps union return values with `await Promise.resolve(...)`
     - Converts "optional method existence checks" into stable `capabilities`
     - If a legacy optional method is missing, the adapter supplies a stub that throws `CapabilityError` (never "undefined is not a function").
   - Optionally: `toLegacyBridge(core: CoreBridge): EngineBridge` (only if needed for third-party/mocks)
3. **Migrate the store by slice/controller**
   - Add `getCoreEngine()` alongside `getEngine()` in `store/graphStore/kernel.ts`:
     - `getEngine(): EngineBridge` remains for legacy callers.
     - `getCoreEngine(): CoreBridge` is used by migrated slices.
   - Convert the most problematic areas first:
     - `paramController.ts` (removes `if (eng.setAndRender)` branching)
     - `renderSlice.ts` (removes `Promise.resolve(...)` and sync-only assumptions)
     - `projectSlice.ts`, `sequenceVideoSlice.ts`, `batchExportSlice.ts`, `assetsSlice.ts`, `colorSlice.ts`, `undoSlice.ts`
4. **Flip the default**
   - Once all store slices use `CoreBridge`, change `kernel.engine` to store `CoreBridge` and keep a compatibility wrapper for older modules.
5. **Deprecate & remove legacy**
   - After migration, rename:
     - `CoreBridge` → `EngineBridge` (or keep name if preferred)
     - delete union return types and remove optional methods from the main interface surface

### Why this avoids breaking 44+ imports
- No immediate mass rename: keep the file (`engine/bridge.ts`) and keep the legacy type export.
- Only slices/controllers migrate to `getCoreEngine()` over time.

---

## 5) UX considerations (capability-driven UI)

### Principle
**UI should never "try and fail"** for capability issues. If a feature isn't available, disable/hide it with a clear explanation.

### Recommended UX gating pattern
- Store `engineCapabilities` in Zustand once at engine init:
  - `capabilities.platform`: `'web' | 'desktop'`
  - feature flags (examples):
    - `capabilities.liveRender` (setAndRender)
    - `capabilities.sequence.directory` (setSequenceDirectory)
    - `capabilities.jobs` (renderSequence/renderVideo/cancelJob/getJobProgress)
    - `capabilities.customNodes.listing`
    - `capabilities.colorManagement.ocio` (or simply `capabilities.colorManagement`)
- Components:
  - Prefer **disable with tooltip** for buttons already visible ("Render Video (Desktop only)").
  - Prefer **hide** for menu sections that don't make sense in web builds (e.g., "Open Project From Path").
- Store actions:
  - Should short-circuit with a typed `CapabilityError` (or return early with a store error) *before* starting work.

---

## 6) Edge cases: desktop call from WASM + compile-time vs runtime enforcement

### Compile-time enforcement (preferred for platform-only)
- Desktop-only APIs live on `DesktopBridge`.
- `createEngine()` returns `CoreBridge` type; on Tauri it returns an object that *also* satisfies `DesktopBridge`.
- Call sites that need desktop functionality must narrow:
  - `const desktop = requireDesktop(getCoreEngine());`
  - or `if (isDesktopBridge(engine)) { ... } else { ... }`

### Runtime enforcement (still necessary for "feature present but disabled")
- Some features are not purely platform-based (e.g., AI configured vs not).
- These remain runtime-checked and produce typed errors:
  - "AI not configured" is not a bridge capability error; it's a domain error.

### Special case: "method exists but rejects"
Today this happens (notably in Worker/WASM paths) and method-existence checks are unreliable. The new rule:
- **Unsupported capabilities should be represented as `capabilities=false`**
- Any attempted call must throw a **CapabilityError**, not a generic error string.

---

## 7) Error handling

### New error type
Add a dedicated error class + serialized shape that `parseEngineError(...)` understands:

```ts
type CapabilityName =
  | 'desktop.projectIO'
  | 'desktop.sequenceDirectory'
  | 'desktop.videoIO'
  | 'jobs.render'
  | 'gpu.registerKernel'
  | 'customNodes.list'
  | 'customNodes.remove'
  | 'render.live'
  | 'palette.import'
  | 'batch.ingest'
  | 'groups.authoring';

class EngineCapabilityError extends Error {
  code = 'CAPABILITY_UNAVAILABLE' as const;
  capability: CapabilityName;
  platform: 'web' | 'desktop';
}
```

### Policy
- No more "undefined method" failures.
- If capability is missing:
  - store actions either:
    1) short-circuit and set a user-facing error/toast, or
    2) throw `EngineCapabilityError` and let the store's existing error handling surface it.

---

## 8) Backwards compatibility guarantees

### During transition
- Keep `EngineBridge` exactly as-is (union returns + optional methods).
- Add:
  - `LegacyEngineBridge` alias = `EngineBridge` (for clarity in new code)
  - `CoreBridge`/`DesktopBridge` V2 types
- Provide adapters:
  - `toCoreBridge(legacy)` so migrated code can depend on V2 without breaking engine implementations immediately.
  - Update existing engine implementations (Wasm/Tauri/Worker) to either:
    - implement `CoreBridge` directly, *or*
    - keep implementing legacy and rely on adapter until ready.

### End state
- Remove legacy interface once all call sites no longer use it.
- Remove `Promise<T> | T` unions entirely.

---

## 9) Testing strategy

### Unit tests (frontend)
- Add/update a **CoreBridge mock** with explicit capabilities:
  - `apps/web/src/__tests__/engineMock.ts` currently returns a legacy-ish `EngineBridge`; create a parallel `createMockCoreBridge(...)`.
- Add tests for:
  - Capability gating: calling `requireDesktop(...)` on web core throws `CAPABILITY_UNAVAILABLE`.
  - Adapter correctness: `toCoreBridge(legacy)` correctly normalizes sync results into promises.
  - Store behavior changes:
    - `paramController` always uses `core.setAndRender()` (no branching), and handles missing capability.
    - `renderSlice.validateEdits` (if made async) still drives UI correctly.

### Integration-ish tests (store)
- Use existing mock engines to run slice actions:
  - `renderAllViewersAsync`, `setSequenceFiles`, `renderBatch`, `saveProject` gating.

### Manual verification checklist
- Web:
  - live parameter dragging still renders and doesn't panic WASM RefCell (scheduler preserved).
  - sequence file upload still works (`setSequenceInfo` + `loadSequenceFrameData`).
  - video render UI is disabled/hidden.
- Desktop:
  - project save/load via file picker still works.
  - render sequence/video job progress polling still works.

---

## 10) Step-by-step implementation checklist (recommended order)

### A. Define the new abstraction (no behavior change yet)
- [ ] In `apps/web/src/engine/bridge.ts`, add:
  - `EngineCapabilities` type
  - `CoreBridge`, `DesktopBridge` interfaces (async-only)
  - `EngineCapabilityError` + `CapabilityName`
  - `isDesktopBridge`, `requireDesktop`, `requireCapability`
- [ ] Add `toCoreBridge(legacy: EngineBridge): CoreBridge` adapter.

### B. Bridge implementations expose capabilities
- [ ] Update `wasmEngine.ts`:
  - Provide `capabilities` (GPU init success can influence flags like `gpu.available`)
  - Implement/forward required `CoreBridge` methods (async)
- [ ] Update `engineWorker.ts` + `workerEngine.ts`:
  - Expose a `getCapabilities()` method from worker to main thread (or hardcode stable ones if acceptable)
- [ ] Update `tauriEngine.ts`:
  - Provide `capabilities.platform = 'desktop'`
  - Implement any missing "core" methods required by `CoreBridge` (or mark as capability false + throw `CapabilityError`).

### C. Store/kernel plumbing for incremental migration
- [ ] In `store/graphStore/kernel.ts`:
  - Keep `kernel.engine: EngineBridge | null` for legacy
  - Add `kernel.coreEngine: CoreBridge | null`
  - In `createEngine()`, set both:
    - `legacyEngine = created engine`
    - `coreEngine = toCoreBridge(legacyEngine)` (until engines implement CoreBridge directly)
  - Export `getCoreEngine()`.

### D. Migrate store slices/controllers (remove optional probes)
- [ ] `paramController.ts`: replace `if (eng.setAndRender)` branches with:
  - `const eng = getCoreEngine();`
  - `if (!eng.capabilities.liveRender) { ...fallback... }` **OR** call and handle `CapabilityError`.
- [ ] `renderSlice.ts`: remove `Promise.resolve(...)` patterns; rely on async-only signatures.
- [ ] `sequenceVideoSlice.ts`, `batchExportSlice.ts`, `projectSlice.ts`, `assetsSlice.ts`, `colorSlice.ts`, `undoSlice.ts`:
  - Replace `if (eng.someMethod)` with capability checks or `requireDesktop(...)`.

### E. UI gating
- [ ] Add `engineCapabilities` to store state (set once on init).
- [ ] Update UI components/menus to disable/hide based on capabilities.

### F. Remove legacy
- [ ] Once no store/components import legacy `EngineBridge`, replace legacy exports:
  - `EngineBridge` becomes the new `CoreBridge` (or rename and update imports in one sweep).
- [ ] Delete adapters and union types.

---

## 11) Risks and mitigations

### Risk: "Core" accidentally includes desktop-only behavior
- Mitigation: keep `DesktopBridge` small and platform-specific; require compile-time narrowing (`requireDesktop`).

### Risk: large refactor touches many slices and introduces regressions
- Mitigation: adapter-first migration + slice-by-slice conversion; keep legacy path compiling until the end.

### Risk: capabilities diverge from real behavior (especially Worker/WASM stubs)
- Mitigation: **capabilities must be emitted by each backend** (or centrally computed with explicit tests). Never infer capability from method presence.

---

## Escalation triggers (when to revisit design)
- If Phase 2.4 adds a third runtime (Node/headless) and `DesktopBridge` semantics no longer match "non-web".
- If we need per-node capabilities (e.g., GPU kernels available only when GPU initialized) and boolean flags become insufficient.

---

## Optional future considerations (max 2)
1. Extract synchronous "pure helpers" (e.g., `typesCompatible`, `migrateDocument`) into a standalone `engine/pure.ts` module to keep hot UI paths synchronous without mixing sync/async semantics in the bridge.
2. Add a single "job manager" sub-API for long-running tasks (sequence/video render) to decouple polling/cancel semantics from the main bridge.
