# Error Handling Plan

Comprehensive strategy for error handling across the Cascade stack: Rust core → WASM/Tauri bridge → React frontend → user-facing UI.

Based on the [architecture review](./architecture-review-2-22-26.md) and error flow audit (Feb 23 2026).

---

## Problem Statement

When a node's `evaluate()` returns `Err`, the user sees **nothing**. The viewer freezes or goes blank with zero indication anything went wrong. Errors are silently swallowed at three independent layers:

1. **WASM bridge**: 7 sites use `unwrap_or(JsValue::NULL)` — error becomes null
2. **WasmEngine (TypeScript)**: `renderViewer()` catches all exceptions and returns null
3. **graphStore**: `try { renderViewer(...) } catch { /* EMPTY */ }` — swallowed again

Infrastructure for error display exists (`lastError` state + Viewer.tsx red bar) but is never wired to evaluation failures.

---

## 1. Error Taxonomy

### Severity (drives what the user sees)

| Severity | User sees | Examples |
|----------|-----------|----------|
| `error` | Viewer bar + node badge | Evaluation failure, invalid connection, failed image load, export failure |
| `warning` | Subtle indicator (non-blocking) | Degraded resolution, missing optional resource, fallback behavior |
| `info` | Nothing (console only) | Cache miss, timing metrics, optional debug serialization |
| `fatal` | Generic crash message + console details | WASM panic, bridge serialization invariant broken |

### Domain (where it came from)

| Domain | Covers |
|--------|--------|
| `graph` | CycleDetected, InvalidConnection, TypeMismatch, PortNotFound, NodeNotFound |
| `eval` | Node compute failed, InvalidImageData, runtime evaluation errors |
| `io` | Load/save failures, ImageTooLarge, decode errors, export failures |
| `runtime` | WASM/Tauri IPC issues, serialization failures |
| `internal` | Panics, invariant violations (should never reach user) |

### Scope (where to display it)

| Scope | Display location | When |
|-------|-----------------|------|
| `global` | Viewer error bar | Root-cause error blocking the viewer output |
| `node { nodeId }` | Badge on the failing node | The specific node whose evaluate() failed |
| `derived { blockedByNodeId }` | "Blocked" state on downstream nodes | Nodes that can't evaluate because an upstream failed |

### What's user-visible vs developer-only

- **User-visible**: `severity = warning | error` with a safe `message` (no stack traces, no internal strings)
- **Developer-only**: `debug` field with Rust variant name, JS exception string, backtrace — logged to console, never shown in production UI

---

## 2. Error Architecture

### 2.1 Rust: Wrap evaluation errors with node context

The evaluator should wrap `CascadeError` with the node that caused it:

```rust
// In cascade-core/src/eval.rs, around the evaluate() call
struct EvalError {
    node_id: NodeId,
    node_type: String,
    source: CascadeError,
}
```

This lets the frontend attribute errors to specific nodes instead of showing only a generic global message.

### 2.2 WASM bridge: Eliminate all error swallowing

**Rule: Every function returns `Result<_, JsValue>` and uses `map_err(to_engine_error)?`.**

Replace all 7 `unwrap_or(JsValue::NULL)` sites and 2 `.expect()` panics:

| Line | Current | Fix |
|------|---------|-----|
| 164 | `.expect("GPU node")` | `.map_err(to_engine_error)?` |
| 187 | `unwrap_or(JsValue::NULL)` (list_node_types) | `.map_err(to_engine_error)?` |
| 205 | `unwrap_or(JsValue::NULL)` (add_node) | `.map_err(to_engine_error)?` |
| 507 | `unwrap_or(JsValue::NULL)` (get_last_render_timings) | `.map_err(to_engine_error)?` |
| 525 | `unwrap_or(JsValue::NULL)` (get_color_management_info) | `.map_err(to_engine_error)?` |
| 530 | `unwrap_or(JsValue::NULL)` (get_views_for_display) | `.map_err(to_engine_error)?` |
| 571 | `unwrap_or(JsValue::NULL)` (get_render_dimensions) | `.map_err(to_engine_error)?` |
| 619 | `unwrap_or(JsValue::NULL)` (export_graph) | `.map_err(to_engine_error)?` — **CRITICAL: can lose project data** |

The bridge should serialize errors as structured JS objects:

```rust
fn to_engine_error(e: impl std::fmt::Display) -> JsValue {
    // Returns { code: string, message: string, domain: string, ... }
    serde_wasm_bindgen::to_value(&EngineErrorDto::from(e))
        .unwrap_or_else(|_| JsValue::from_str(&e.to_string()))
}
```

### 2.3 Frontend: Structured EngineError type

```typescript
type EngineError = {
  code: string;        // Stable, machine-readable (e.g., "EVAL_FAILED", "CYCLE_DETECTED")
  message: string;     // User-facing description
  severity: 'info' | 'warning' | 'error' | 'fatal';
  domain: 'graph' | 'eval' | 'io' | 'runtime' | 'internal';
  scope:
    | { type: 'global' }
    | { type: 'node'; nodeId: string; port?: string }
    | { type: 'derived'; blockedByNodeId: string };
  transient?: boolean;    // e.g., during live parameter drag
  cause?: EngineError;    // Optional root-cause chain
  debug?: { raw?: unknown }; // Developer-only, logged to console
};
```

