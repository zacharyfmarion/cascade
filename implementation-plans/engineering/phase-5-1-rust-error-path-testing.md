# Phase 5.1: Rust error path testing (Implementation Plan)

## Bottom line
Add a dedicated, table-driven **error-path test suite** that triggers *every* `CascadeError` variant at least once, plus evaluator-specific regression tests for caching/dirty/mute semantics.

**Effort estimate:** Medium (1–2d)

---

## 1) Goal and scope
Ensure all Rust error paths are tested:
- Each `CascadeError` variant is triggered intentionally and asserted.
- Evaluator behavior under error conditions is correct and stable.
- Error messages remain useful with relevant context.

---

## 2) Test matrix (18 variants)

| Variant | Scenario | Key Assertions |
|---|---|---|
| `NodeNotFound` | Evaluate unregistered node type | Message includes type ID |
| `MissingInput` | Evaluate node with no connected required input | Message includes port name |
| `MissingParam` | Evaluate with required param absent | Message includes param name |
| `TypeMismatch` | Connect incompatible output→input types | Message includes expected/actual |
| `CycleDetected` | Create A→B→A cycle | Message indicates cycle |
| `InvalidConnection` | Wrong-direction connection | Message includes endpoints |
| `ImageDecode` | Feed invalid image bytes | Message includes context |
| `PortNotFound` | Access missing port name | Message includes port + node type |
| `InvalidImageData` | Wrong buffer length to Image constructor | Message includes expected vs got |
| `ImageTooLarge` | Oversized dimensions (no allocation) | Message includes size/limit |
| `EvalFailed` | FailNode returns error | Message includes node id/type |
| `Other` | Direct creation | Message includes string |
| `ExrMetadata` | Bad EXR metadata | Includes detail |
| `ExrDecode` | Corrupt EXR bytes | Includes context |
| `ExrUnsupportedLayer` | Unsupported layer type | Names layer/reason |
| `ExrNoUsablePrimaryLayer` | No RGBA layer | Indicates missing primary |
| `ExrLayerTooLarge` | Huge layer dims in header | Early rejection |
| `ValueNotBytes` | Call as_bytes on wrong Value | Includes actual type |

---

## 3) Evaluator error tests
- **Cache does not store error results**: error → fix → recompute succeeds.
- **Dirty propagation**: upstream param change → downstream recomputes.
- **Muted single-input passthrough**: muted node passes input unchanged.
- **Muted multi-input**: documented behavior (ignore if known bug).

---

## 4) Test helpers
- Graph builder helpers: `make_engine_for_test()`, `add_node()`, `connect()`, `eval_view()`.
- Error assertions: `assert_err_variant!()`, `assert_err_msg_contains!()`.
- Instrumented test nodes: `FailNode`, `CountNode`, `PassthroughNode`.
- Exhaustive `cascade_error_variant_name()` match (compile-time enforcement).

---

## 5) Coverage measurement
- Exhaustive match helper forces compilation failure on new variants.
- Table-driven test with `cases.len() == 18` assertion.

---

## Step-by-step implementation checklist
- [ ] Create `crates/cascade-core/tests/error_paths.rs` with support helpers.
- [ ] Add exhaustive `cascade_error_variant_name()` helper.
- [ ] Implement per-variant test cases (all 18).
- [ ] Add evaluator regression tests (cache, dirty propagation, mute).
- [ ] Add Image constructor tests (InvalidImageData, ImageTooLarge).
- [ ] Add EXR error tests with minimal fixtures.
- [ ] Add ValueNotBytes unit test.
- [ ] Add error recovery tests (fix error → re-evaluate → success).

## Risks and mitigations
- **Large allocations for size-limit tests:** craft inputs that trip limits before allocation.
- **EXR fixtures bloat:** smallest possible fixtures with `include_bytes!`.
- **Ambiguous mute behavior:** add ignored reproduction test; document intended rule.
