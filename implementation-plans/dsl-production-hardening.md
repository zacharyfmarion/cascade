# DSL Production Hardening

## Goal

Take the Cascade DSL editor from a capable prototype to a production-ready authoring surface. The graph remains the semantic source of truth, but the DSL layer should have a robust parser, intentional source preservation, stable identity, reliable diagnostics, and end-to-end coverage for the flows users will depend on.

## Approach

Build this as a series of commit-sized hardening steps. Each step should add or update tests, run the relevant validation, update this checklist, and be committed before moving on.

1. Replace the custom regex parser with a Chevrotain-based parser/lexer that produces the existing DSL AST plus reliable diagnostics and source ranges.
2. Make comments/trivia and source ranges first-class enough for formatting, diagnostics, and shadow-document reconciliation to preserve user text intentionally.
3. Harden shadow reconciliation so non-DSL graph edits patch known semantic regions when safe and regenerate only when ranges or identities are unsafe.
4. Harden custom node identity for GPU scripts and groups across rename, duplicate names, nested definitions, delete/recreate, save/load, and AI tool edits.
5. Add component and Playwright coverage for the visible DSL editor flows on top of the existing parser/executor unit coverage.
6. Make WASM rebuilds deterministic by cleaning generated output directories before `wasm-pack`, so optimized rebuilds cannot trip on stale package metadata.
7. Run the full frontend validation suite and document any pre-existing order-sensitive failures separately from DSL failures.

## Affected Areas

- `apps/web/src/ai/dsl/*`: lexer/parser, source map, formatter, validator, serializer, differ, executor, shadow reconciliation.
- `apps/web/src/components/DslEditor.tsx`: diagnostics, format/apply behavior, stale shadow display.
- `apps/web/src/store/graphStore/*`: shadow document updates, group/GPU identity metadata, save/load hydration.
- `apps/web/src/ai/tools.ts`: AI syntax and validation path parity with the editor.
- `apps/web/src/**/__tests__/*` and Playwright specs: parser, shadow, executor, component, and e2e coverage.
- `apps/web/package.json` and `yarn.lock`: parser dependency.

## Checklist

- [x] Create this production-hardening implementation plan.
- [x] Add Chevrotain as the parser dependency and introduce a token vocabulary for the Cascade DSL.
- [x] Replace `parseDsl()` internals with a Chevrotain parser that preserves the current AST contract.
- [x] Add parser diagnostics for incomplete live-edit states, unknown syntax, unclosed blocks, malformed params, and multiline strings/code.
- [x] Add parser golden tests for comments, custom definitions, assets, arrays, refs, wrappers, arrows, duplicate handles, and partial invalid documents.
- [x] Add first-class comment/trivia capture to source maps where it matters for formatting and reconciliation.
- [x] Update formatting/reconciliation to preserve comments and untouched user formatting in safe graph-edit cases.
- [x] Add shadow reconciliation tests for node param edits, node insert/delete, connection insert/delete, group rename, GPU script edits, and unsafe fallback.
- [x] Harden custom node identity for duplicate names, nested group renames, delete/recreate, multiple instances, imported group packages, and GPU script instance edits.
- [x] Add `DslEditor` component tests for diagnostics, format, apply/revert, stale shadow text, and external graph changes.
- [x] Add Playwright e2e coverage for root DSL edits, group title <-> DSL sync, GPU script edits, save/load preservation, and invalid DSL recovery.
- [x] Clean WASM output directories before single-threaded and multi-threaded `wasm-pack` builds.
- [x] Run `yarn test`, `yarn lint`, `yarn lint:css`, `npx tsc -b --noEmit`, and relevant Playwright specs.
- [x] Commit each completed step after its tests pass.

## Validation Notes

- Frontend-only changes should use the web validation commands from `AGENTS.md`.
- Rust/Tauri validation is only required if this phase touches Rust crates or Tauri code.
- Full `yarn test` now passes: 32 files, 563 tests.
- Rust validation now passes with `cargo test --workspace`, `cargo clippy --workspace -- -D warnings`, and `cargo fmt --all -- --check`.
- Focused browser validation passes with `yarn exec playwright test e2e/dsl-editor.spec.ts --project=chromium --reporter=line`.
- Optimized single-threaded WASM build passes via `yarn build:wasm:st`.
- Optimized multi-threaded WASM build passes via `yarn build:wasm:mt`; Rust warns that the `atomics` target feature is unstable, which is expected for the nightly threaded build path.
