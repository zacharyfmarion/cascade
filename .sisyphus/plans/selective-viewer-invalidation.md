# Selective Viewer Invalidation

## TL;DR

> **Quick Summary**: Replace `triggerAllViewers()` with selective invalidation that only re-renders viewers whose upstream subgraph was affected by a mutation. Leverage existing Rust dirty propagation.
> 
> **Deliverables**:
> - New Rust function `get_affected_viewers(node_id) -> Vec<NodeId>` in compositor-core
> - WASM bridge exposure of the function
> - New `triggerAffectedViewers(changedNodeId)` in graphStore.ts
> - Replace ~15 single-node mutation call sites (setParam, setInputDefault, etc.)
> - Keep `triggerAllViewers()` for bulk/global operations (undo, frame change, graph import)
> 
> **Estimated Effort**: Medium (3-5 days)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 7 → Final Verification

---

## Context

### Original Request
User requested implementation of Engineering Roadmap Phase 2.2: Selective viewer invalidation. Currently `triggerAllViewers()` is called at 35 sites, causing ALL viewers to re-render on any mutation, even if they're unaffected.

### Interview Summary
**Key Discussions**:
- Rust already has dirty propagation (`dirty_nodes: HashSet<NodeId>`, `mark_dirty()`, `get_downstream()`)
- Need to expose affected viewers query from Rust to frontend
- Conservative approach: only optimize single-node mutations initially, keep bulk operations as-is

**Research Findings**:
- `get_downstream(node_id)` already does BFS via `outputs` adjacency list (graph.rs:267-283)
- Viewer types: `viewer`, `export_image`, `export_image_sequence`, `export_video`, `export_image_batch`
- 35 call sites grouped into: single-node mutations (15), bulk operations (8), frame/playback (4), groups (6), transactions (2)
- Existing optimizations: render suspension batching, generation-based deduplication

### Metis Review
**Identified Gaps** (addressed):
- Missing `export_image_batch` in viewer types — added to constants
- Node deletion semantics — deleted node's former downstream viewers need triggering
- Connection change semantics — trigger viewers affected by new topology (post-mutation)
- Performance regression test needed — verify selective < all baseline
- Under-invalidation risk — conservative fallback to `triggerAllViewers()` on error

---

## Work Objectives

### Core Objective
Reduce unnecessary viewer re-renders by querying the Rust graph for which viewers are actually downstream of a changed node, improving performance in multi-viewer setups.

### Concrete Deliverables
- `crates/compositor-core/src/graph.rs`: `get_affected_viewers()` function
- `crates/compositor-wasm/src/lib.rs`: `get_affected_viewers()` WASM export
- `apps/web/src/store/graphStore.ts`: `triggerAffectedViewers()` action + updated call sites
- Unit tests for `get_affected_viewers()` in Rust
- Integration test verifying selective invalidation works end-to-end

### Definition of Done
- [ ] `cargo test --package compositor-core` passes with new tests
- [ ] `cargo clippy --workspace` passes
- [ ] `yarn lint` and `npx tsc -b --noEmit` pass in apps/web
- [ ] Manual QA: Create graph with 3 viewers, modify param on node feeding 1 viewer, verify only that viewer re-renders

### Must Have
- Rust function `get_affected_viewers(node_id: NodeId) -> Vec<NodeId>`
- WASM bridge exposure with proper error handling
- `triggerAffectedViewers(changedNodeId: string)` in graphStore
- Replace single-node param mutation sites (setParam, setParamCommit, setInputDefault, setInputDefaultCommit)
- Unit tests covering: diamond graph, no downstream viewers, viewer itself changed, disconnected subgraph
- Fallback to `triggerAllViewers()` on WASM error

