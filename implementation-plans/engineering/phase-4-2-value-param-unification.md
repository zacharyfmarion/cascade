# Phase 4.2 — Unify `Value` / `ParamValue` / `ParamDefault` (Rust core type system)

## Bottom line
Unify **parameter values** by making `ParamDefault` disappear (becoming the same type as `ParamValue`), and replace today's lossy "param → runtime `Value`" helpers with **explicit, exhaustive, fallible conversions**. Keep `Value` as the runtime graph value (f32-oriented) and treat complex parameter-only types (CurvePoints/ColorRamp/Resolution/Vec2) as **params-only** unless the graph truly needs them as runtime connectable values.

**Effort estimate:** Medium (1–2d)

---

## Recommendation: Option C (Keep Value separate; unify params; make conversions explicit & exhaustive)
- Solves the real bugs (silent truncation / data loss) with minimal surface area.
- Preserves architecture where nodes can read params directly.
- Keeps runtime `Value` optimized and semantically clean.

---

## Key design decisions

### Precision handling
- Params: f64/i64 (`ParamValue`). Runtime: f32/i32 (`Value`).
- Conversion is explicit (named method), checked for overflow, documented for rounding.
- `FloatCastPolicy`: `AllowRounding` (default) or `Strict`.
- Int: i64 → i32 checked, error if out of range.

### Eliminating Value::None
- No conversion may default to `Value::None`. All conversions return `Result<Value, CascadeError>`.
- No wildcard matches; adding variants forces compile errors.

### Complex param types (CurvePoints, ColorRamp, Resolution, Vec2)
- Treat as params-only (not runtime `Value` variants).
- Provide typed accessors: `ctx.param_curve_points("curve")`, `ctx.param_color_ramp("ramp")`, etc.
- Only add to `Value` if graph edges need to carry them.

---

## Migration strategy
1. Introduce `ParamDefault` alias over `ParamValue` (no serialization change).
2. Add fallible conversions; keep old functions temporarily (deprecated).
3. Convert evaluator to use fallible path everywhere.
4. Migrate nodes to typed getters incrementally.
5. Remove deprecated functions and `ParamDefault`.

---

## Step-by-step implementation checklist
- [ ] Unify `ParamDefault` as alias/newtype over `ParamValue`.
- [ ] Add validation that `ParamType` matches default `ParamValue` variant.
- [ ] Create `try_param_value_to_value() -> Result<Value, CascadeError>` with exhaustive match.
- [ ] Add `resolve_param(name) -> Result<&ParamValue, CascadeError>` (merges instance+default).
- [ ] Replace evaluator usage of old conversion functions.
- [ ] Add typed getters on `EvalContext` (f32, i32, bool, color, string, curve points, ramp, resolution).
- [ ] Update built-in nodes to use typed getters.
- [ ] Ensure bridge/serialization compatibility.
- [ ] Add unit tests (boundary values, overflow, unsupported types).
- [ ] Deprecate then delete old conversion functions and `ParamDefault`.

## Risks and mitigations
- **"Unsupported param type" errors:** make evaluator errors actionable with node/param context.
- **Precision changes:** default AllowRounding; add tests for key nodes.
- **Breaking custom nodes:** keep `ParamDefault` as deprecated alias for one release cycle.
