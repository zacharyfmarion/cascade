# Phase 4: WASM Multi-Threading (wasm-bindgen-rayon)

## Overview

Enable real Rayon parallelism in WASM via `wasm-bindgen-rayon`. All 42+ existing `par_chunks_exact_mut(4)` call sites across cascade-core and cascade-nodes-std will automatically parallelize in the browser — no per-node changes needed.

**Expected impact:** 7-8s → 3-4s for 3-layer EXR decode (web). All pixel processing operations get multi-core speedup.

**Approach:** Dual WASM bundles (threaded + non-threaded) with runtime feature detection. Graceful fallback if SharedArrayBuffer is unavailable.

## Prerequisites

- [x] Phase 1: Decode-Once Architecture (complete)
- [x] Phase 2: Web Worker Engine Offloading (complete)
- COOP/COEP headers approved (no third-party embed concerns)

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Build pipeline | Nightly for WASM only, stable for everything else | Least disruptive; `wasm-bindgen-rayon` requires nightly `-Z build-std` |
| Graceful degradation | Dual bundles + runtime detection | Single threaded bundle with try/catch on `initThreadPool` is fragile — atomics-enabled WASM may not load at all without SharedArrayBuffer |
| Thread count | `min(8, max(1, (hardwareConcurrency ?? 4) - 1))` | Cap at 8 (good for image processing), leave 1 core for UI thread |
| Dev hot-reload | Rebuild both bundles | Developer needs threaded execution locally |
| Pixel transfer | Keep Comlink.transfer() | SharedArrayBuffer for results adds complexity with no clear win — thread pool uses SAB internally |

## Implementation Steps

### Step 1: Feature flag in `cascade-wasm/Cargo.toml`

Add `wasm-bindgen-rayon` as an optional dependency gated behind a `wasm-threads` feature.

```toml
[features]
wasm-threads = ["dep:wasm-bindgen-rayon"]

[dependencies]
rayon = "1"                                              # make explicit (was transitive)
wasm-bindgen-rayon = { version = "1.3", optional = true }
```

**Why explicit rayon?** We need `rayon::current_num_threads()` for the diagnostic export. Transitive dependency isn't guaranteed to expose the API.

### Step 2: Rust exports in `cascade-wasm/src/lib.rs`

Re-export `init_thread_pool` (only when feature is enabled) and add a diagnostic function.

```rust
// Near top of file, after other pub uses
#[cfg(feature = "wasm-threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

// Standalone function (not on Engine impl)
#[wasm_bindgen]
pub fn rayon_num_threads() -> usize {
    rayon::current_num_threads()
}
```

`init_thread_pool` is a `#[wasm_bindgen]` async function from the crate — re-exporting makes it callable from JS as `initThreadPool(n)`.

### Step 3: Dual build scripts

Update `apps/web/package.json`:

```jsonc
{
  "scripts": {
    "build:wasm": "yarn build:wasm:st && yarn build:wasm:mt",
    "build:wasm:st": "wasm-pack build crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg",
    "build:wasm:mt": "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory -C link-arg=--max-memory=1073741824 -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base' RUSTUP_TOOLCHAIN=nightly CARGO_UNSTABLE_BUILD_STD=std,panic_abort wasm-pack build ../../crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg-threads --features wasm-threads"
  }
}
```

**Nightly setup (one-time):**
```bash
rustup toolchain install nightly
rustup component add rust-src --toolchain nightly
rustup target add wasm32-unknown-unknown --toolchain nightly
```

**Note:** Do NOT put atomics flags in `.cargo/config.toml`. They must only apply to the threaded build, not to `cargo check/test/clippy` which run on stable.

**Important:** The RUSTFLAGS must include `-C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=1073741824` plus the TLS exports. Without `--shared-memory`, the WASM memory won't be backed by `SharedArrayBuffer`, and `initThreadPool` will fail with `DataCloneError` when trying to `postMessage` the memory to sub-workers.

### Step 4: Update `wasmHotRebuild()` plugin in `vite.config.ts`

The existing hot-rebuild plugin runs `wasm-pack build` on `.rs`/`.toml` changes. Update it to run both builds:

```typescript
// In wasmHotRebuild plugin's handleHotUpdate or buildStart:
// Replace single wasm-pack call with:
execSync('yarn build:wasm:st', { stdio: 'inherit' });
execSync('yarn build:wasm:mt', { stdio: 'inherit' });
```

This is slower (~2x) but ensures threaded execution is always available during development.

### Step 5: Add COOP/COEP headers in `vite.config.ts`

