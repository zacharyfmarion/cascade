# Migration Architecture for Document Format Versioning

## TL;DR

> **Quick Summary**: Implement a versioned migration system in `compositor-runtime` that automatically upgrades old project files when loaded. The first migration renames the Viewer node's input port from `"image"` to `"value"`.
> 
> **Deliverables**:
> - `migrations/` module in compositor-runtime with registry pattern
> - v1.0.0 → v1.1.0 migration for Viewer port rename
> - WASM bridge functions for frontend integration
> - Frontend `loadProject` integration
> - Unit tests for migrations
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 6

---

## Context

### Original Request
The Viewer node's input port was renamed from `"image"` to `"value"` to support universal value inspection. Existing project files have connections referencing the old port name and will fail to load correctly.

### Interview Summary
**Key Decisions**:
- Migrations are forward-only (not reversible)
- No user warning for non-destructive migrations (console log only)
- Autosave writes migrated version to avoid repeated migrations
- Rust-owned migrations with thin WASM bridge for frontend

**Research Findings**:
- Document format already has `format_version` field (currently "1.0.0")
- `SerializableConnection` has `to_port` field that needs transformation
- Load flow: `JSON.parse` → `extractGraphData` → `importDocument` → `applyGraphData`
- Migration should intercept after `JSON.parse`, before `extractGraphData`

---

## Work Objectives

### Core Objective
Create a robust, extensible migration system that automatically upgrades project files from older versions to the current format on load.

### Concrete Deliverables
- `crates/compositor-runtime/src/migrations/mod.rs` — Migration registry and runner
- `crates/compositor-runtime/src/migrations/v1_0_0_to_v1_1_0.rs` — Viewer port migration
- `crates/compositor-wasm/src/lib.rs` — `migrate_document()` and `needs_migration()` functions
- `apps/web/src/engine/bridge.ts` — Migration methods on `EngineBridge`
- `apps/web/src/engine/wasmEngine.ts` — WASM migration implementation
- `apps/web/src/store/graphStore.ts` — Integration in `loadProject`
- Updated `CURRENT_FORMAT_VERSION` to "1.1.0"

### Definition of Done
- [ ] `cargo test --workspace` passes with new migration tests
- [ ] Loading a v1.0.0 project file with Viewer connections works correctly
- [ ] Saving a migrated file uses format_version "1.1.0"
- [ ] Future version detection shows appropriate error

### Must Have
- Version comparison logic (semver-aware)
- Chain of migrations (1.0.0 → 1.1.0 → future versions)
- Viewer port rename migration
- Frontend integration that applies migration before graph import
- Migration report logged to console

### Must NOT Have (Guardrails)
- No reverse migrations
- No UI dialogs/prompts for migration
- No modification of original file until explicit save
- No breaking changes to document structure
- No migration of clipboard/copy-paste format (out of scope for now)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (cargo test)
- **Automated tests**: YES (tests-after)
- **Framework**: cargo test (Rust), bun test (if needed for TS)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Rust modules**: Use Bash (cargo test) — Run tests, assert pass
- **WASM bridge**: Use Bash (cargo check -p compositor-wasm) — Verify compilation
- **Frontend**: Use Bash (npx tsc -b --noEmit) — TypeScript check

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — Rust foundation):
├── Task 1: Create migrations module structure [quick]
├── Task 2: Implement v1.0.0 → v1.1.0 migration [quick]
└── Task 3: Update CURRENT_FORMAT_VERSION to 1.1.0 [quick]

Wave 2 (After Wave 1 — WASM bridge):
└── Task 4: Add WASM bridge functions [quick]

Wave 3 (After Wave 2 — Frontend integration):
├── Task 5: Add EngineBridge migration methods [quick]
└── Task 6: Integrate migration in loadProject [quick]

