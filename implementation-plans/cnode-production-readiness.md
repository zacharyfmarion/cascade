# .cnode Production Readiness

## Goal

Make `.cnode` the only custom-node package format and harden import/export so shared custom nodes fail clearly, migrate predictably, and never partially mutate engine state.

## Approach

- Replace all public `.cnode` references with `.cnode` and reject legacy numeric package versions.
- Move package parsing, migration, validation, sanitization, dependency ordering, and remapping into a shared runtime module used by native and WASM import/export paths.
- Validate full packages before committing registry/group-definition changes.
- Add Rust and frontend coverage for valid packages, malformed packages, migration behavior, transactional rollback, and extension/UI behavior.

## Affected Areas

- `crates/cascade-core/src/group.rs`
- `crates/cascade-runtime/src/`
- `crates/cascade-wasm/src/lib.rs`
- `apps/tauri/src-tauri/src/lib.rs`
- `apps/web/src/`
- `implementation-plans/`

## Checklist

- [x] Create implementation branch and durable plan
- [x] Remove old custom-node extension references and switch public UI to `.cnode`
- [x] Add shared cnode package module
- [x] Route runtime and WASM import/export through shared logic
- [x] Add transactional validation and structured errors
- [x] Add Rust and frontend tests
- [x] Run required validation
- [ ] Open draft PR against `main`