### 2.4 EngineBridge: One rule — methods throw EngineError

- **No more `null` sentinels for errors.** Reserve `null`/`undefined` for "no data" success cases only.
- `renderViewer()` returns `Promise<RenderResult>` and throws `EngineError` on failure
- Both `WasmEngine` and `TauriEngine` normalize their thrown values into `EngineError`
- Bridge implementations parse WASM `JsValue` errors and Tauri `invoke()` errors into the same `EngineError` shape

### 2.5 Store: Single catch point, always stores error

```typescript
// graphStore.ts — the ONLY place that catches engine exceptions
try {
  const result = await engine.renderViewer(...);
  set({ lastError: null, renderResults: { ...prev, [viewerKey]: result } });
} catch (e) {
  const error = parseEngineError(e);
  set({ lastError: error });
  if (error.scope.type === 'node') {
    set({ nodeErrors: { ...prev.nodeErrors, [error.scope.nodeId]: error } });
  }
}
```

**Never leave `catch {}` empty. Never `catch { return null }`.**

---

## 3. Error UX

### 3.1 Global viewer bar (existing, needs wiring)

- Shows the root-cause `EngineError.message` for `severity = error | fatal`
- Persistent until a successful render clears it
- Already exists in `Viewer.tsx` lines 283-297 — just needs to be fed render errors

### 3.2 Per-node error badges (new)

- Red badge/icon on nodes where `scope = node`
- Tooltip shows the error message
- Downstream nodes show "Blocked by upstream error" state (muted/dimmed, not red) to prevent cascading noise

### 3.3 Live parameter dragging

- During live drag (high-frequency param changes), throttle error UI updates to ~5-10Hz
- Only update when `(code, scope, message)` changes — avoid flicker
- Delay clearing by ~250ms to prevent "flash on recovery"
- Mark these errors `transient: true` so the UI can treat them differently

### 3.4 Error chains

When node A fails and downstream nodes B, C, D also fail:
- Only node A gets a red error badge with the real error message
- B, C, D get a "Blocked" visual state (gray/muted) indicating they couldn't evaluate because of upstream failure
- The viewer bar shows node A's error (the root cause), not "4 nodes failed"

### 3.5 Operational errors (existing behavior, keep as-is)

- Export failures, unsupported features, etc. continue using the current pattern
- These are already `severity = error, scope = global` effectively

---

## 4. Enforcement Strategy

### 4.1 Rust: Clippy lints for cascade-wasm

Add to `crates/cascade-wasm/Cargo.toml` or a crate-level attribute:

```rust
// In crates/cascade-wasm/src/lib.rs (top of file)
#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]
#![deny(clippy::panic)]
```

This makes it a compile error to use `unwrap()`, `expect()`, or `panic!()` in the WASM bridge. Tests are exempt (`#[cfg(test)]` modules can `#[allow(...)]`).

Consider expanding to all library crates over time (cascade-core, cascade-nodes-std, cascade-gpu).

### 4.2 TypeScript: ESLint rules

Add to `apps/web/eslint.config.js`:

```javascript
// Disallow empty catch blocks
'no-empty': ['error', { allowEmptyCatch: false }],

// Disallow catch blocks that only have comments
'@typescript-eslint/no-empty-function': 'error',
```

Consider adding a custom `no-restricted-syntax` rule or a targeted grep-based CI check for patterns like:
- `catch {}` 
- `catch (e) {}` (empty body)
- `catch { return null }` (swallow-and-null pattern)

### 4.3 CI checks

Add a CI step that greps for known swallowing patterns:

```yaml
- name: Check for error swallowing patterns
  run: |
    # WASM bridge: no unwrap_or(JsValue::NULL) except explicitly annotated
    ! grep -n 'unwrap_or(JsValue::NULL)' crates/cascade-wasm/src/lib.rs || exit 1
    
    # WASM bridge: no bare .expect() or .unwrap() in non-test code
    # (Clippy deny handles this, but belt-and-suspenders)
    
    # Frontend: no empty catch blocks
    ! grep -Pn 'catch\s*(\([^)]*\))?\s*\{\s*\}' apps/web/src/**/*.ts apps/web/src/**/*.tsx || exit 1
```

### 4.4 AGENTS.md rules

Add to the AGENTS.md file (see section 6 for exact text):

1. Error propagation rule: Engine/render/eval errors must propagate as `EngineError` through the full stack. Never convert errors to `null`, `JsValue::NULL`, or empty catch blocks.
2. Store-only catching rule: Only the Zustand store catches engine exceptions. Components/hooks must not swallow errors from engine calls.
3. WASM bridge rule: All WASM bridge functions must return `Result<_, JsValue>` and propagate errors via `map_err(to_engine_error)?`. No `unwrap_or(JsValue::NULL)`.

---

## 5. Migration Plan