Wave FINAL (After ALL tasks):
├── Task F1: Run cargo test for migration tests [quick]
├── Task F2: Run cargo clippy [quick]
└── Task F3: Run frontend typecheck [quick]
```

### Dependency Matrix
- **1**: — (can start immediately)
- **2**: 1 (needs mod.rs structure)
- **3**: 1 (needs mod.rs to import)
- **4**: 1, 2 (needs migration module complete)
- **5**: 4 (needs WASM functions)
- **6**: 5 (needs bridge methods)
- **F1-F3**: All tasks complete

---

## TODOs

- [x] 1. Create migrations module structure

  **What to do**:
  - Create `crates/compositor-runtime/src/migrations/mod.rs`
  - Define `MigrationError` enum with variants: `InvalidStructure`, `FutureVersion`, `NoMigrationPath`, `MigrationFailed`
  - Define `MigrationReport` struct with `from_version`, `to_version`, `applied` fields
  - Define `Migration` struct with `from_version`, `to_version`, `description`, `migrate` fn
  - Create `MIGRATIONS` static array (initially with placeholder for v1_0_0_to_v1_1_0)
  - Implement `extract_version()`, `set_version()`, `compare_versions()` helpers
  - Implement `needs_migration()` public function
  - Implement `migrate_document()` public function with version chain logic
  - Add `pub mod migrations;` to `lib.rs`

  **Must NOT do**:
  - Don't implement the actual v1_0_0_to_v1_1_0 migration yet (Task 2)
  - Don't add WASM bindings yet (Task 4)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 2, 3, 4
  - **Blocked By**: None

  **References**:
  - `crates/compositor-runtime/src/document.rs:7` — `CURRENT_FORMAT_VERSION` constant pattern
  - `crates/compositor-runtime/src/lib.rs:1-4` — Module declaration pattern
  - `crates/compositor-runtime/Cargo.toml:19` — serde_json already a dependency

  **Acceptance Criteria**:
  - [ ] File exists: `crates/compositor-runtime/src/migrations/mod.rs`
  - [ ] `cargo check -p compositor-runtime` passes
  - [ ] Module exports `MigrationError`, `MigrationReport`, `migrate_document`, `needs_migration`, `CURRENT_VERSION`

  **QA Scenarios**:
  ```
  Scenario: Module compiles and exports are accessible
    Tool: Bash (cargo)
    Preconditions: migrations/mod.rs created
    Steps:
      1. Run: cargo check -p compositor-runtime
      2. Verify exit code 0
    Expected Result: Compilation succeeds with no errors
    Evidence: .sisyphus/evidence/task-1-module-compiles.txt
  ```

  **Commit**: YES (groups with 2, 3)
  - Message: `feat(runtime): add migrations module with version chain support`
  - Files: `crates/compositor-runtime/src/migrations/mod.rs`, `crates/compositor-runtime/src/lib.rs`

---

- [x] 2. Implement v1.0.0 → v1.1.0 migration (Viewer port rename)

  **What to do**:
  - Create `crates/compositor-runtime/src/migrations/v1_0_0_to_v1_1_0.rs`
  - Implement `pub fn migrate(doc: &mut serde_json::Value) -> Result<(), MigrationError>`
  - Find all nodes with `type_id == "viewer"` and collect their IDs
  - Iterate `graph.connections` array
  - For each connection where `to_node` is a viewer AND `to_port == "image"`, change `to_port` to `"value"`
  - Also handle connections inside `graph.group_definitions[].internal_graph.connections`
  - Add `mod v1_0_0_to_v1_1_0;` to `mod.rs`
  - Wire up in `MIGRATIONS` array

  **Must NOT do**:
  - Don't rename ports in node specs (only connections)
  - Don't touch `from_port` (source ports are unchanged)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:
  - `crates/compositor-runtime/src/lib.rs:60-77` — `SerializableConnection` structure
  - `crates/compositor-runtime/src/lib.rs:53-58` — `SerializableGraph` structure with connections array
  - Test fixtures: Create inline JSON in tests

  **Acceptance Criteria**:
  - [ ] File exists: `crates/compositor-runtime/src/migrations/v1_0_0_to_v1_1_0.rs`
  - [ ] Migration registered in `MIGRATIONS` array
  - [ ] Unit test: connection `{to_node: "viewer-1", to_port: "image"}` becomes `{to_port: "value"}`
  - [ ] Unit test: non-viewer connections unchanged
  - [ ] Unit test: connections inside group definitions also migrated

  **QA Scenarios**:
  ```
  Scenario: Viewer port migration transforms connections correctly
    Tool: Bash (cargo test)
    Preconditions: v1_0_0_to_v1_1_0.rs implemented with tests
    Steps:
      1. Run: cargo test -p compositor-runtime migrate
      2. Verify all migration tests pass
    Expected Result: Tests pass, exit code 0
    Evidence: .sisyphus/evidence/task-2-migration-tests.txt

  Scenario: Non-viewer connections unchanged
    Tool: Bash (cargo test)
    Preconditions: Test exists that verifies non-viewer ports untouched
    Steps:
      1. Covered by above test run
    Expected Result: Non-viewer connections have original to_port values
    Evidence: (included in above)
  ```

  **Commit**: YES (groups with 1, 3)
  - Message: `feat(runtime): add v1.0.0→v1.1.0 migration for Viewer port rename`
  - Files: `crates/compositor-runtime/src/migrations/v1_0_0_to_v1_1_0.rs`, `crates/compositor-runtime/src/migrations/mod.rs`

---

- [x] 3. Update CURRENT_FORMAT_VERSION to 1.1.0

  **What to do**:
  - In `crates/compositor-runtime/src/document.rs`, change `CURRENT_FORMAT_VERSION` from `"1.0.0"` to `"1.1.0"`
  - Ensure `migrations::CURRENT_VERSION` matches (it should be `"1.1.0"`)
  - Add a comment noting the version history

  **Must NOT do**:
  - Don't change any other document structure

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: None directly
  - **Blocked By**: Task 1 (for version constant reference)

  **References**:
  - `crates/compositor-runtime/src/document.rs:7` — `CURRENT_FORMAT_VERSION` constant

  **Acceptance Criteria**:
  - [ ] `CURRENT_FORMAT_VERSION` is `"1.1.0"`
  - [ ] `migrations::CURRENT_VERSION` matches
  - [ ] `cargo check` passes

  **QA Scenarios**:
  ```
  Scenario: Version constants are consistent
    Tool: Bash (grep)
    Preconditions: Both files updated
    Steps:
      1. Run: grep -r "1.1.0" crates/compositor-runtime/src/
      2. Verify document.rs and migrations/mod.rs both contain "1.1.0"
    Expected Result: Both files have matching version
    Evidence: .sisyphus/evidence/task-3-version-check.txt
  ```

  **Commit**: YES (groups with 1, 2)
  - Message: `chore(runtime): bump format version to 1.1.0`
  - Files: `crates/compositor-runtime/src/document.rs`

---

- [ ] 4. Add WASM bridge functions

  **What to do**:
  - In `crates/compositor-wasm/src/lib.rs`, add two new `#[wasm_bindgen]` functions:
  - `pub fn migrate_document_json(json_str: &str) -> Result<String, JsValue>` — Parses JSON, runs migrations, returns migrated JSON string
  - `pub fn needs_migration_json(json_str: &str) -> bool` — Returns true if document needs migration
  - Import `compositor_runtime::migrations`
  - Handle errors with `map_err(|e| JsValue::from_str(&e.to_string()))`

  **Must NOT do**:
  - Don't add these as methods on `Engine` struct (they're stateless utilities)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential)
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `crates/compositor-wasm/src/lib.rs:1-30` — Existing WASM function patterns
  - `crates/compositor-wasm/src/lib.rs` — `to_js_error` helper pattern

  **Acceptance Criteria**:
  - [ ] `migrate_document_json` function exists with `#[wasm_bindgen]`
  - [ ] `needs_migration_json` function exists with `#[wasm_bindgen]`
  - [ ] `cargo check -p compositor-wasm` passes

  **QA Scenarios**:
  ```
  Scenario: WASM functions compile
    Tool: Bash (cargo)
    Preconditions: Functions added to lib.rs
    Steps:
      1. Run: cargo check -p compositor-wasm
      2. Verify exit code 0
    Expected Result: WASM crate compiles with new exports
    Evidence: .sisyphus/evidence/task-4-wasm-compiles.txt
  ```

  **Commit**: YES
  - Message: `feat(wasm): add migrate_document_json and needs_migration_json exports`
  - Files: `crates/compositor-wasm/src/lib.rs`

