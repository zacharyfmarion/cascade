# Worker Sync/Async Split Plan

## Problem

With the engine in a Web Worker, every engine call goes through `postMessage` and returns a Promise. But some engine methods are called **synchronously from tight UI loops** and cannot tolerate async latency:

- `typesCompatible(from, to)` — called in `Array.find()` during drag interactions (NodeCanvas.tsx)
- `validateEdits(edits)` — called synchronously before applying edit transactions

Both sites in `renderSlice.ts` already guard against async returns and **throw** if the result is a Promise.

## Approach: Thin WASM on Main Thread + Heavy Engine in Worker

Load the WASM module on **both** threads, but only create the `Engine` singleton in the Worker. The main thread imports only the standalone WASM functions it needs for synchronous operations. No logic duplication in TypeScript — the single source of truth stays in Rust.

```
Main Thread                              Worker Thread
┌──────────────────────┐                 ┌──────────────────────┐
│ WASM module (shared) │                 │ WASM module          │
│  - types_compatible  │ (standalone)    │  - Engine singleton  │
│  - needs_migration   │ (standalone)    │  - All 80+ methods   │
│  - migrate_document  │ (standalone)    │  - EngineScheduler   │
│  - validate_edits?   │ (needs Engine)  │                      │
│                      │                 │                      │
│ WorkerEngine         │◄── postMsg ───►│ Comlink.expose()     │
│  (EngineBridge)      │                 │                      │
│ React + Canvas       │                 │                      │
└──────────────────────┘                 └──────────────────────┘
```

## Method Classification

### Tier 1: MUST be synchronous (main-thread WASM)

These are called in tight synchronous loops where async would break the UI:

| Method | Why Sync | Current State | Solution |
|--------|----------|---------------|----------|
| `typesCompatible(from, to)` | Called in Array.find during drag | Engine method, pure logic | **Expose as standalone WASM fn** — the underlying `cascade_core::graph::types_compatible` is already a free function |
| `needsMigration(json)` | Called before project load, blocking | Already standalone WASM fn | **Call on main thread** (already exported) |
| `migrateDocument(json)` | Called before project load, blocking | Already standalone WASM fn | **Call on main thread** (already exported) |

### Tier 2: Desirable sync, but can tolerate async

| Method | Current Usage | Solution |
|--------|---------------|----------|
| `validateEdits(edits)` | Sync guard in renderSlice | **Needs Engine state** (graph structure) — cannot be standalone. Options: (a) cache the graph schema on main thread, (b) make call sites async-tolerant, (c) keep the JS fallback. **Recommend (c)** — the JS fallback already exists and validation is a UI convenience, not correctness. |
| `getAffectedViewers(nodeId)` | Called after param changes | Already async-tolerant (fire-and-forget render trigger). **Keep async via Worker.** |
| `getNodeExecutionState(nodeId)` | AI node status polling | Already made async in earlier fix. **Keep async via Worker.** |
| `getLastRenderTimings()` | Post-render perf display | Already made async in earlier fix. **Keep async via Worker.** |

### Tier 3: Async via Worker (everything else)

All remaining 75+ methods (addNode, removeNode, renderViewer, loadImageData, etc.) are already async-compatible and go through the Worker via Comlink.

## Implementation

### Step 1: Export `types_compatible` as standalone WASM function

In `crates/cascade-wasm/src/lib.rs`, add a new standalone `#[wasm_bindgen]` function that delegates to `cascade_core::graph::types_compatible`:

```rust
#[wasm_bindgen(js_name = "types_compatible")]
pub fn types_compatible_standalone(from_type: &str, to_type: &str) -> bool {
    cascade_core::graph::types_compatible(
        &from_type.parse().unwrap_or(ValueType::Any),
        &to_type.parse().unwrap_or(ValueType::Any),
    )
}
```

This lets the main thread call it synchronously without the Engine.

### Step 2: WorkerEngine loads main-thread WASM for sync ops

In `workerEngine.ts`, during `init()`:
1. Import `init` and the standalone functions from `wasm-pkg`
2. Call `await init()` to load the WASM module on the main thread
3. Store references to `types_compatible`, `needs_migration_json`, `migrate_document_json`

Note: calling `init()` twice (main + Worker) is fine — wasm-bindgen caches the instantiation. Both threads get their own WASM memory, but for pure functions this is irrelevant.

```typescript
import wasmInit, {
  types_compatible as wasmTypesCompatible,
  needs_migration_json,
  migrate_document_json,
} from '../wasm-pkg/cascade_wasm';

class WorkerEngine implements EngineBridge {
  private wasmReady = false;

  async init() {
    // Load WASM on main thread for sync functions
    await wasmInit();
    this.wasmReady = true;

    // Create Worker for heavy engine operations
    this.worker = new Worker(...);
    await this.getAPI().init();
  }

  // Synchronous — runs on main thread via WASM
  typesCompatible(from: string, to: string): boolean {
    return wasmTypesCompatible(from, to);
  }

  // Synchronous — runs on main thread via WASM
  needsMigration(jsonStr: string): boolean {
    return needs_migration_json(jsonStr);
  }

  // Synchronous — runs on main thread via WASM
  migrateDocument(jsonStr: string): string {
    return migrate_document_json(jsonStr);
  }

  // Everything else → Worker via Comlink
  renderViewer(...) { return this.getAPI().renderViewer(...); }
}
```

### Step 3: Revert projectSlice.ts migration to sync

Now that `needsMigration` and `migrateDocument` are synchronous again on the WorkerEngine, revert the `await Promise.resolve()` wrapping in `projectSlice.ts` back to direct synchronous calls.

### Step 4: validateEdits — keep JS fallback

`validateEdits` needs Engine state (the graph), so it can't be standalone WASM. The existing JS fallback in `renderSlice.ts:225-230` already handles this case — if the method returns a Promise, it returns `[]` (no errors). This is acceptable because:
- Edit validation is a UI convenience (prevent obviously wrong edits)
- The engine will reject invalid edits anyway when they're applied via Worker
- The fallback has been working for TauriEngine (also async) without issues

No change needed here.

## Files Changed

| File | Change |
|------|--------|
| `crates/cascade-wasm/src/lib.rs` | Add standalone `types_compatible` WASM fn |
| `apps/web/src/engine/workerEngine.ts` | Load main-thread WASM, implement sync `typesCompatible`/`needsMigration`/`migrateDocument` |
| `apps/web/src/store/graphStore/slices/projectSlice.ts` | Revert migration calls to sync (no more `await Promise.resolve`) |
| `apps/web/src/engine/bridge.ts` | Revert `needsMigration`/`migrateDocument` return types to sync-only |

## What Does NOT Change

- engineWorker.ts — Worker-side is unchanged
- kernel.ts — createEngine flow unchanged
- wasmEngine.ts — main-thread fallback unchanged
- All other store slices — unchanged
- Rust crates — only lib.rs gets one new export

## Testing

- E2E: All 110+ tests pass
- Manual: drag nodes to connect → type compatibility highlighting works
- Manual: load old `.casc` file → migration works
- Unit: `types_compatible` standalone fn returns same results as Engine method

## Memory Impact

Loading WASM on main thread adds ~2.5MB to main-thread memory. This is the binary itself — no Engine instance, no graph, no image data. Acceptable tradeoff for synchronous type checking and migration.
