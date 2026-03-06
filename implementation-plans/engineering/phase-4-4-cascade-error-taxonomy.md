# Phase 4.4 — Expand `CascadeError` taxonomy

## Bottom line
Replace `Other(String)` with typed `CascadeError` variants and stable error codes so GPU/format/resource failures survive the WASM/Tauri boundary and become actionable in the UI. Centralize `(code, domain, severity, user_message)` mapping in Rust to keep WASM + IPC consistent.

## Action plan
1. Add the new `CascadeError` variants (GPU/Format/Resource/Operation/IO/Validation) with fields that preserve key context.  
2. Introduce a stable error-code API in Rust (`CascadeError::code()/domain()/severity()/user_message()`), and update both WASM + Tauri bridges to use it.  
3. Replace high-volume `Other(String)` callsites by category (GPU + IO + resource lookups first), leaving `Other` only for truly unknown cases.  
4. Ensure `EvalFailed` preserves inner error codes across the DTO boundary (cause chain or "inner code wins" policy).  
5. Update frontend error parsing/UX to recognize new codes (minimal: no type changes; better: message/action mapping per code).  
6. Add tests that enforce 1:1 coverage (every `CascadeError` variant has a code mapping + round-trip DTO serialization test).  
7. Land the migration incrementally, gated by grep + CI checks to prevent new `Other(...)` regressions.

**Effort estimate:** Medium (1–2 days)

---

## 1. Goal and scope (why this matters)

### Goals
- **Preserve meaning across boundaries:** `CascadeError` should round-trip through **WASM (`JsValue`)** and **Tauri IPC** without collapsing into `"OTHER"`.
- **Make errors actionable:** UI can offer *specific guidance* (reload GPU device, fix shader, re-link missing asset, insert convert node) instead of generic failures.
- **Enable stable UI logic:** stable string `code`s become the contract between Rust ↔ JS/TS (no parsing error strings).

### In scope
- Add new taxonomy variants (required: `GpuDeviceLost`, `GpuShaderCompilation`, `FormatMismatch`, `UnsupportedOperation`, `ResourceNotFound`).
- Create stable error code system used by **both** WASM and Tauri bridges.
- Replace `Other(String)` usage where feasible (prioritize hotspots).
- Handle nested errors (`EvalFailed`) without losing the root-cause code.

### Out of scope (explicitly)
- New UI components or a full "error help center" UX (only mapping + messages).
- New dependencies / infrastructure.

---

## 2. New variant design (proposed complete set, organized by domain)

> Design principle: **typed + minimal** fields that preserve what the user can act on.
> Use `String` fields for boundary safety (serde/WASM/IPC), avoid embedding complex structs unless already stable.

### 2.1 GPU domain
Required + minimal supporting variants:

```rust
pub enum CascadeError {
  // Required
  GpuDeviceLost {
    reason: Option<String>,        // e.g. wgpu "device lost" message
    during: Option<String>,        // e.g. "shader_compile", "dispatch", "readback"
  },
  // Required
  GpuShaderCompilation {
    shader_id: Option<String>,     // kernel id / node type / manifest id
    message: String,               // compilation output / naga errors
  },

  // Strongly recommended support variants (to eliminate GPU-related Other usage)
  GpuPipelineCreation {
    shader_id: Option<String>,
    message: String,
  },
  GpuReadbackFailed {
    message: String,               // buffer map / copy / poll failure
  },
  GpuUnsupportedFeature {
    feature: String,               // e.g. "storage_texture_rgba16f"
    message: Option<String>,
  },
}
```

**Where these come from today (examples):**
- `crates/cascade-gpu/src/kernel_node.rs` uses `Other(...)` for:
  - "GPU node needs image input"
  - "Unsupported param type for GPU kernel"
  - buffer map errors (`Map receive error`, `Map error`)
  - `build_pipeline(...).map_err(CascadeError::Other)` (likely shader/pipeline failures)

