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
6. Run the full frontend validation suite and document any pre-existing order-sensitive failures separately from DSL failures.

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
- [ ] Add parser golden tests for comments, custom definitions, assets, arrays, refs, wrappers, arrows, duplicate handles, and partial invalid documents.
- [ ] Add first-class comment/trivia capture to source maps where it matters for formatting and reconciliation.
- [ ] Update formatting/reconciliation to preserve comments and untouched user formatting in safe graph-edit cases.
- [ ] Add shadow reconciliation tests for node param edits, node insert/delete, connection insert/delete, group rename, GPU script edits, and unsafe fallback.
- [ ] Harden custom node identity for duplicate names, nested group renames, delete/recreate, multiple instances, imported group packages, and GPU script instance edits.
- [ ] Add `DslEditor` component tests for diagnostics, format, apply/revert, stale shadow text, and external graph changes.
- [ ] Add Playwright e2e coverage for root DSL edits, group title <-> DSL sync, GPU script edits, save/load preservation, and invalid DSL recovery.
- [ ] Run `yarn test`, `yarn lint`, `yarn lint:css`, `npx tsc -b --noEmit`, and relevant Playwright specs.
- [ ] Commit each completed step after its tests pass.

## Validation Notes

- Frontend-only changes should use the web validation commands from `AGENTS.md`.
- Rust/Tauri validation is only required if this phase touches Rust crates or Tauri code.
- The current full `yarn test` run has shown order-sensitive `batchExportSlice` Tauri dialog failures while the file passes in isolation; this should be tracked separately if it persists after DSL work.