---

- [x] 5. Add EngineBridge migration methods

  **What to do**:
  - In `apps/web/src/engine/bridge.ts`, add to `EngineBridge` interface:
    - `migrateDocument?(jsonStr: string): string;`
    - `needsMigration?(jsonStr: string): boolean;`
  - In `apps/web/src/engine/wasmEngine.ts`, implement both methods:
    - Call the WASM functions `migrate_document_json` and `needs_migration_json`
  - In `apps/web/src/engine/tauriEngine.ts`, add stub implementations that return input unchanged / false
  - In `apps/web/src/engine/mockEngine.ts`, add stub implementations

  **Must NOT do**:
  - Don't implement actual Tauri IPC (can be added later)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 4)
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: Task 6
  - **Blocked By**: Task 4

  **References**:
  - `apps/web/src/engine/bridge.ts` — EngineBridge interface
  - `apps/web/src/engine/wasmEngine.ts` — WASM method call patterns

  **Acceptance Criteria**:
  - [ ] `EngineBridge` has optional `migrateDocument` and `needsMigration` methods
  - [ ] `WasmEngine` implements both methods
  - [ ] `TauriEngine` has stub implementations
  - [ ] `MockEngine` has stub implementations
  - [ ] `npx tsc -b --noEmit` passes

  **QA Scenarios**:
  ```
  Scenario: TypeScript compiles with new methods
    Tool: Bash (npx tsc)
    Preconditions: All engine files updated
    Steps:
      1. Run: cd apps/web && npx tsc -b --noEmit
      2. Verify exit code 0 (ignoring pre-existing errors)
    Expected Result: No new TypeScript errors from migration methods
    Evidence: .sisyphus/evidence/task-5-ts-check.txt
  ```

  **Commit**: YES (groups with 6)
  - Message: `feat(engine): add migration methods to EngineBridge`
  - Files: `apps/web/src/engine/bridge.ts`, `apps/web/src/engine/wasmEngine.ts`, `apps/web/src/engine/tauriEngine.ts`, `apps/web/src/engine/mockEngine.ts`