### 2.2 Format domain
```rust
pub enum CascadeError {
  // Required
  FormatMismatch {
    expected: String,              // e.g. "RGBA f32 linear, 1920x1080"
    got: String,                   // e.g. "RGBA f16, 2048x858"
    context: Option<String>,        // e.g. "Viewer output", "AlphaOver A input"
  },

  UnsupportedFormat {
    format: String,                // e.g. "EXR multipart deep", "ProRes 4444"
    operation: Option<String>,      // e.g. "decode", "encode"
    reason: Option<String>,
  },
}
```

### 2.3 Resource domain
```rust
pub enum CascadeError {
  // Required
  ResourceNotFound {
    resource_type: String,         // "node", "group_definition", "asset", "shader", "video_frame"
    id: String,                    // stable identifier (stringified)
    hint: Option<String>,          // optional remediation hint
  },

  PermissionDenied {
    operation: String,             // "read", "write"
    path: Option<String>,
  },
}
```

**Notes from current `Other(...)` audit:**
- "Group definition not found", "AI provider not configured", "AI job not found", "No frame at index …"
  are all good fits for `ResourceNotFound`.

### 2.4 Operation domain
```rust
pub enum CascadeError {
  // Required
  UnsupportedOperation {
    operation: String,             // "gpu_kernel_param_pack", "export_sequence"
    reason: String,                // why unsupported
  },

  OperationCancelled {
    operation: Option<String>,     // e.g. "render_sequence"
  },

  Timeout {
    operation: String,
    seconds: u64,
  },
}
```

### 2.5 IO domain
```rust
pub enum CascadeError {
  IoReadFailed {
    path: Option<String>,
    message: String,
  },
  IoWriteFailed {
    path: Option<String>,
    message: String,
  },
  ImageEncode {
    format: String,                // "png", "jpeg", "exr"
    message: String,
  },
  ImageDecode {
    // keep existing variant but prefer structured fields long-term
    String,
  },
}
```

**Current `Other(...)` examples to migrate:**
- Runtime: "Failed to read dir", "PNG encode failed", "JPEG encode failed"
- EXR encode: "No layers to encode", "EXR encode failed: …" (consider mapping to `ImageEncode { format: "exr" }`)

### 2.6 Validation domain
```rust
pub enum CascadeError {
  InvalidArgument {
    name: String,                  // "step", "frame_index", "node_id"
    reason: String,
  },
  OutOfRange {
    name: String,
    min: Option<f64>,
    max: Option<f64>,
    got: f64,
  },
  LimitExceeded {
    resource: String,              // "eval_depth", "cache_bytes", "image_pixels"
    limit: u64,
    got: u64,
  },
  InternalInvariantViolated {
    message: String,               // replaces many lock-poison / "should never happen"
  },
}
```

**Immediate win:** replace `CascadeError::Other("Max evaluation depth exceeded")` in `cascade-core/src/eval.rs`
with `LimitExceeded { resource: "eval_depth", limit: 64, got: depth }`.

---

## 3. Error code system (stable string codes)

### 3.1 Rules
- Codes are **UPPER_SNAKE_CASE**, stable across releases.
- Never reuse a retired code for a different meaning.
- Adding new variants requires adding a new code + tests.

### 3.2 Source of truth (Rust)
Add a centralized API in `crates/cascade-core/src/error.rs`:

```rust
impl CascadeError {
  pub fn code(&self) -> &'static str { ... }
  pub fn domain(&self) -> &'static str { ... }     // "gpu" can map to existing "runtime" if needed
  pub fn severity(&self) -> &'static str { ... }   // "error" default
  pub fn user_message(&self) -> String { ... }     // safe + actionable
}
```

### 3.3 Proposed codes (new + existing)
New codes (required):
- `GPU_DEVICE_LOST`
- `GPU_SHADER_COMPILATION`
- `FORMAT_MISMATCH`
- `UNSUPPORTED_OPERATION`
- `RESOURCE_NOT_FOUND`