### Must NOT Have (Guardrails)
- DO NOT optimize undo/redo — keep `triggerAllViewers()`
- DO NOT optimize frame changes (stepForward, stepBackward, goToStart, goToEnd) — time is global
- DO NOT optimize `applyGraphData` / `restoreSnapshot` — bulk operations need all viewers
- DO NOT optimize group navigation — context switch affects all
- DO NOT add transaction batching infrastructure — separate scope
- DO NOT change evaluator cache key logic — only trigger mechanism changes
- DO NOT break render suspension batching — must still work with `renderSuspendCount`
- DO NOT add any `unwrap()` or `expect()` in WASM bridge code

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Rust has `cargo test`, frontend has ESLint/TSC)
- **Automated tests**: YES (Tests-after for Rust unit tests)
- **Framework**: `cargo test` for Rust, manual agent QA for frontend integration

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Rust**: Use `cargo test` — run specific test, verify output
- **WASM/Frontend**: Use Playwright — load app, create graph, trigger mutations, verify render behavior
- **API contract**: Use Read tool to verify function signatures match spec

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — Rust foundation):
├── Task 1: Add get_affected_viewers() to Graph struct [quick]
└── Task 2: Add unit tests for get_affected_viewers() [quick]

Wave 2 (After Wave 1 — Bridge + Frontend):
├── Task 3: Expose get_affected_viewers() in WASM bridge [quick]
└── Task 4: Add triggerAffectedViewers() to graphStore [unspecified-high]

Wave 3 (After Wave 2 — Integration + Testing):
├── Task 5: Replace triggerAllViewers() calls with selective invalidation [unspecified-high]
└── Task 6: Add integration tests for selective invalidation [quick]