### Phase A: MVP — Stop swallowing errors (1-4 hours)

The smallest change that makes errors visible to users. No new types, no per-node attribution yet.

1. **WASM bridge** (`crates/cascade-wasm/src/lib.rs`):
   - Replace all 7 `unwrap_or(JsValue::NULL)` with `.map_err(to_js_error)?`
   - Replace 2 `.expect()` calls with `.map_err(to_js_error)?`
   - All functions already return `Result<_, JsValue>`, so this is mostly mechanical

2. **WasmEngine** (`apps/web/src/engine/wasmEngine.ts`):
   - `renderViewer()`: Remove the outer try-catch that returns null. Let errors propagate.

3. **graphStore** (`apps/web/src/store/graphStore.ts`):
   - Main render path: Replace `catch { /* empty */ }` with `catch (e) { set({ lastError: String(e) }) }`
   - This wires render failures into the existing `lastError` → Viewer.tsx red bar

**Result**: Evaluation errors now show as text in the viewer's red error bar. Not pretty, not structured, but visible.

### Phase B: Structured errors (1-2 days)

Add proper typing and the EngineError contract.

1. **Define `EngineError` type** in `apps/web/src/engine/types.ts`
2. **Define `EngineErrorDto`** in Rust (serde-serializable struct with code, message, severity, domain)
3. **Update `to_js_error`** in WASM bridge to serialize `EngineErrorDto` instead of bare strings
4. **Add `parseEngineError()`** utility in frontend that normalizes WASM JsValue / Tauri thrown values into `EngineError`
5. **Update `EngineBridge` interface**: `renderViewer()` returns `Promise<RenderResult>` (no `| null`)
6. **Update store**: `lastError: EngineError | null` instead of `string | null`
7. **Update Viewer.tsx**: Display `lastError.message` with severity-appropriate styling

### Phase C: Per-node error attribution (2-3 days)

Add node context to errors so the UI can show which node failed.

1. **Add `EvalError` wrapper** in `cascade-core/src/eval.rs` that captures `(node_id, node_type, source)`
2. **Serialize node info** through the WASM bridge as part of `EngineErrorDto`
3. **Add `nodeErrors: Record<NodeId, EngineError>` to store**
4. **Add error badge component** to `BaseNode` — shows red indicator when `nodeErrors[nodeId]` exists
5. **Add "Blocked by upstream" derived state** for downstream nodes
6. **Clear `nodeErrors` on successful re-evaluation**

### Phase D: Enforcement (1 day, can run in parallel)

1. **Add Clippy denies** to cascade-wasm crate
2. **Add ESLint rules** for empty catch blocks
3. **Add CI grep checks** for swallowing patterns
4. **Update AGENTS.md** with error handling rules
5. **Consider expanding Clippy denies** to other library crates

---

## 6. AGENTS.md Additions

The following rules should be added to AGENTS.md under the existing "Key architectural rules" sections:

### Rust section addition:

> - **Error propagation (WASM bridge)**: All functions in `cascade-wasm` must return `Result<_, JsValue>` and use `map_err(to_engine_error)?` for error propagation. Never use `unwrap_or(JsValue::NULL)`, bare `.unwrap()`, or `.expect()` in production WASM bridge code. The crate enforces `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`.

### Frontend section addition:

> - **Error handling**: Engine/render/eval errors must propagate as structured `EngineError` objects through the full stack (WASM bridge → EngineBridge → store → UI). Never swallow errors with empty catch blocks or by returning null. Only the Zustand store should catch engine exceptions — components and hooks must not swallow errors from engine calls.

### Cross-Cutting "Things to Never Do" addition (for ENGINEERING_ROADMAP.md):

> - **No empty catch blocks** in frontend code — every catch must log, set error state, or re-throw
> - **No `unwrap_or(JsValue::NULL)`** in WASM bridge code — errors must propagate to JS
> - **No returning `null` to signal errors** from EngineBridge methods — throw `EngineError` instead

---

## Appendix: Current Error Audit

### WASM Bridge Patterns (cascade-wasm/src/lib.rs)

**33 GOOD sites**: Use `.map_err(to_js_error)?` — errors propagate as JS exceptions

**7 BAD sites**: Use `unwrap_or(JsValue::NULL)` — errors silently become null:
- Line 187: `list_node_types()` serialization
- Line 205: `add_node()` serialization  
- Line 507: `get_last_render_timings()`
- Line 525: `get_color_management_info()`
- Line 530: `get_views_for_display()`
- Line 571: `get_render_dimensions()`
- Line 619: `export_graph()` — **CRITICAL: silent failure = potential data loss**

**2 DANGEROUS sites**: Use `.expect()` which panics in WASM (kills browser tab):
- Line 164: `.expect("GPU node")` in `compile_script_node()`

### Frontend Error Flow

- `WasmEngine.renderViewer()` catches ALL exceptions → returns null
- `graphStore.ts` render path: `try { ... } catch { /* EMPTY */ }`
- `lastError` state exists + Viewer.tsx red bar works, but render errors never set `lastError`
- Net result: evaluation failures are invisible to the user
