
## [2026-03-01] Migration System Bugs Fixed

### Issue: PORT_NOT_FOUND error on old documents

**Root Causes Found:**
1. **Tauri backend missing migration**: `load_project` was directly importing documents without calling `migrations::migrate_document()`
2. **Wrong format_version in new documents**: Three `createDocumentEnvelope` functions were saving with "1.0.0" instead of "1.1.0"
3. **WASM build failure**: `ai_provider` module uses `reqwest::blocking` which cannot compile to WASM

**Fixes Applied:**
1. Added migration call in `apps/tauri/src-tauri/src/lib.rs` before `import_document()`
2. Updated `format_version: '1.1.0'` in wasmEngine.ts, tauriEngine.ts, and graphStore.ts
3. Made `ai_provider` conditional with `#[cfg(not(target_arch = "wasm32"))]` guards

**Verification:**
- Tauri backend: ✅ Compiles and builds successfully
- TypeScript: ✅ No new errors introduced
- WASM: ✅ Builds successfully with migration functions exported
- Migration tests: ✅ All pass including future version detection

### Key Learnings

1. **Two independent systems**: Desktop (Tauri) and Web (WASM) have separate load paths that both need migration support
2. **WASM constraints**: Blocking I/O (`reqwest::blocking`) cannot be used in WASM - must use conditional compilation
3. **Format version matters**: Always use current version for new documents to avoid unnecessary migrations
4. **Migration system is complete**: All originally planned functionality exists and works correctly

### Migration System Status

**Completed:**
- ✅ v1.0.0 → v1.1.0 migration (Viewer port rename)
- ✅ WASM bridge functions (migrate_document_json, needs_migration_json)
- ✅ Frontend integration in loadProject
- ✅ Tauri backend integration
- ✅ Future version detection with proper error
- ✅ All tests passing
- ✅ Format version updated to 1.1.0

**Remaining Work:**
None - all Definition of Done items complete.