---

- [ ] 6. Integrate migration in loadProject

  **What to do**:
  - In `apps/web/src/store/graphStore.ts`, find the `loadProject` function
  - After `JSON.parse(text)`, before `extractGraphData`:
    - Check `eng.needsMigration?.(text)` 
    - If true, call `const migratedJson = eng.migrateDocument?.(text)`
    - Re-parse: `data = JSON.parse(migratedJson)`
    - Log: `console.info('[Migration] Project migrated to latest format')`
  - Ensure the rest of the flow uses the migrated `data`

  **Must NOT do**:
  - Don't show UI dialogs
  - Don't auto-save after migration (user must explicitly save)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential after 5)
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:
  - `apps/web/src/store/graphStore.ts:2521-2541` — `loadProject` function

  **Acceptance Criteria**:
  - [ ] `loadProject` calls `needsMigration` and `migrateDocument` when available
  - [ ] Migration happens before `extractGraphData` call
  - [ ] Console log indicates migration occurred
  - [ ] `npx tsc -b --noEmit` passes

  **QA Scenarios**:
  ```
  Scenario: loadProject includes migration logic
    Tool: Bash (grep)
    Preconditions: graphStore.ts updated
    Steps:
      1. Run: grep -A5 "needsMigration" apps/web/src/store/graphStore.ts
      2. Verify migration logic is present in loadProject
    Expected Result: Migration check and call visible in output
    Evidence: .sisyphus/evidence/task-6-loadproject-migration.txt
  ```

  **Commit**: YES (groups with 5)
  - Message: `feat(store): integrate document migration in loadProject`
  - Files: `apps/web/src/store/graphStore.ts`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 3 review tasks run in PARALLEL. ALL must APPROVE.

- [ ] F1. **Run cargo test for migrations** — `quick`
  Run `cargo test -p compositor-runtime migrate`. Verify all migration unit tests pass. Check that version comparison, migration chain, and Viewer port rename all work.
  Output: `Tests [N pass/N fail] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Run cargo clippy** — `quick`
  Run `cargo clippy --workspace -- -D warnings`. Verify no new warnings from migration code.
  Output: `Clippy [PASS/FAIL] | VERDICT`

- [ ] F3. **Run frontend typecheck** — `quick`
  Run `cd apps/web && npx tsc -b --noEmit`. Verify no new TypeScript errors (pre-existing errors are OK).
  Output: `TypeScript [PASS/FAIL with N errors] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(runtime): add document migration system with v1.0.0→v1.1.0 viewer port migration`
  - Files: migrations/mod.rs, migrations/v1_0_0_to_v1_1_0.rs, lib.rs, document.rs
- **Wave 2**: `feat(wasm): add migrate_document_json and needs_migration_json exports`
  - Files: compositor-wasm/src/lib.rs
- **Wave 3**: `feat: integrate document migration in project loading`
  - Files: bridge.ts, wasmEngine.ts, tauriEngine.ts, mockEngine.ts, graphStore.ts

---

## Success Criteria

### Verification Commands
```bash
# Rust tests
cargo test -p compositor-runtime migrate  # Expected: all tests pass

# Rust lint
cargo clippy --workspace -- -D warnings  # Expected: no new warnings

# TypeScript
cd apps/web && npx tsc -b --noEmit  # Expected: no new errors

# WASM build (optional full check)
cargo check -p compositor-wasm  # Expected: compiles
```

### Final Checklist
- [ ] All migration unit tests pass
- [ ] v1.0.0 document with Viewer connection loads correctly
- [ ] Saved document has format_version "1.1.0"
- [ ] Future version document shows error message
- [ ] Console logs migration when applied
- [ ] No UI prompts during migration
