# Phase 4.5 — Format propagation validation (Implementation Plan)

## Bottom line
Add explicit **output Format rules** to `NodeSpec`, resolve those rules during evaluation to compute an **expected output domain**, and **validate** every produced `Image` against that expectation. Fix GPU readback and Field→Image rasterization to use resolved rules.

**Effort estimate:** Large (3d+)

---

## 1) Goal and scope
For any node output `Image`, the system can predict (from node spec + inputs + project settings) the expected Format metadata and enforce it.

---

## 2) Format rule design

```rust
pub enum FormatRule {
    InheritInput { port: String },
    ProjectFormat,
    Custom(Format),
    LargestInput,
    SmallestInput,
    UnionInputs,
    IntersectionInputs,
}

pub enum DataWindowRule {
    InheritInput { port: String },
    UnionInputs,
    IntersectionInputs,
    FullDisplayWindow,
    Custom(RectI),
}
```

---

## 3) NodeSpec extensions
Extend `OutputSpec` with optional `format_rule` and `data_window_rule`. Defaults: `InheritInput("in")` for nodes with image input, `ProjectFormat` for generators.

---

## 4) Validation design
Validate at evaluation boundaries (after `evaluate()` returns). Mismatches become `CascadeError::FormatMismatch`. No auto-convert in Phase 4.5.

---

## 5) GPU kernel fix
Thread resolved output domain metadata into GPU execution. Update `read_texture_to_image()` to construct `Image` with preserved format, data_window, and color_space.

---

## 6) Field auto-rasterization
Route through same resolver for target Format and data_window.

---

## 7) UX considerations
Surface node errors with expected vs actual format. Manual Reformat node insertion (no auto-insertion in Phase 4.5).

---

## 8) Edge cases
- Mixed resolutions: deterministic rule per node.
- Generators: default ProjectFormat.
- Group nodes: mirror internal output node's declared rule.
- Preview scaling: resolver runs in same scale context.

---

## 9) Color space interaction
Keep separate from format rules. Phase 4.5 stops GPU paths from resetting color_space (inherit from input).

---

## Step-by-step implementation checklist
- [ ] Add `FormatRule` and `DataWindowRule` enums with serde support.
- [ ] Extend `OutputSpec` with format_rule / data_window_rule.
- [ ] Implement `resolve_expected_domain()` with deterministic tie-break rules.
- [ ] Add `CascadeError::FormatMismatch` variant.
- [ ] Implement validation and call centrally after node eval.
- [ ] Thread expected domain into GPU evaluation; update `read_texture_to_image()`.
- [ ] Route Field→Image rasterization through resolver.
- [ ] Update standard CPU nodes to declare explicit rules.
- [ ] Update GPU kernel manifests/spec.
- [ ] Add unit + integration tests.

## Risks and mitigations
- **Latent inconsistencies:** provide migration defaults, then tighten.
- **Multi-input ambiguity:** document and standardize per node category.