Recommended supporting codes (to retire major `Other(...)` clusters):
- `GPU_PIPELINE_CREATION`
- `GPU_READBACK_FAILED`
- `IO_READ_FAILED`
- `IO_WRITE_FAILED`
- `IMAGE_ENCODE`
- `INVALID_ARGUMENT`
- `LIMIT_EXCEEDED`
- `INTERNAL_INVARIANT`

Existing codes already emitted in WASM mapping:
- `NODE_NOT_FOUND`, `MISSING_INPUT`, `MISSING_PARAM`, `TYPE_MISMATCH`, `CYCLE_DETECTED`, `INVALID_CONNECTION`, `IMAGE_DECODE`, `PORT_NOT_FOUND`, `INVALID_IMAGE_DATA`, `IMAGE_TOO_LARGE`, `EXR_ERROR`, `OTHER`

**Recommendation:** stop collapsing all EXR errors into `EXR_ERROR` once the code system is centralized; use:
- `EXR_METADATA`, `EXR_DECODE`, `EXR_UNSUPPORTED_LAYER`, `EXR_NO_PRIMARY`, `EXR_LAYER_TOO_LARGE`

---

## 4. Audit of `Other(String)` usage (current categories)

Based on `rg "CascadeError::Other"` results (not exhaustive, but representative):

### 4.1 GPU-related
- `crates/cascade-gpu/src/kernel_node.rs`
  - missing image input
  - unsupported param packing
  - map/readback errors
  - pipeline build errors via `map_err(CascadeError::Other)`
- `crates/cascade-gpu/src/kuwahara.rs`
  - map/readback errors

**Target variants:** `GpuDeviceLost`, `GpuShaderCompilation`, `GpuPipelineCreation`, `GpuReadbackFailed`, `UnsupportedOperation`.

### 4.2 Resource lookup / missing state
- Runtime/wasm/group: "Node not found", "Group definition not found", "Group node instance not found"
- AI: "AI provider not configured", "AI job not found"
- Video: "No frame at index …"

**Target variants:** `ResourceNotFound`, keep `NodeNotFound` for core graph NodeId.

### 4.3 IO + serialization
- "Failed to read dir", "Failed to read frame …", "Invalid pattern …"
- "Serialization failed …"
- "PNG encode failed …", "JPEG encode failed …"
- EXR encode/decode stringified failures

**Target variants:** `IoReadFailed`, `IoWriteFailed`, `ImageEncode`, possibly `UnsupportedFormat`.

### 4.4 Validation / limits / internal invariants
- Mutex poison / lock poisoned messages across crates
- "Step must be > 0"
- "Invalid node id"
- "Max evaluation depth exceeded"

**Target variants:** `InvalidArgument`, `LimitExceeded`, `InternalInvariantViolated`.

---

## 5. UX considerations (user-facing messages + actionability)

> Approach: `user_message()` should be safe and actionable; raw underlying strings go to debug logs (or a `debug_message` field if/when added).

### GPU
- `GPU_DEVICE_LOST`:  
  **Message:** "GPU device was lost while rendering. Try reloading the app."  
  **Actionable:** Reload, update drivers, reduce GPU load; in desktop: restart app.
- `GPU_SHADER_COMPILATION`:  
  **Message:** "GPU shader failed to compile. Fix the shader and try again."  
  **Actionable:** Show shader_id (kernel name) + compilation message (trimmed).

### Format
- `FORMAT_MISMATCH`:  
  **Message:** "Format mismatch: expected {expected}, got {got}."  
  **Actionable:** Suggest inserting a conversion node (resize/convert/colorspace depending on context).

### Resource
- `RESOURCE_NOT_FOUND`:  
  **Message:** "Missing {resource_type}: {id}."  
  **Actionable:** Re-link asset, re-import, or ensure the resource exists (file path / registry entry).

### Operation
- `UNSUPPORTED_OPERATION`:  
  **Message:** "Unsupported operation: {operation}. {reason}."  
  **Actionable:** Provide workaround (CPU fallback, different node, change settings) where applicable.

