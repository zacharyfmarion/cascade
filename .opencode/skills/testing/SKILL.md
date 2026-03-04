---
name: testing
description: Comprehensive guide to all testing layers, conventions, and commands in the Compositor repository. Use when writing, running, or debugging tests.
---

## Overview

| Layer | Framework | Location | Command |
|-------|-----------|----------|---------|
| Rust unit tests | `#[cfg(test)]` | Inline in each crate | `cargo test --workspace` |
| Rust integration tests | `#[test]` | `crates/compositor-core/tests/` | `cargo test --workspace` |
| Rust benchmarks | Criterion | `crates/compositor-nodes-std/benches/` | `cargo bench --package compositor-nodes-std` |
| Frontend unit/contract tests | Vitest | `apps/web/src/__tests__/` | `cd apps/web && npx vitest run` |
| Frontend E2E tests | Playwright | `apps/web/e2e/` | `cd apps/web && npx playwright test` |

## Rust unit tests

Inline `#[cfg(test)]` modules in each crate source file. Every node implementation in `compositor-nodes-std` should have associated unit tests.

```bash
cargo test --workspace                           # Run all
cargo test -p compositor-core                    # Single crate
cargo test -p compositor-nodes-std -- blur       # Filter by name
```

### Key conventions

- Tests live alongside the code they test, inside `#[cfg(test)] mod tests { ... }`.
- Image constructors return `Result` — use `?` in tests (annotate with `-> Result<(), CompositorError>`).
- GPU tests must gracefully skip when `GpuContext::new()` fails (no GPU in CI). Use a guard like `let Some(gpu) = GpuContext::new() else { return; };`.
- Never use `unwrap()` in test setup for image construction — propagate errors.

### What to test for new nodes

1. Output correctness (e.g., identity passthrough, known mathematical result)
2. Edge cases (zero-size image, single pixel, max dimensions)
3. Parameter boundary values
4. Error conditions (invalid inputs should return `CompositorError`, not panic)

## Rust integration tests

Full pipeline tests that create an engine, add nodes, connect them, and evaluate.

```
crates/compositor-core/tests/basic.rs
```

These test the graph→evaluator→node pipeline end to end. Add integration tests when:
- A new node type interacts with the evaluator in non-obvious ways
- Graph topology handling changes (cycles, disconnections, dirty propagation)
- Caching behavior needs verification

## Rust benchmarks

Criterion benchmarks for performance-critical node operations.

```
crates/compositor-nodes-std/benches/node_benchmarks.rs
```

```bash
cargo bench --package compositor-nodes-std       # Run all benchmarks
cargo bench --package compositor-nodes-std -- blur  # Single benchmark
```

Existing benchmarks cover: blur, blend, brightness/contrast, invert, resize, alpha_over, sRGB conversion. Add benchmarks for any new image processing operation that processes pixels.

## Frontend unit and contract tests (Vitest)

Unit tests and behavioral contract tests for the Zustand store and other frontend modules.

### Configuration

- Config: `apps/web/vitest.config.ts`
- Setup: `apps/web/src/__tests__/setup.ts`
- Globals enabled (`describe`, `it`, `expect`, `vi` available without import)

### Test files

| File | Purpose |
|------|---------|
| `graphStore.test.ts` | Unit tests for store actions |
| `graphStore.contracts.test.ts` | **Behavioral contract tests** — cross-cutting invariants that must survive refactors |
| `engineMock.ts` | Mock `EngineBridge` implementation with render tracking |
| `layoutStore.test.ts` | Layout store tests |
| `settingsStore.test.ts` | Settings store tests |
| `themeStore.test.ts` | Theme store tests |
| `types.test.ts` | Type utility tests |

### Mock engine

`engineMock.ts` provides a `createMockEngine()` that implements `EngineBridge` with:
- In-memory node/connection tracking
- Render call counting and result generation
- Configurable param storage

Use this for testing store logic without WASM compilation:

```typescript
import { createMockEngine } from './engineMock';

const engine = createMockEngine();
// inject into store, call store actions, assert state
```

### Contract tests

Contract tests (`graphStore.contracts.test.ts`) verify behavioral invariants that must hold across refactors — especially the upcoming store split. They test cross-cutting concerns like:

