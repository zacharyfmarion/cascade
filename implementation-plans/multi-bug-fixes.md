# Multi-Bug Fix: Five UX and Correctness Issues

## Goal
Fix five separate issues reported by the user covering UI, shortcut handling, node deduplication, and GPU script serialization.

## Approach

### Fix 1 — Viewer error text not copyable
**Root cause:** The parent `section` element steals pointer focus via `onPointerDown={() => containerRef.current?.focus()}`. When error text is selected and the user presses Cmd+C, the keydown handler on the focused section doesn't intercept it — but the focus shift caused by pointer-down may disrupt the text selection context in the WebKit webview.

**Fix:** Add `onPointerDown={e => e.stopPropagation()}` to the error div (prevent focus theft) and explicitly set `userSelect: 'text'`.

**File:** `apps/web/src/components/Viewer.tsx` (line ~629)

---

### Fix 2 — Group boundary port labels use raw type IDs
**Root cause:** In `create_group_from_nodes`, boundary port names are built as `format!("{}_{}", type_id, port_name)`. For GPU kernel nodes (type_id = `gpu_kernel::chroma_key`), this produces `gpu_kernel::chroma_key_image` instead of `image`.

**Fix:** Use just `conn.to_port` / `conn.from_port` as the base name for uniqueness. If two boundary ports share the same name, `unique_port_name` appends `_2`, `_3`, etc.

**File:** `crates/cascade-runtime/src/lib.rs` (lines 639, 671)

---

### Fix 3 — Duplicate CPU chroma key node
The CPU `ChromaKey` in `cascade-nodes-std/src/matte.rs` duplicates the GPU kernel `gpu_kernel::chroma_key` in `cascade-gpu/src/matte_kernels.rs`. The GPU version is strictly better for per-pixel operations.

**Fix:** Remove the `ChromaKey` struct from `matte.rs`, remove its `pub use` export and `register` call from `cascade-nodes-std/src/lib.rs`.

**Files:**
- `crates/cascade-nodes-std/src/matte.rs`
- `crates/cascade-nodes-std/src/lib.rs`

---

### Fix 4 — Cmd+Q doesn't quit desktop app
**Root cause:** The macOS application menu is missing. Currently, `MenuBuilder` starts with `PredefinedMenuItem::separator` (incorrect). On macOS, Cmd+Q triggers the "Quit" item in the application menu.

**Fix:** Replace the orphan separator with a proper "Cascade" app submenu that includes `PredefinedMenuItem::about` and `PredefinedMenuItem::quit`. The quit item automatically binds Cmd+Q on macOS.

**File:** `apps/tauri/src-tauri/src/menu.rs`

---

### Fix 5 — GPU script node GLSL not saved/loaded properly
Two separate root causes:

**5a — Hard failure on load when GLSL compilation fails:**
`import_document` calls `register_gpu_kernel` for each script in `document.scripts`. If GPU compilation fails (e.g., invalid WGSL transpilation), the whole project load fails with an error. `import_graph` already has a graceful draft-node fallback — but it's never reached.

**Fix:** In `import_document`, silently skip compilation errors for individual scripts. Let `import_graph` handle fallback.

**5b — Frontend drops `__script_manifest` during hydration:**
`buildRootGraphState` (hydration.ts) only copies params that are declared in the node's spec. The `__script_manifest` param is an internal hidden key, not in the spec, so it's silently dropped. After load, `ScriptNodeEditor` reads `nodeParams.__script_manifest` which is now undefined, so it shows the default `return color;` GLSL.

**Fix:** After copying spec params, preserve `__script_manifest` for `gpu_script::*` nodes from the raw serialized data.

**Files:**
- `crates/cascade-runtime/src/lib.rs` (import_document function)
- `apps/web/src/store/graphStore/hydration.ts`

## Affected Areas
- `apps/web/src/components/Viewer.tsx`
- `apps/tauri/src-tauri/src/menu.rs`
- `crates/cascade-runtime/src/lib.rs`
- `crates/cascade-nodes-std/src/matte.rs`
- `crates/cascade-nodes-std/src/lib.rs`
- `apps/web/src/store/graphStore/hydration.ts`

## Checklist

- [x] Fix 1: Viewer error text copyable (`Viewer.tsx`)
- [x] Fix 2: Group port labels use port name, not type_id (`lib.rs`)
- [x] Fix 3: Remove CPU ChromaKey from `matte.rs` and `lib.rs`
- [x] Fix 4: Add macOS app menu with Quit to `menu.rs`
- [x] Fix 5a: `import_document` skips compilation errors gracefully (`lib.rs`)
- [x] Fix 5b: Hydration preserves `__script_manifest` for GPU script nodes (`hydration.ts`)
- [x] `cargo check` passes for changed crates
- [x] `cargo test` passes
- [x] `cargo clippy` clean
- [x] `cargo fmt` clean
- [x] `yarn lint` clean
- [x] `npx tsc -b --noEmit` clean
- [ ] Draft PR opened