### IO / Validation
- `IO_READ_FAILED` / `IO_WRITE_FAILED`:  
  **Message:** "Failed to read/write {path}."  
  **Actionable:** Check permissions, path existence, disk space.
- `INVALID_ARGUMENT`:  
  **Message:** "Invalid {name}: {reason}."  
  **Actionable:** User can correct parameter input.

---

## 6. Edge cases (nested errors, chains, serialization)

### 6.1 `EvalFailed` wrapping GPU errors
**Current behavior (WASM):** wrapper forces code `EVAL_FAILED` and uses `source.to_string()` as message, losing inner code.  
**Plan:** preserve root-cause code via one of these policies:

**Preferred (minimal frontend impact): "inner code wins"**
- When `CascadeError::EvalFailed { source, node_id, node_type }`, emit DTO:
  - `code = source.code()`
  - `message = source.user_message()`
  - `domain = source.domain()`
  - include `node_id`, `node_type`
  - optionally add `wrapper_code: "EVAL_FAILED"` for debugging (extra field ignored by current TS parser)

**Alternative (more explicit chaining): "cause chain"**
- Extend DTO with optional `cause: Option<Box<EngineErrorDto>>` and keep `code="EVAL_FAILED"`.
- Requires a small TS change if UI wants to read `cause.code`.

### 6.2 Error chain depth / size
- Cap serialized cause depth (e.g. 8) to avoid huge payloads for repeated wrapping.
- Truncate long GPU compiler logs for user message; keep full log in debug field if available.

### 6.3 Serialization safety
- Prefer `String` fields and optional `details: Option<BTreeMap<String, String>>` in DTO.
- Avoid embedding `NodeId` directly in DTO; always stringify.

---

## 7. Error handling flow (Rust → WASM/Tauri → JS → UI)

### 7.1 Rust core
- `CascadeError` becomes the canonical taxonomy and code source.
- Evaluator continues wrapping node failures in `EvalFailed` for attribution.

### 7.2 WASM bridge
- `EngineErrorDto::from_cascade_error` should stop hardcoding match tables and instead call:
  - `err.code()`, `err.domain()`, `err.severity()`, `err.user_message()`
- Ensure `EvalFailed` policy preserves inner codes (see §6.1).

### 7.3 Tauri IPC (currently loses codes)
- `apps/tauri/src-tauri/src/lib.rs` currently returns `Result<_, String>` and does `.map_err(|e| e.to_string())?`.
- Change command signatures to return `Result<T, EngineErrorDto>` (or a serializable error struct matching WASM DTO fields).
- Map `cascade_runtime::CascadeError` to DTO using the same Rust code mapping.

---

## 8. Frontend impact

### 8.1 TypeScript types
- **Minimal:** keep `EngineError.code: string` (already generic), no union changes required.
- Ensure `parseEngineError()` continues to accept snake_case `node_id/node_type` (already does).

### 8.2 UI mapping for new codes
- Add a small mapping layer (where errors are displayed) to translate codes into:
  - friendly title
  - optional remediation hint (reload, fix shader, relink file)
- If adopting `cause` chain, update UI to show root cause while still attributing to `nodeId`.

---

## 9. Migration strategy (incremental replacement of `Other(String)`)

### 9.1 Grep-driven workflow
Run (locally/CI):
- `rg "CascadeError::Other" crates`
- `rg "Other\\(" crates/cascade-core/src` (to catch `Other(` constructors)
Track replacements by category:
1. GPU (highest user impact)
2. IO encode/decode + file ops
3. Resource lookups ("not found")
4. Validation + invariants (lock poisoned, invalid args)
5. Remaining long-tail "Other" stays but must be justified

### 9.2 Prevent regressions
- Add a lightweight CI grep check that fails if new `CascadeError::Other(` appears outside tests (or require a `// OK: Other` annotation).
- Optionally mark the variant as deprecated:
  - `#[deprecated(note = "Use a specific CascadeError variant")] Other(String)`
  (useful to surface warnings during migration)