- `setParam` → viewer re-render (graph mutations trigger rendering)
- `setParamLive` + `setParamCommit` → undo history (live edits don't pollute undo stack)
- `undo` / `redo` → correct state restoration
- `removeNode` → viewer cleanup and re-render
- `toggleMuteSelected` → selective render invalidation
- `newProject` → full state reset (undo stacks, frame, selection)

**When to add contract tests**: Any time you add or modify a store action that crosses domain boundaries (e.g., a graph mutation that affects rendering, an undo that restores selection state).

### Running

```bash
cd apps/web
npx vitest run                          # Run all once
npx vitest run graphStore.contracts     # Filter by name
npx vitest --watch                      # Watch mode
```

## Frontend E2E tests (Playwright)

End-to-end tests that run against the real WASM engine in a browser. These verify the full stack: React UI → Zustand store → WASM engine → render results.

### Configuration

- Config: `apps/web/playwright.config.ts`
- Test directory: `apps/web/e2e/`
- Browser: Chromium only
- Dev server: started automatically via `yarn dev` on port 5173
- CI settings: single worker, 2 retries, GitHub reporter

### Test harness

The test harness (`apps/web/src/testing/testHarness.ts`) is installed on `window.__compositorTest` and provides programmatic access to store actions without UI interaction:

```typescript
// In a Playwright test:
const nodeId = await harness(page, 'addNode', 'solid_color');
await harness(page, 'connect', fromId, 'field', toId, 'image');
await harness(page, 'setParam', nodeId, 'brightness', { Float: 0.5 });
const state = await harness(page, 'getState');
const result = await harness(page, 'getViewerResult', viewerId);
```

The shared `harness()` helper and `waitForApp()` are in `apps/web/e2e/helpers.ts`.

### Spec files

| File | Tests | Coverage |
|------|-------|----------|
| `integration.spec.ts` | 6 | Engine init, basic graph creation, undo through engine |
| `rendering.spec.ts` | 10 | Multi-node chains, selective invalidation, transactions |
| `mutations.spec.ts` | 11 | Undo/redo, node removal, input defaults |
| `state.spec.ts` | 15 | Selection, mute, playback, dirty flag, lifecycle |
| `advanced.spec.ts` | 8 | Complex topologies, error recovery, multi-viewer |
| `groups.spec.ts` | 5 | createGroup, enterGroup, exitGroup, undo, viewer preservation |
| `project.spec.ts` | 5 | Save/load roundtrip, connection/param preservation, dirty flag |
| `playback.spec.ts` | 5 | togglePlayback, frame advancement, setFps, setLoopPlayback |
| `export-viewer.spec.ts` | 5 | exportImage, param persistence, topology changes, editTransaction |

### Key conventions

- **Port names matter**: `solid_color` outputs on `'field'`, `brightness_contrast` uses `'image'`/`'image'`, `viewer` input is `'value'`, `invert` uses `'image'`/`'image'`, `export_image` uses `'image'`/`'display'`.
- **Param values must be wrapped**: `{ Float: 0.5 }`, never bare `0.5`.
- **WASM blocks the main thread**: During active playback with a connected viewer, `page.evaluate()` calls will hang because WASM rendering occupies the main thread. Test playback state transitions without a connected viewer, or stop playback before reading state.
- **Tests should be parallelizable**: Each spec file gets its own browser context. Don't share state between spec files.

### Adding a new E2E test

1. Choose the appropriate spec file based on what you're testing, or create a new one
2. Use the shared `waitForApp()` and `harness()` helpers from `./helpers`
3. Build the minimal graph needed for your test case
4. Assert on `getState()` for state checks and `getViewerResult()` for render checks
5. Use `waitForRenderIdle` after mutations that trigger async renders

### Running

```bash
cd apps/web
npx playwright test                              # Run all
npx playwright test rendering.spec.ts            # Single file
npx playwright test --grep "selective"           # Filter by name
npx playwright test --debug                      # Debug mode with inspector
npx playwright test --reporter=list              # Verbose output
```

### When to add E2E tests

- New store actions that interact with the WASM engine
- Changes to the engine bridge (wasmEngine.ts, tauriEngine.ts)
- Cross-cutting behaviors where store state and engine state must stay in sync
- Rendering pipeline changes (viewer invalidation, caching, render results)

## CI

GitHub Actions runs all tests on push to `main` and PRs:

| Job | What it runs |
|-----|-------------|
| Check (all crates) | `cargo check --workspace` |
| Run tests | `cargo test --workspace` |
| Lint (clippy + fmt) | `cargo clippy -- -D warnings` + `cargo fmt --check` |
| Benchmark compile check | `cargo bench --no-run` |
| Frontend Lint & Typecheck | `npx tsc -b --noEmit` + `yarn lint` |
| E2E Tests (Playwright) | Builds WASM, installs Chromium, runs all Playwright specs |

Crates requiring system libraries (`compositor-ocio-sys`, `compositor-ocio`, `compositor-tauri`) are excluded from CI workspace commands since their dependencies (glib, OpenColorIO, webkit2gtk) aren't available on the runner.
