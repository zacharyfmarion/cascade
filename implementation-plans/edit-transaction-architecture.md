# Edit Transaction Architecture — Unified Mutation, Rendering, and Diagnostics

Design and implementation plan for introducing a store-level edit transaction API that unifies graph mutations, render scheduling, and error diagnostics across the DSL editor, AI assistant, and direct UI interactions.

---

## 1. Problem Statement

The processor has three independent editors that mutate the graph:

1. **Direct UI** — React Flow node interactions, Inspector panel param changes
2. **DSL Editor** — Monaco-based text editing of the graph DSL
3. **AI Assistant** — LLM-driven tool calls (`write_graph`, `edit_graph`)

All three share the same Zustand store and engine bridge, but each has its own ad-hoc error handling. The result is a set of gaps:

### 1.1 The Async Render Gap

After mutations are applied, rendering happens asynchronously via `renderLock` (a promise chain). Neither the DSL editor nor the AI assistant waits for the render to complete. This means:

- **DSL Editor**: `applyDslToGraph()` clears Monaco markers on successful mutation, but if the subsequent render fails (e.g., a node's `evaluate()` returns `Err`), the editor shows green while the viewer shows a red error bar.
- **AI Assistant**: `write_graph`/`edit_graph` tool responses report `{ success: true }` after mutations apply, but if the render fails, the AI never sees the evaluation error and cannot self-correct.

### 1.2 Disconnected Error Channels

Three categories of errors exist:

| Category | Where caught | DSL Editor sees it? | AI sees it? | UI shows it? |
|----------|-------------|---------------------|-------------|-------------|
| Parse/validation | Before mutations | ✅ Monaco markers | ✅ Tool response | N/A |
| Mutation failure | During mutations | ✅ Monaco markers (line 0) | ✅ Tool response | N/A |
| Evaluation failure | During async render | ❌ Never | ❌ Never | ✅ Viewer bar + node badge |

The evaluation errors are the most dangerous because they're invisible to the editor that caused them.

### 1.3 Suppress-Flag Fragility

The DSL editor uses `suppressApplyRef` (a boolean ref) to prevent feedback loops when pushing serialized graph text to Monaco. This works today but is fragile:

- No concept of "who made this change" — just a boolean flag
- Doesn't compose if multiple editors are active simultaneously
- The AI assistant uses `beginAiAction()/endAiAction()` which suppresses DSL editor updates indirectly (via `userEditingRef`), but this is coincidental, not architectural

### 1.4 HandleMap Singleton Race

The `HandleMap` is a module-level singleton (`instance.ts`) shared between the DSL editor and AI tools via `getSharedHandleMap()`. If both are active simultaneously (user editing DSL while AI is processing), they could race on the same mutable map. Handles also don't participate in undo/redo — undoing an AI action doesn't restore the handle map state.

---

## 2. Design Principles

1. **Transaction = Mutations + Render + Diagnostics** — An edit transaction is not complete until the resulting render has been attempted and diagnostics collected.
2. **Render is store-owned** — The store schedules renders; callers request them. Callers can optionally `await` the render to get diagnostics.
3. **Origin tagging** — Every transaction carries an `origin` (`'ui' | 'dsl' | 'ai'`) so editors can ignore self-originated store updates without suppress flags.
4. **Single diagnostics type** — Parse, validation, mutation, and evaluation errors all flow through one `TransactionDiagnostics` structure.
5. **HandleMap moves to graph document** — Handles are stored as node metadata and derived on demand, eliminating the singleton race.

---

## 3. Architecture

### 3.1 Transaction API

A new `editTransaction()` function on the store that wraps the full lifecycle:

```typescript
interface TransactionOptions {
  origin: 'ui' | 'dsl' | 'ai';
  awaitRender?: boolean;   // default: false for UI, true for DSL/AI
  suppressUndo?: boolean;  // default: false
}

interface TransactionDiagnostics {
  parseErrors: DiagnosticItem[];
  validationErrors: DiagnosticItem[];
  mutationErrors: DiagnosticItem[];
  evalErrors: DiagnosticItem[];
}

interface DiagnosticItem {
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;           // DSL source line (if available)
  nodeId?: string;         // engine node UUID
  nodeType?: string;       // e.g. "gaussian_blur"
  handle?: string;         // DSL handle (if available)
  paramKey?: string;       // specific param (if available)
}

interface TransactionResult {
  success: boolean;
  diagnostics: TransactionDiagnostics;
  graphRevision: number;   // monotonic counter for change detection
}
```

### 3.2 Transaction Lifecycle

```
editTransaction({ origin, awaitRender })
  1. Capture undo snapshot (if !suppressUndo)
  2. Increment renderSuspendCount
  3. Set currentTransactionOrigin = origin
  4. Set graphRevision++
  5. Execute caller's mutation callback
  6. Decrement renderSuspendCount
  7. If awaitRender:
     a. Trigger coalesced render
     b. Await renderLock completion
     c. Collect evalErrors from nodeErrors/lastError
  8. Push undo snapshot
  9. Return TransactionResult with all diagnostics
```

### 3.3 Origin-Based Update Gating

Instead of `suppressApplyRef`, the store exposes `lastTransactionOrigin` and `graphRevision`:

```typescript
// In GraphState:
graphRevision: number;
lastTransactionOrigin: 'ui' | 'dsl' | 'ai' | null;
```

The DSL editor subscribes to the store and checks:
```typescript
// Skip updates that originated from us
if (state.lastTransactionOrigin === 'dsl') return;
// Skip if revision hasn't changed
if (state.graphRevision === lastSeenRevision) return;
```

This replaces three refs (`suppressApplyRef`, `userEditingRef`, `lastPushedDslRef`) with one structural check.

### 3.4 HandleMap Ownership Change

Move handles from a module-level singleton into node metadata:

```typescript
// In NodeInstance (store/types.ts):
interface NodeInstance {
  // ... existing fields
  dslHandle?: string;  // e.g. "blur1", "load1"
}
```

The `HandleMap` class remains as a utility for bidirectional lookups, but is **derived** from the current `nodes` map rather than maintained as independent mutable state:

```typescript
function deriveHandleMap(nodes: Map<string, NodeInstance>): HandleMap {
  const map = new HandleMap();
  for (const [nodeId, node] of nodes) {
    if (node.dslHandle) {
      map.set(node.dslHandle, nodeId);
    }
  }
  return map;
}
```

New nodes without handles get one assigned during serialization (same logic as today), and the handle is written back to `node.dslHandle` via a `setHandle(nodeId, handle)` store action. This means handles participate in undo/redo automatically.

### 3.5 Render Scheduling

The current `triggerAllViewers()` / `renderLock` pattern stays, with one addition: `flushRender()` returns a promise that resolves after the coalesced render completes:

```typescript
// New store action:
flushRender: () => Promise<Map<string, EngineError>>;
```

This is what `editTransaction()` calls internally when `awaitRender: true`. The returned map contains any evaluation errors keyed by node ID.

### 3.6 DSL Source Map

The parser already tracks `line` on `DslNode` and `DslConnection`. We extend this to full spans and expose a mapping from node handles to source locations:

```typescript
interface DslSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

interface DslSourceMap {
  nodeSpans: Map<string, DslSourceSpan>;     // handle → span of entire node decl
  paramSpans: Map<string, Map<string, DslSourceSpan>>; // handle → paramKey → span
  connectionSpans: Map<string, DslSourceSpan>; // "from.port->to.port" → span
}
```

The parser produces this as an optional output. The DSL editor uses it to map `EngineError.nodeId` → handle (via HandleMap) → source span → Monaco marker position.

---

## 4. Detailed Changes

### Phase 1: Transaction API + Render Awaiting (Core Plumbing)

**Goal**: Introduce `editTransaction()` on the store and `flushRender()`. Wire up `beginAiAction()/endAiAction()` as a thin wrapper around the transaction API.

#### 4.1 New types (`apps/web/src/store/types.ts`)

Add `TransactionOptions`, `TransactionDiagnostics`, `DiagnosticItem`, and `TransactionResult` interfaces as described in §3.1.

#### 4.2 Store changes (`apps/web/src/store/graphStore.ts`)

1. Add state fields:
   - `graphRevision: number` (initialized to 0)
   - `lastTransactionOrigin: 'ui' | 'dsl' | 'ai' | null` (initialized to null)

2. Add `flushRender()` action:
   - Triggers `triggerAllViewers()`
   - Returns a promise that resolves when `renderLock` settles
   - Collects `nodeErrors` and `lastError` after the render completes
   - Returns `Map<string, EngineError>` of evaluation errors

3. Add `editTransaction()` action:
   ```typescript
   editTransaction: async (
     options: TransactionOptions,
     mutate: () => Promise<void> | void,
   ) => Promise<TransactionResult>
   ```
   Implementation:
   - Captures undo snapshot
   - Increments `renderSuspendCount`
   - Increments `graphRevision`
   - Sets `lastTransactionOrigin = options.origin`
   - Calls `await mutate()`
   - Decrements `renderSuspendCount`
   - If `awaitRender`: calls `flushRender()`, collects eval errors
   - Pushes undo snapshot
   - Returns `TransactionResult`

4. Refactor `beginAiAction()` / `endAiAction()`:
   - Keep the existing API for backward compatibility
   - Internally, `beginAiAction()` starts a transaction context
   - `endAiAction()` completes it
   - This is a refactor, not a behavior change — existing callers don't break

#### 4.3 Verification

- `cargo check --workspace` passes (no Rust changes in this phase)
- `npx tsc -b --noEmit` passes
- `yarn lint` passes (pre-existing errors only)
- Manual test: Direct UI edits still trigger renders as before

---

### Phase 2: Wire DSL Editor to Transaction API

**Goal**: Make `applyDslToGraph()` use `editTransaction()` with `awaitRender: true`, and show evaluation errors as Monaco markers.

#### 4.4 Executor changes (`apps/web/src/ai/dsl/executor.ts`)

1. Update `applyMutations()` to accept an optional `TransactionOptions` parameter:
   ```typescript
   export const applyMutations = async (
     mutations: GraphMutation[],
     handleMap: HandleMap,
     nodeSpecs: NodeSpec[],
     txOptions?: TransactionOptions,
   ): Promise<ApplyResult>
   ```
   - When `txOptions` is provided, uses `editTransaction()` internally
   - When not provided, falls back to current `beginAiAction()/endAiAction()` behavior (for backward compatibility during migration)

2. Update `applyDsl()` to pass `{ origin: 'dsl', awaitRender: true }` and return evaluation errors in the result:

   Extend `ApplyDslResult`:
   ```typescript
   export type ApplyDslResult =
     | { success: true; updatedDsl: string; evalErrors?: DiagnosticItem[] }
     | { success: false; errors: (ParseError | ValidationError)[] };
   ```

#### 4.5 DSL Editor changes (`apps/web/src/components/DslEditor.tsx`)

1. **Replace `suppressApplyRef` with origin gating**:
   - Remove `suppressApplyRef`, `userEditingRef`, `lastPushedDslRef` refs
   - In the graph→editor subscription, check `state.lastTransactionOrigin !== 'dsl'` and `state.graphRevision !== lastSeenRevision`
   - Track `lastSeenRevision` as a ref

2. **Show evaluation errors as Monaco markers**:
   - After `applyDslToGraph()` returns, if `result.success && result.evalErrors?.length`, call `setMarkers()` with eval errors mapped to source lines
   - Eval error markers should use a different marker owner (e.g., `'dsl-eval'`) so they can be cleared independently of parse/validation markers
   - Use the DslSourceMap (Phase 4) for precise line mapping; until then, fall back to the `DslNode.line` from the most recent parsed AST

3. **Subscribe to `nodeErrors` for live eval error updates**:
   - The DSL editor should also subscribe to `nodeErrors` changes in the store
   - When `nodeErrors` changes (e.g., due to a UI-triggered re-render), map node IDs to DSL lines and update eval markers
   - This covers the case where a render is triggered by something other than a DSL edit but the DSL editor is visible

#### 4.6 Verification

- `npx tsc -b --noEmit` passes
- `yarn lint` passes
- Manual test: Edit DSL to create an invalid graph (e.g., connect incompatible types) → see eval error markers in Monaco after render completes
- Manual test: UI edit triggers render that fails → DSL editor shows eval error markers
- Manual test: Fix the error in DSL → markers clear after successful render

---

### Phase 3: Wire AI Tools to Transaction API

**Goal**: Make `write_graph`/`edit_graph` return post-render evaluation errors so the AI can self-correct.

#### 4.7 Transport changes (`apps/web/src/ai/transport.ts`)

1. Update `experimental_onStart` and `onFinish` to use the transaction API:
   - `experimental_onStart`: Begin a transaction with `{ origin: 'ai' }`
   - `onFinish`: End the transaction (this already happens via `endAiAction()`)
   - The key change: the transaction boundary should allow individual tool calls within it to await sub-renders if needed

2. Alternative approach (simpler): Keep `beginAiAction()/endAiAction()` wrapping the full tool loop, but make individual `write_graph`/`edit_graph` calls do a "peek" at eval errors after the coalesced render. This means:
   - The tool loop still suspends renders during the full AI action
   - After `endAiAction()` flushes the coalesced render, the AI transport collects eval errors
   - If eval errors exist, they're appended to the last tool result or sent as a system message

**Recommended approach**: Option 2 (simpler). The AI already works within `beginAiAction()/endAiAction()`. We add a post-render diagnostic collection step in `onFinish`:

```typescript
onFinish: async () => {
  useGraphStore.getState().endAiAction();
  // After endAiAction flushes the render, wait for it to complete
  const evalErrors = await useGraphStore.getState().flushRender();
  // Eval errors are now in the store (nodeErrors/lastError)
  // The AI sees them on the next turn if it calls read_graph or view_current_image
},
```

#### 4.8 Tool response enrichment (`apps/web/src/ai/tools.ts`)

1. Add a `get_diagnostics` tool:
   ```typescript
   get_diagnostics: tool({
     description: 'Get current graph errors and warnings. Call this after write_graph/edit_graph to check if the graph renders successfully.',
     inputSchema: z.object({}),
     execute: async () => {
       const { nodeErrors, lastError } = useGraphStore.getState();
       if (nodeErrors.size === 0 && !lastError) {
         return { status: 'ok', errors: [] };
       }
       const errors = [];
       for (const [nodeId, error] of nodeErrors) {
         const handleMap = getSharedHandleMap();
         const handle = handleMap.getHandle(nodeId);
         errors.push({
           node: handle ?? nodeId,
           nodeType: error.nodeType,
           code: error.code,
           message: error.message,
         });
       }
       if (lastError && !lastError.nodeId) {
         errors.push({
           code: lastError.code,
           message: lastError.message,
         });
       }
       return { status: 'error', errors };
     },
   }),
   ```

2. **Alternative**: Enrich `write_graph`/`edit_graph` responses to include eval errors inline. This is more aggressive but means the AI doesn't need an extra tool call:
   - After mutations apply successfully, wait for the render to complete
   - If eval errors exist, add them to the response:
     ```json
     {
       "success": true,
       "graph": "...",
       "mutations_applied": 3,
       "eval_warnings": [
         { "node": "blur1", "message": "Missing required input: image" }
       ]
     }
     ```
   
   **Issue**: This requires individual tool calls to await renders, but renders are suspended during the AI action. Solutions:
   - Allow "sub-flush" renders within a transaction (complex)
   - Collect eval errors only after the final `endAiAction()` flush and append to the last tool result
   - Use the `get_diagnostics` tool approach (recommended for v1)

**Recommendation**: Add `get_diagnostics` tool for v1. Update the system prompt to instruct the AI to call `get_diagnostics` after `write_graph`/`edit_graph` when it wants to verify the render succeeded. In v2, consider inline eval errors.

#### 4.9 System prompt update (`apps/web/src/ai/systemPrompt.ts`)

Add guidance about `get_diagnostics`:

```
## Verifying Changes
After calling write_graph or edit_graph, call get_diagnostics to check if the graph
renders without errors. If there are evaluation errors, fix the graph and retry.
Common eval errors:
- "Missing required input: image" — a node needs an image connection
- "EvalFailed" — a node's evaluation crashed (check params and connections)
```

#### 4.10 Verification

- `npx tsc -b --noEmit` passes
- `yarn lint` passes
- Manual test: AI makes a change that causes eval error → AI calls `get_diagnostics` → sees the error → can self-correct
- Manual test: AI makes a valid change → `get_diagnostics` returns `{ status: 'ok' }`

---

### Phase 4: DSL Source Map + Handle Ownership

**Goal**: Precise error-to-source-line mapping and eliminate the HandleMap singleton.

#### 4.11 Parser source map (`apps/web/src/ai/dsl/parser.ts`)

1. Extend the parser to track source spans for each AST node:
   - `DslNode` already has `line`; add `endLine`, `startCol`, `endCol`
   - Add `paramSpans: Map<string, DslSourceSpan>` to `DslNode`
   - `DslConnection` already has `line`; add column span info

2. Add `DslSourceMap` as an optional output of `parseDsl()`:
   ```typescript
   interface ParseResult {
     ast: DslAst | null;
     errors: ParseError[];
     sourceMap?: DslSourceMap;  // NEW
   }
   ```

3. The source map is passed to the DSL editor for precise Monaco marker placement.

#### 4.12 Handle storage in node metadata (`apps/web/src/store/types.ts`)

1. Add `dslHandle?: string` to `NodeInstance` interface

2. Add store action `setDslHandle(nodeId: string, handle: string)`:
   - Sets `node.dslHandle = handle`
   - Does NOT trigger re-render (metadata-only change)

3. The serializer calls `setDslHandle()` when assigning a new handle to a node that doesn't have one yet

#### 4.13 HandleMap derivation (`apps/web/src/ai/dsl/instance.ts`)

1. Replace the singleton with a derivation function:
   ```typescript
   export function deriveHandleMap(nodes: Map<string, NodeInstance>): HandleMap {
     const map = new HandleMap();
     for (const [nodeId, node] of nodes) {
       if (node.dslHandle) {
         map.set(node.dslHandle, nodeId);
       }
     }
     return map;
   }
   ```

2. Callers (`serializeGraph`, `applyDsl`, `DslEditor`, AI tools) derive the map from current state instead of calling `getSharedHandleMap()`

3. **Migration**: During the transition, `getSharedHandleMap()` can derive from the store if available, falling back to the current singleton. Once all callers are updated, the singleton is removed.

4. Handle assignment during serialization:
   - When `serializeGraph()` encounters a node without `dslHandle`, it generates one (same logic as today's `HandleMap.getOrCreate()`) and writes it back via `setDslHandle()`
   - This means first serialization assigns handles; subsequent serializations reuse them

#### 4.14 DSL Editor source map integration

1. After parsing the DSL text (in `validateAndMark` and `applyDslToGraph`), store the `sourceMap` in a ref
2. When mapping eval errors to markers, use: `nodeId` → `handleMap.getHandle(nodeId)` → `sourceMap.nodeSpans.get(handle)` → Monaco marker at that span
3. Fall back to `DslNode.line` → marker at full line width (current behavior) when source map isn't available

#### 4.15 Verification

- `npx tsc -b --noEmit` passes
- `yarn lint` passes
- Manual test: Eval error on `blur1` → Monaco marker highlights the `blur1 = GaussianBlur(...)` line specifically
- Manual test: Undo an AI action → handles are restored correctly
- Manual test: DSL editor and AI assistant active simultaneously → no race on HandleMap
- Unit tests: `deriveHandleMap()` produces same mapping as old `getSharedHandleMap()` for equivalent state

---

### Phase 5: Origin Gating Finalization

**Goal**: Remove all suppress-flag patterns and replace with origin+revision gating.

#### 4.16 Store origin tracking

1. `editTransaction()` already sets `lastTransactionOrigin` and increments `graphRevision`
2. Ensure ALL mutation paths go through transactions:
   - UI mutations (`setParam`, `connect`, `disconnect`, etc.) → wrap in `editTransaction({ origin: 'ui', awaitRender: false })`
   - DSL mutations → already using `editTransaction({ origin: 'dsl', awaitRender: true })`
   - AI mutations → already using `editTransaction({ origin: 'ai', ... })`

3. **Important**: UI mutations should NOT use `awaitRender: true` — that would make every slider drag synchronous. UI mutations keep the current fire-and-forget render behavior.

#### 4.17 DSL Editor cleanup

Remove:
- `suppressApplyRef`
- `userEditingRef`
- `lastPushedDslRef`

Replace with:
- `lastSeenRevisionRef` — tracks the last `graphRevision` the editor synced to
- Graph→editor subscription checks `state.lastTransactionOrigin !== 'dsl'` AND `state.graphRevision !== lastSeenRevisionRef.current`

#### 4.18 AI Assistant cleanup

The AI assistant already works within `beginAiAction()/endAiAction()` which will internally use transactions. No changes needed to `AiAssistant.tsx` or `AiActionFeed.tsx`.

#### 4.19 Verification

- `npx tsc -b --noEmit` passes
- `yarn lint` passes
- Manual test: Edit DSL → UI doesn't flicker (DSL editor ignores its own updates)
- Manual test: Change param in Inspector → DSL editor updates
- Manual test: AI makes change → DSL editor updates, Inspector updates
- Manual test: User types in DSL editor while AI is processing → no feedback loop

---

## 5. Migration Strategy

### What Stays

- **Parser/Validator/Differ/Executor pipeline** — fully preserved. The transaction API wraps around it; internals don't change.
- **Monaco language registration and tokenizer** — unchanged.
- **beginAiAction()/endAiAction() API surface** — kept for backward compatibility, refactored to use transactions internally.
- **renderLock promise chain** — the core render scheduling mechanism stays. `flushRender()` builds on top of it.
- **EngineError type** — the structured error type from Phase B/C of the error handling plan. `DiagnosticItem` wraps it with additional context.

### What Changes

| Component | Current | After |
|-----------|---------|-------|
| Render awaiting | Not possible | `flushRender()` returns `Promise<Map<string, EngineError>>` |
| Mutation batching | `beginAiAction()/endAiAction()` | `editTransaction()` (begin/end are thin wrappers) |
| DSL feedback loop prevention | `suppressApplyRef` boolean | `lastTransactionOrigin` + `graphRevision` |
| HandleMap | Module singleton in `instance.ts` | Derived from `node.dslHandle` metadata |
| AI error visibility | Tool response only (no eval errors) | `get_diagnostics` tool + `nodeErrors` in store |
| DSL eval error display | Not shown | Monaco markers from `nodeErrors` mapped via source map |

### Breaking Changes

None. All changes are additive or internal refactors. The store API surface is extended, not modified. `beginAiAction()/endAiAction()` continue to work as before.

---

## 6. Edge Cases and Risks

### 6.1 Render-During-Transaction

If `awaitRender: true` and the render takes a long time (e.g., large graph, slow GPU node), the DSL editor and AI tool will be blocked. Mitigation:
- Add a render timeout (e.g., 10 seconds). If exceeded, return diagnostics with a "render_timeout" warning.
- The DSL editor shows a loading indicator during render-await.

### 6.2 Multiple Viewers

The processor supports multiple viewer nodes. `flushRender()` renders ALL viewers and collects errors from each. An eval error might be viewer-specific (e.g., one viewer path fails while another succeeds). The diagnostics should include which viewer the error came from, but for v1, we can treat all eval errors as global.

### 6.3 Canonicalization Churn

If the DSL editor serializes the graph after every successful apply and pushes it back to Monaco, the user's formatting is lost. The origin-gating approach avoids this: the DSL editor only re-serializes when the change came from a non-DSL source (`origin !== 'dsl'`). When the user edits the DSL directly, the editor keeps their text and only applies mutations — it doesn't round-trip through serialization.

### 6.4 HandleMap Migration

During migration, nodes without `dslHandle` metadata coexist with the old singleton. The `deriveHandleMap()` function should fall back to `getSharedHandleMap()` for nodes without handles, and populate `dslHandle` lazily during serialization.

### 6.5 Concurrent DSL + AI Edits

With origin gating and derived handle maps, concurrent edits from the DSL editor and AI assistant are safer but still not fully conflict-free. The AI wraps its entire tool loop in `beginAiAction()` which increments `renderSuspendCount`, so DSL editor changes during AI execution won't trigger renders. The DSL editor's `userEditingRef` (replaced by origin gating) prevents the AI's store updates from clobbering the editor. This is sufficient for v1 — true concurrent editing would require OT/CRDT.

### 6.6 Undo/Redo with Handles

Since handles move to `NodeInstance.dslHandle`, undo/redo automatically restores handle state because the entire `nodes` map is captured in undo snapshots. The old singleton HandleMap didn't participate in undo at all — this is a correctness improvement.

---

## 7. Implementation Order and Effort

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|-------------|
| **1** | Transaction API + `flushRender()` | 3-4 hours | None |
| **2** | DSL Editor → Transaction API | 2-3 hours | Phase 1 |
| **3** | AI Tools → Transaction API + `get_diagnostics` | 2-3 hours | Phase 1 |
| **4** | Source Map + Handle Ownership | 3-4 hours | Phases 1-3 |
| **5** | Origin Gating Finalization | 1-2 hours | Phase 4 |

**Total: ~12-16 hours (1.5-2 days)**

Phases 2 and 3 can be done in parallel after Phase 1.

---

## 8. Test Plan

### 8.1 Unit Tests

**Transaction API:**
- Transaction without `awaitRender` increments revision and sets origin
- Transaction with `awaitRender` waits for render and collects eval errors
- Nested transactions are rejected (throw error)
- Transaction with mutation failure rolls back undo snapshot

**HandleMap derivation:**
- `deriveHandleMap()` from nodes with `dslHandle` produces correct bidirectional map
- Nodes without `dslHandle` are excluded from derived map
- Serialization assigns `dslHandle` to nodes that don't have one

**Source Map:**
- Parser produces correct spans for single-line node declarations
- Parser produces correct spans for multi-param nodes
- Parser produces correct spans for connections
- Mapping from `EngineError.nodeId` → source span via handle map

### 8.2 Integration Tests

**DSL Editor + Eval Errors:**
- Edit DSL to create graph with missing connection → render fails → eval error marker appears in Monaco
- Fix the missing connection in DSL → markers clear after successful render
- UI change causes eval error → DSL editor shows marker (cross-origin error flow)

**AI + Eval Errors:**
- AI calls `write_graph` with invalid graph → `get_diagnostics` returns errors
- AI calls `write_graph` with valid graph → `get_diagnostics` returns `{ status: 'ok' }`

**Origin Gating:**
- DSL edit → store updates with `origin: 'dsl'` → DSL editor doesn't re-serialize
- UI edit → store updates with `origin: 'ui'` → DSL editor re-serializes
- AI edit → store updates with `origin: 'ai'` → DSL editor re-serializes

**Undo/Redo:**
- Make AI change → undo → handles restored to pre-AI state
- Make DSL change → undo → handles restored

### 8.3 Manual Verification Checklist

- [ ] DSL editor shows eval errors as red markers when render fails
- [ ] Eval markers clear when graph is fixed
- [ ] AI can self-correct using `get_diagnostics`
- [ ] UI param edits still feel instant (no `awaitRender` blocking)
- [ ] DSL editor doesn't flicker on self-originated changes
- [ ] AI-originated changes update DSL editor content
- [ ] Undo/redo preserves handles correctly
- [ ] No console errors during normal operation

---

## 9. Open Questions

1. **Should `get_diagnostics` be automatic?** Instead of requiring the AI to call `get_diagnostics` explicitly, the transport could automatically append eval errors to the last tool result after `endAiAction()` flushes. This reduces token usage (no extra tool call) but adds complexity to the transport. **Recommendation**: Start with explicit tool for v1; automate in v2 if the AI reliably forgets to call it.

2. **Render timeout value?** The 10-second timeout for `awaitRender` is a guess. Profile typical render times on the test graphs to pick a reasonable value. Very complex graphs with GPU nodes might take longer.

3. **Should UI mutations use transactions?** Wrapping every `setParam` slider drag in a transaction adds overhead. For v1, only DSL and AI use explicit transactions. UI mutations set `lastTransactionOrigin = 'ui'` directly without the full transaction ceremony. Revisit if origin gating doesn't work reliably.

4. **What about the Tauri engine?** The current plan only addresses `WasmEngine`. The `TauriEngine` has its own async IPC error paths. The transaction API should work with both, but Tauri-specific error propagation is out of scope for this plan. The same architectural patterns apply — defer to a Tauri-specific follow-up.