```typescript
export default defineConfig({
  // ... existing config ...
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // ... existing proxy config ...
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

**Production:** Same headers must be set at the hosting/CDN level (Vercel, Cloudflare, nginx, etc.).

**Watch out for:** These headers enable `crossOriginIsolated` mode which blocks cross-origin resources without CORS/CORP headers. The existing API proxies (`/api/replicate`, `/api/anthropic`) go through Vite's proxy and are same-origin, so they're fine. External image URLs or CDN assets would need `crossorigin` attributes.

### Step 6: Update worker init in `engineWorker.ts`

Replace the current `init()` function with dual-path initialization:

```typescript
async function initEngine(): Promise<void> {
  if (engine) return;

  const useThreads =
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated &&
    typeof SharedArrayBuffer !== 'undefined';

  if (useThreads) {
    try {
      const threaded = await import('../wasm-pkg-threads/cascade_wasm');
      await threaded.default();
      const cores = navigator.hardwareConcurrency ?? 4;
      const threads = Math.min(8, Math.max(1, cores - 1));
      await threaded.initThreadPool(threads);
      engine = new threaded.Engine();
      console.log(`[cascade] Threaded WASM initialized with ${threaded.rayon_num_threads()} threads`);
    } catch (e) {
      console.warn('[cascade] Threaded WASM failed, falling back to single-threaded:', e);
      engine = null; // ensure fallback runs
    }
  }

  if (!engine) {
    const st = await import('../wasm-pkg/cascade_wasm');
    await st.default();
    engine = new st.Engine();
    console.log('[cascade] Single-threaded WASM initialized');
  }

  try {
    await engine.init_gpu();
  } catch (e) {
    console.warn('[cascade] GPU init failed (CPU fallback):', e);
  }
}
```

**Key points:**
- `initThreadPool()` MUST be called after `init()` but BEFORE `new Engine()` — the thread pool must exist before any Rayon code runs
- `initThreadPool()` spawns additional sub-workers from within the engine worker
- The try/catch ensures graceful fallback if anything goes wrong with the threaded path
- `rayon_num_threads()` confirms actual thread count (diagnostic)

### Step 7: Update `workerEngine.ts` main-thread WASM init

The main thread also loads WASM for synchronous pure functions (`types_compatible`, `needs_migration`, `migrate_document`). This should use the NON-THREADED bundle (main thread can't block for thread pool init):

```typescript
// In workerEngine.ts, keep using non-threaded bundle:
import wasmInit from '../wasm-pkg/cascade_wasm';
```

No changes needed here — just verify the import path stays pointed at `wasm-pkg/` (non-threaded).

### Step 8: Add `wasm-pkg-threads/` to `.gitignore`

```
# WASM build output
apps/web/src/wasm-pkg/
apps/web/src/wasm-pkg-threads/
```

### Step 9: CI updates (`.github/workflows/ci.yml`)

In the `frontend-lint` job (which runs `yarn build:wasm`):

```yaml
- name: Install Rust (stable)
  uses: dtolnay/rust-toolchain@stable
  with:
    targets: wasm32-unknown-unknown

- name: Install Rust (nightly for threaded WASM)
  uses: dtolnay/rust-toolchain@nightly
  with:
    targets: wasm32-unknown-unknown
    components: rust-src

- name: Build WASM (both bundles)
  run: yarn build:wasm
```

Keep all other jobs (rust-check, rust-lint, bench-compile) on stable — they don't need nightly.

### Step 10: Testing & Verification

**Manual verification:**
1. Start dev server → open browser console
2. Should see: `[cascade] Threaded WASM initialized with N threads`
3. `rayon_num_threads()` should return > 1
4. Load a multi-layer EXR → should be noticeably faster

**Automated:**
- E2E test (Playwright): Check `crossOriginIsolated === true` in page context
- E2E test: Call `rayon_num_threads()` through the engine and assert > 1
- Without COOP/COEP headers: verify fallback path logs the warning and `rayon_num_threads() === 1`

**Regression:**
- All existing tests must pass (Rust: `cargo test --workspace`, Frontend: `yarn lint`, `npx tsc -b --noEmit`)
- Ensure non-threaded bundle still works independently (test without COOP/COEP headers)

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Nightly Rust breakage | Medium | Pin nightly date in CI (e.g., `nightly-2026-03-01`). Non-threaded bundle always works as fallback. |
| COOP/COEP breaks external resources | Low (no 3rd party embeds) | API proxies are same-origin. Test all asset loading paths. |
| Sub-worker spawning fails (CSP) | Low | Ensure no restrictive `worker-src` CSP. Test in target deployment environment. |
| wasm-bindgen version mismatch | Medium | Lock wasm-bindgen version across all crates. Run `cargo tree -d` to check. |
| Safari thread support issues | Low | Graceful fallback covers this. Safari supports SharedArrayBuffer since 15.2. |
| Dev rebuild speed (~2x) | Certain | Acceptable tradeoff for threaded dev experience. Consider parallel builds if too slow. |

## File Change Summary

| File | Change |
|---|---|
| `crates/cascade-wasm/Cargo.toml` | Add `wasm-threads` feature, `wasm-bindgen-rayon`, explicit `rayon` |
| `crates/cascade-wasm/src/lib.rs` | Re-export `init_thread_pool`, add `rayon_num_threads()` |
| `apps/web/package.json` | Split `build:wasm` into `build:wasm:st` + `build:wasm:mt` |
| `apps/web/vite.config.ts` | Add COOP/COEP headers, update hot-rebuild to build both bundles |
| `apps/web/src/engine/engineWorker.ts` | Dual-path init with feature detection and fallback |
| `apps/web/src/engine/workerEngine.ts` | Verify using non-threaded bundle (likely no change) |
| `.gitignore` | Add `wasm-pkg-threads/` |
| `.github/workflows/ci.yml` | Add nightly toolchain + rust-src for threaded WASM build |
