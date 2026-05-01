# DSL Semantic Equivalence Tests

## Goal

Add fixture-backed tests that compare representative Cascade graphs loaded through the existing graph runtime path and through the DSL editor path.

## Approach

Create frontend test fixtures with paired runtime graph data and DSL text. For each fixture, load the runtime graph through store/engine APIs, load the DSL through `applyDsl()`, then compare canonical graph structure and viewer outputs. Keep assertion failures labeled by phase so parser, serialization, and runtime mismatches are easy to distinguish.

## Affected Areas

- `apps/web/src/ai/dsl/__tests__/`
- `apps/web/src/ai/dsl/__tests__/fixtures/`
- `apps/web/src/__tests__/engineMock.ts` if the test harness needs narrow runtime import/export support

## Checklist

- [x] Add semantic equivalence fixtures for node groups, typed connections, and parameter coercion.
- [x] Add a DSL/runtime equivalence test harness with phase-labeled failures.
- [x] Run focused frontend tests.
- [x] Run relevant frontend validation.

## Validation Notes

- `yarn test src/ai/dsl/__tests__/semanticEquivalence.test.ts` passes.
- `yarn lint` passes.
- `npx tsc -b --noEmit` passes after regenerating `src/wasm-pkg` and `src/wasm-pkg-threads` with `yarn build:wasm`.
- Full `yarn test` currently reports 603 passing tests and 2 failures in `src/__tests__/batchExportSlice.test.ts` Tauri dialog expectations; that file passes when run in isolation.