Wave FINAL (After ALL tasks — verification):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: End-to-end QA with Playwright [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 3 → Task 4 → Task 5 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 2 (each wave)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | — | 2, 3 |
| 2 | 1 | — |
| 3 | 1 | 4 |
| 4 | 3 | 5 |
| 5 | 4 | 6, F1-F4 |
| 6 | 5 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks → T1 `quick`, T2 `quick`
- **Wave 2**: 2 tasks → T3 `quick`, T4 `unspecified-high`
- **Wave 3**: 2 tasks → T5 `unspecified-high`, T6 `quick`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`
---

## TODOs

- [ ] 1. Add `get_affected_viewers()` to Graph struct

  **What to do**:
  - Add `VIEWER_TYPE_IDS: &[&str] = &["viewer", "export_image", "export_image_sequence", "export_video", "export_image_batch"];` constant at top of graph.rs
  - Implement `pub fn get_affected_viewers(&self, changed_node_id: NodeId) -> Vec<NodeId>` on Graph struct
  - Use existing `get_downstream()` then filter by node type_id matching VIEWER_TYPE_IDS
  - Handle case where changed_node_id doesn't exist (return empty vec)
  - If changed_node_id IS a viewer itself, include it in results

  **Must NOT do**:
  - Do not modify `get_downstream()` implementation
  - Do not add any new fields to Graph struct
  - Do not change dirty tracking logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, focused function addition following existing patterns
  - **Skills**: `[]`
    - No special skills needed — standard Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `crates/compositor-core/src/graph.rs:267-283` — `get_downstream()` BFS implementation to follow
  - `crates/compositor-core/src/graph.rs:196-240` — `mark_dirty()` as example of node iteration pattern

  **API/Type References**:
  - `crates/compositor-core/src/graph.rs:NodeId` — type alias for slotmap key
  - `crates/compositor-core/src/graph.rs:NodeInstance` — has `type_id: String` field

  **WHY Each Reference Matters**:
  - `get_downstream()` — Copy the BFS pattern using `outputs` adjacency list
  - `NodeInstance.type_id` — Filter condition for viewer identification

  **Acceptance Criteria**:
  - [ ] Function compiles without warnings
  - [ ] `cargo clippy --package compositor-core` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Linear chain graph — viewer at end
    Tool: Bash (cargo test)
    Preconditions: Test creates graph: A → B → C → Viewer
    Steps:
      1. Call get_affected_viewers(A)
      2. Assert result contains Viewer node ID
      3. Call get_affected_viewers(B)
      4. Assert result contains Viewer node ID
    Expected Result: Vec containing exactly [Viewer ID]
    Evidence: .sisyphus/evidence/task-1-linear-chain.txt

  Scenario: Diamond graph — single viewer downstream
    Tool: Bash (cargo test)
    Preconditions: Test creates graph: A → B, A → C, B → D, C → D, D → Viewer
    Steps:
      1. Call get_affected_viewers(A)
      2. Assert result contains Viewer
    Expected Result: Vec containing exactly [Viewer ID] (no duplicates)
    Evidence: .sisyphus/evidence/task-1-diamond-graph.txt

  Scenario: No downstream viewers
    Tool: Bash (cargo test)
    Preconditions: Graph: A → B → C (no viewer)
    Steps:
      1. Call get_affected_viewers(A)
    Expected Result: Empty Vec<NodeId>
    Evidence: .sisyphus/evidence/task-1-no-viewers.txt

  Scenario: Changed node IS a viewer
    Tool: Bash (cargo test)
    Preconditions: Graph with isolated Viewer node
    Steps:
      1. Call get_affected_viewers(Viewer)
    Expected Result: Vec containing [Viewer ID] itself
    Evidence: .sisyphus/evidence/task-1-viewer-itself.txt
  ```

  **Commit**: YES
  - Message: `feat(core): add get_affected_viewers() for selective invalidation`
  - Files: `crates/compositor-core/src/graph.rs`
  - Pre-commit: `cargo test --package compositor-core`

- [ ] 2. Add unit tests for `get_affected_viewers()`

  **What to do**:
  - Add test module section in `graph.rs` or `graph_tests.rs`
  - Implement tests for all QA scenarios from Task 1
  - Test edge cases: invalid node ID, empty graph, multiple viewers downstream

  **Must NOT do**:
  - Do not test WASM bridge (separate task)
  - Do not test frontend integration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard test implementation following existing patterns
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1 (runs after Task 1 within wave)
  - **Blocks**: None (but should complete before Wave 2)
  - **Blocked By**: Task 1

  **References**:

  **Test References**:
  - `crates/compositor-core/src/graph.rs` — existing test module at bottom of file
  - `crates/compositor-core/src/eval.rs:1922-2100` — test patterns for cache/evaluator

  **WHY Each Reference Matters**:
  - Existing test module shows test helper patterns and graph construction
  - eval.rs tests show multi-node graph setup patterns

  **Acceptance Criteria**:
  - [ ] `cargo test --package compositor-core -- get_affected_viewers` runs 5+ tests
  - [ ] All tests pass

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Test suite runs and passes
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: cargo test --package compositor-core -- get_affected_viewers --nocapture
      2. Parse output for "test result: ok"
      3. Count tests run (should be >= 5)
    Expected Result: "test result: ok. 5 passed" or more
    Evidence: .sisyphus/evidence/task-2-test-run.txt
  ```

  **Commit**: YES (group with Task 1)
  - Message: `feat(core): add get_affected_viewers() for selective invalidation`
  - Files: `crates/compositor-core/src/graph.rs`
  - Pre-commit: `cargo test --package compositor-core`

- [ ] 3. Expose `get_affected_viewers()` via WASM bridge

  **What to do**:
  - Add `pub fn get_affected_viewers(&mut self, node_id: &str) -> Result<Vec<String>, JsValue>` in `compositor-wasm/src/lib.rs`
  - Parse node_id string to NodeId using existing pattern
  - Call `self.graph.get_affected_viewers(node_id)`
  - Convert Vec<NodeId> to Vec<String> for JS
  - Use `map_err(to_engine_error)?` for error propagation (WASM bridge rule)

  **Must NOT do**:
  - Do not use `.unwrap()` or `.expect()` (blocked by #![deny(clippy::unwrap_used)])
  - Do not change any existing WASM function signatures

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard WASM bridge function following existing patterns
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4, Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `crates/compositor-wasm/src/lib.rs:693-720` — `render_viewer()` as example of node_id handling
  - `crates/compositor-wasm/src/lib.rs:150-180` — Error conversion pattern with `to_engine_error`

  **API/Type References**:
  - `crates/compositor-wasm/src/lib.rs:Engine` struct — where to add the method

  **WHY Each Reference Matters**:
  - `render_viewer()` shows how to parse node_id string to NodeId and handle missing nodes
  - Error conversion pattern is mandatory per AGENTS.md WASM bridge rules

  **Acceptance Criteria**:
  - [ ] `wasm-pack build crates/compositor-wasm --target web` succeeds
  - [ ] `cargo clippy --package compositor-wasm` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: WASM build succeeds
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: wasm-pack build crates/compositor-wasm --target web --out-dir /tmp/wasm-test
      2. Check exit code is 0
      3. Verify /tmp/wasm-test/compositor_wasm.js exists
    Expected Result: Build succeeds, JS file generated
    Evidence: .sisyphus/evidence/task-3-wasm-build.txt

  Scenario: Function exported correctly
    Tool: Bash
    Preconditions: WASM build complete
    Steps:
      1. grep "get_affected_viewers" /tmp/wasm-test/compositor_wasm.d.ts
      2. Verify function signature present
    Expected Result: TypeScript declaration includes get_affected_viewers
    Evidence: .sisyphus/evidence/task-3-wasm-export.txt
  ```

  **Commit**: YES
  - Message: `feat(wasm): expose get_affected_viewers() to JavaScript`
  - Files: `crates/compositor-wasm/src/lib.rs`
  - Pre-commit: `cargo clippy --package compositor-wasm`

- [ ] 4. Add `triggerAffectedViewers()` to graphStore

  **What to do**:
  - Add new action `triggerAffectedViewers: (changedNodeIds: string[]) => void` to GraphState interface
  - Implement: query engine.getAffectedViewers() for each node, union results, trigger each unique viewer
  - Handle engine errors gracefully: log warning and fall back to `triggerAllViewers()`
  - Respect existing `renderSuspendCount` batching (check before triggering)
  - Add `renderNeededNodes: Set<string>` for batched operations (like renderNeededWhileSuspended)

  **Must NOT do**:
  - Do not remove `triggerAllViewers()` — it's still needed for bulk operations
  - Do not change `triggerRender()` implementation
  - Do not modify render suspension logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core frontend logic with error handling considerations
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `apps/web/src/store/graphStore.ts:364-375` — `triggerAllViewers()` implementation to parallel
  - `apps/web/src/store/graphStore.ts:1413-1441` — `triggerRender()` call pattern

  **API/Type References**:
  - `apps/web/src/engine/bridge.ts` — EngineBridge interface for type updates
  - `apps/web/src/engine/wasmEngine.ts` — WasmEngine implementation

  **WHY Each Reference Matters**:
  - `triggerAllViewers()` shows the render suspension check pattern to copy
  - `triggerRender()` is what we call for each affected viewer
  - EngineBridge needs the new function added to interface

  **Acceptance Criteria**:
  - [ ] `yarn lint` passes in apps/web
  - [ ] `npx tsc -b --noEmit` passes in apps/web

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles
    Tool: Bash
    Preconditions: Task 3 WASM bridge complete
    Steps:
      1. cd apps/web
      2. npx tsc -b --noEmit
      3. Check exit code is 0
    Expected Result: No TypeScript errors
    Evidence: .sisyphus/evidence/task-4-tsc.txt

  Scenario: ESLint passes
    Tool: Bash
    Preconditions: TypeScript compiles
    Steps:
      1. cd apps/web && yarn lint
      2. Check exit code is 0
    Expected Result: No lint errors
    Evidence: .sisyphus/evidence/task-4-lint.txt

  Scenario: Error fallback to triggerAllViewers
    Tool: Bash (node test)
    Preconditions: Mock engine.getAffectedViewers() to throw error
    Steps:
      1. Mock getAffectedViewers to reject with Error
      2. Call triggerAffectedViewers(['node1'])
      3. Assert console.warn was called
      4. Assert triggerAllViewers was called as fallback
    Expected Result: Graceful degradation, no crash, all viewers triggered
    Evidence: .sisyphus/evidence/task-4-error-fallback.txt
  ```

  **Commit**: YES
  - Message: `feat(web): add triggerAffectedViewers() for selective invalidation`
  - Files: `apps/web/src/store/graphStore.ts`, `apps/web/src/engine/bridge.ts`, `apps/web/src/engine/wasmEngine.ts`
  - Pre-commit: `cd apps/web && yarn lint && npx tsc -b --noEmit`

- [ ] 5. Replace `triggerAllViewers()` calls with `triggerAffectedViewers()` for single-node mutations

  **What to do**:
  Replace `triggerAllViewers()` with `triggerAffectedViewers([nodeId])` at these call sites:
  - `setParam` (line ~938) — pass nodeId parameter
  - `setParamCommit` (line ~1077) — pass nodeId parameter
  - `setInputDefault` (line ~1092) — pass nodeId parameter
  - `setInputDefaultCommit` (line ~1184) — pass nodeId parameter
  - `toggleMuteSelected` (line ~1241) — pass selected node IDs
  - `compileScriptNode` (line ~1904) — pass nodeId parameter
  - `connect` (line ~866, 889) — pass [sourceId, targetId]
  - `disconnect` (line ~923) — pass [sourceId, targetId]

  **KEEP `triggerAllViewers()` for**:
  - `applyGraphData` — bulk graph load, too complex
  - `restoreSnapshot` — undo/redo, affects unknown nodes
  - `stepForward/stepBackward/goToStart/goToEnd` — frame changes affect all
  - `enterGroup/navigateToBreadcrumb/createGroup/ungroupNode` — context switches
  - `loadImageFile/loadVideoFile/loadPaletteFile` — input loading (could optimize later)
  - `editTransaction/flushRender` — batched operations

  **Must NOT do**:
  - Do not remove `triggerAllViewers()` function
  - Do not optimize undo/redo (keep triggerAllViewers)
  - Do not optimize frame changes (keep triggerAllViewers)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple call sites requiring careful node ID extraction
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 6
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `apps/web/src/store/graphStore.ts:938` — setParam implementation shows nodeId is available
  - `apps/web/src/store/graphStore.ts:866-889` — connect has sourceId/targetId
  - `apps/web/src/store/graphStore.ts:923` — disconnect has nodeId/port

  **WHY Each Reference Matters**:
  - Each call site already has the node ID available as a parameter
  - Just need to pass it through to triggerAffectedViewers

  **Acceptance Criteria**:
  - [ ] `yarn lint` passes
  - [ ] `npx tsc -b --noEmit` passes
  - [ ] grep for `triggerAllViewers()` shows reduced call count (22 remaining, down from 35)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Single param change triggers only affected viewer
    Tool: Playwright (playwright skill)
    Preconditions: App running with test graph: ReadImage → Blur → Viewer1, ReadImage2 → Viewer2
    Steps:
      1. Navigate to localhost:5173
      2. Open the test graph with 2 independent branches
      3. Intercept network/console to track render calls
      4. Change Blur "radius" parameter
      5. Assert Viewer1 received triggerRender call
      6. Assert Viewer2 did NOT receive triggerRender call
    Expected Result: Only Viewer1 re-renders, Viewer2 unchanged
    Failure Indicators: Both viewers re-render, or no viewers re-render
    Evidence: .sisyphus/evidence/task-5-selective-render.png

  Scenario: Connect triggers affected viewers
    Tool: Playwright (playwright skill)
    Preconditions: App running, graph with disconnected viewer
    Steps:
      1. Create connection from processing node to Viewer1
      2. Assert Viewer1 triggerRender called
      3. Assert other viewers NOT called
    Expected Result: Only newly connected viewer re-renders
    Evidence: .sisyphus/evidence/task-5-connect-render.png

  Scenario: Frame change still triggers all viewers
    Tool: Playwright (playwright skill)
    Preconditions: App running with 2+ viewers
    Steps:
      1. Click step forward button
      2. Assert ALL viewers receive triggerRender
    Expected Result: All viewers re-render (frame is global)
    Evidence: .sisyphus/evidence/task-5-frame-change.png
  ```

  **Commit**: YES
  - Message: `perf(web): use selective viewer invalidation for single-node mutations`
  - Files: `apps/web/src/store/graphStore.ts`
  - Pre-commit: `cd apps/web && yarn lint && npx tsc -b --noEmit`

- [ ] 6. Add integration test for selective invalidation

  **What to do**:
  - Create test file `apps/web/src/__tests__/selective-viewer-invalidation.test.ts`
  - Mock engine.getAffectedViewers() to return controlled results
  - Test: mutation on node A triggers only viewers returned by getAffectedViewers
  - Test: fallback to triggerAllViewers on engine error
  - Test: render suspension accumulates affected nodes

  **Must NOT do**:
  - Do not test Rust implementation (covered by Task 2)
  - Do not test WASM binding (build verification sufficient)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard test file following existing patterns
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 5)
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:

  **Test References**:
  - `apps/web/src/__tests__/` — existing test directory and patterns
  - `apps/web/vitest.config.ts` or `jest.config.js` — test framework config

  **WHY Each Reference Matters**:
  - Follow existing test patterns for consistency
  - Use correct test framework (vitest or jest)

  **Acceptance Criteria**:
  - [ ] Test file exists and contains 4+ test cases
  - [ ] `yarn test` includes selective-viewer-invalidation tests
  - [ ] All tests pass

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Test suite runs and passes
    Tool: Bash
    Preconditions: Task 5 complete
    Steps:
      1. cd apps/web
      2. yarn test selective-viewer-invalidation
      3. Check exit code is 0
    Expected Result: 4+ tests pass
    Evidence: .sisyphus/evidence/task-6-test-run.txt
  ```

  **Commit**: YES
  - Message: `test(web): add integration tests for selective viewer invalidation`
  - Files: `apps/web/src/__tests__/selective-viewer-invalidation.test.ts`
  - Pre-commit: `cd apps/web && yarn test selective-viewer-invalidation`

---

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run test). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo clippy --workspace`, `cargo test --workspace`, `yarn lint`, `npx tsc -b --noEmit`. Review all changed files for: `unwrap()`/`expect()` in WASM bridge, empty catches, console.log in prod. Check no `triggerAllViewers()` at sites that should be selective.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **End-to-end QA** — `unspecified-high` + `playwright` skill
  Load the app in browser. Create graph: Read → ColorCorrect → Viewer1, Read → Blur → Viewer2. Modify ColorCorrect param. Verify ONLY Viewer1 re-renders (check render generation or timing). Modify Blur param. Verify ONLY Viewer2 re-renders. Test error fallback by simulating WASM error.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Verify undo/redo/frame change sites still use `triggerAllViewers()`.
  Output: `Tasks [N/N compliant] | Forbidden Sites [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files | Pre-commit Check |
|------|---------------|-------|------------------|
| 1 | `feat(core): add get_affected_viewers() for selective invalidation` | graph.rs | `cargo test --package compositor-core` |
| 2 | `feat(wasm): expose get_affected_viewers() to frontend` | lib.rs, bridge.ts, graphStore.ts | `cargo test && yarn lint` |
| 3 | `refactor(web): replace triggerAllViewers() with selective invalidation` | graphStore.ts | `yarn lint && npx tsc -b --noEmit` |

---

## Success Criteria

### Verification Commands
```bash
# Rust tests pass
cargo test --package compositor-core -- get_affected_viewers  # Expected: 4+ tests pass

# No clippy warnings
cargo clippy --workspace -- -D warnings  # Expected: 0 warnings

# Frontend builds
cd apps/web && yarn lint && npx tsc -b --noEmit  # Expected: 0 errors

# WASM builds
wasm-pack build crates/compositor-wasm --target web  # Expected: success
```

### Final Checklist
- [ ] `get_affected_viewers()` returns correct viewer subset
- [ ] WASM bridge exposes function with proper error handling
- [ ] `triggerAffectedViewers()` queries engine and triggers only affected viewers
- [ ] Single-node param mutations use selective invalidation
- [ ] Bulk operations (undo, frame change, import) still use `triggerAllViewers()`
- [ ] No `unwrap()`/`expect()` in WASM bridge
- [ ] All tests pass