---

## 10. Testing strategy (ties to Phase 5.1)

### 10.1 Coverage: every variant is tested
Add a `cascade-core` unit test module that:
- Instantiates each `CascadeError` variant (including new ones)
- Asserts:
  - `code()` returns a non-empty stable string
  - `domain()` is valid (one of allowed domains)
  - `user_message()` is non-empty and does not expose raw internal strings for "internal" errors

### 10.2 DTO serialization tests
- WASM DTO: test `EngineErrorDto::from_cascade_error` produces expected `(code, domain, node_id/node_type)` especially for `EvalFailed`.
- Tauri DTO: test conversion used by commands matches WASM DTO shape (serde round-trip JSON).

### 10.3 Integration smoke tests
- A GPU shader compilation failure should surface as `GPU_SHADER_COMPILATION` in the frontend (manual or automated harness).
- A missing file/path should surface as `IO_READ_FAILED` / `RESOURCE_NOT_FOUND` (depending on source).

---

## 11. Step-by-step implementation checklist (file-level)

### Rust — taxonomy + mapping
- [ ] Update `crates/cascade-core/src/error.rs`:
  - [ ] Add new variants (required + selected supporting)
  - [ ] Add `code()/domain()/severity()/user_message()` methods
- [ ] Update evaluator wrapping policy if needed (`EvalFailed` stays, but DTO emission changes)

### WASM bridge
- [ ] Update `crates/cascade-wasm/src/lib.rs`:
  - [ ] Replace hardcoded code/domain match with `CascadeError` mapping methods
  - [ ] Implement `EvalFailed` root-cause code strategy (§6.1)
  - [ ] (Optional) add `wrapper_code` or `cause` field to DTO (backwards compatible)

### Tauri IPC
- [ ] Update `apps/tauri/src-tauri/src/lib.rs`:
  - [ ] Change command error type from `String` → serializable DTO
  - [ ] Convert `cascade_runtime::CascadeError` → DTO using the same mapping
  - [ ] Remove `.map_err(|e| e.to_string())` where it erases structure

### Replace `Other(String)` hotspots
- [ ] GPU: replace `Other` in `crates/cascade-gpu/src/kernel_node.rs` + `kuwahara.rs`
- [ ] IO encode paths: replace `PNG/JPEG/EXR encode failed` strings with `ImageEncode`
- [ ] Resource missing: replace "Group definition not found", "AI job not found", "No frame at index …" with `ResourceNotFound`
- [ ] Validation: replace "Step must be > 0", "Max evaluation depth exceeded" with `InvalidArgument` / `LimitExceeded`

### Frontend
- [ ] Add code→hint mapping where errors are displayed (minimal strings OK)
- [ ] If DTO adds `cause`, optionally render the root cause while keeping node attribution

### Tests
- [ ] Add 1 test per variant (mapping + message)
- [ ] Add DTO round-trip tests (WASM and Tauri shapes)

---

## 12. Risks and mitigations

- **Risk:** Breaking UI expectations if `EvalFailed` no longer emits code `EVAL_FAILED`.  
  **Mitigation:** keep backwards compatibility via `wrapper_code` or `cause`, or migrate UI to root-cause-first explicitly.

- **Risk:** Too many variants / analysis paralysis.  
  **Mitigation:** implement required variants + a small set of "support" variants that eliminate the largest `Other(...)` clusters; leave long tail for later.

- **Risk:** Different backends (WASM vs Tauri) diverge in code mapping.  
  **Mitigation:** make `CascadeError::{code,domain,severity,user_message}` the single source of truth and use it in both bridges; add cross-backend tests.

---

## Watch out for
- `apps/tauri` currently returns `String` errors; without changing command signatures, stable codes won't round-trip.
- Avoid embedding non-serializable types in error variants/DTO fields; prefer `String` and `Option<String>`.
- GPU compiler logs can be huge—truncate for user-facing messages; keep full details for debug logging.
