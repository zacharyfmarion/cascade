---
name: cascade-pr-review
description: Use when reviewing Cascade pull requests, local branches, local diffs, or proposed fixes for correctness, architecture fit, DSL parity, error handling, analytics coverage, tests, and validation gaps. Trigger for prompts like "review this Cascade PR", "review this branch", "check this local diff", "is this a band-aid?", or "look for architectural issues in this change".
---

# Cascade PR Review

Use this skill to review Cascade changes. Stay in code-review mode: identify bugs, regressions, architectural risks, missing tests, and validation gaps. Do not implement fixes unless the user explicitly switches from review to execution.

## Required Reads

Before forming findings:

1. Read `AGENTS.md`.
2. Read `.github/PULL_REQUEST_TEMPLATE.md`.
3. Inspect the PR metadata and changed files when given a PR number or URL.
4. Otherwise inspect the local diff against `main`.
5. Read relevant files in `implementation-plans/` when the diff touches a planned feature, DSL behavior, architecture, analytics, release, or error handling.

Useful reference plans include:

- `implementation-plans/dsl-production-readiness.md`
- `implementation-plans/dsl-semantic-equivalence-tests.md`
- `reviews/error-handling-plan.md`
- `reviews/architecture-review-2-22-26.md`
- `implementation-plans/posthog-observability-node-graph.md`

## Review Workflow

1. Build a short risk map from the changed files: Rust core/nodes/GPU/WASM/Tauri, frontend store/UI, DSL/AI tools, project serialization, analytics, tests/CI, or docs-only.
2. Trace changed behavior path-by-path. Prefer concrete execution paths over broad commentary.
3. Look for user-visible regressions first, then architecture issues, then missing tests or validation.
4. For actionable findings in Codex Desktop, emit `::code-comment{...}` with tight line ranges.
5. In the final review, list findings first, ordered by severity. Then include open questions or assumptions, followed by a brief validation/test gap summary.
6. If there are no findings, say that clearly and name any residual risk.

## Cascade Rubric

### DSL Parity

New graph or node functionality must work through direct node editing and through DSL/AI editing. Review both routes when relevant:

- Inspector/canvas/store actions and DSL `applyDsl()` should produce equivalent graph behavior.
- Check parser, serializer, validator, differ, executor, semantic validator, source maps, and DSL shadow/save-load behavior when touched.
- Check AI tool guidance and system prompt updates when the assistant can create or edit the feature.
- Demand focused DSL tests, especially semantic-equivalence tests, when a change affects graph semantics, node params, custom groups, GPU scripts, assets, or save/load.
- Flag changes that work from the UI but cannot be expressed, round-tripped, applied, or diagnosed through DSL.

### Architecture Quality

Cascade prefers the architecturally correct fix over a local band-aid. Flag:

- Duplicated graph truth or state that can drift from engine/store/DSL state.
- Bypassing `NodeSpec`, Zustand store actions, the engine bridge, or established mutation paths.
- Component-level engine calls or direct runtime mutations that skip undo, render, DSL shadow, or error handling.
- Silent fallback behavior that hides missing engine/type-system/runtime capability.
- Special cases that should be represented as a type-system, evaluator, resource, or bridge capability instead.
- Refactors that partially split a system but leave two live sources of truth.

When the correct fix needs a larger refactor, say so directly and explain why the smaller patch is insufficient.

### Error Handling

Error handling is a first-class review surface:

- Rust library code must propagate `CascadeError`; production paths must not use `unwrap()`, `expect()`, or `panic!()`.
- WASM bridge functions must return `Result<_, JsValue>` and use `map_err(to_engine_error)?`; do not allow `unwrap_or(JsValue::NULL)` or null sentinels for failures.
- Frontend engine/render/eval failures should flow as structured `EngineError` objects through bridge, store, and UI.
- Only Zustand store boundaries should catch engine exceptions. Components and hooks should not swallow engine errors.
- Flag empty `catch {}`, `catch { return null }`, default-value masking, or silent degraded behavior unless it is intentional, logged, and user-safe.
- Require tests for failure paths when the change introduces new parsing, I/O, engine, bridge, render, save/load, or analytics behavior.

### Analytics

Major feature additions and new user-facing workflows should include privacy-safe analytics or explicitly justify deferral:

- Use the existing PostHog runtime helpers and consent behavior.
- Capture high-signal events, not noisy internal implementation details.
- Never capture graph parameter values, prompts, API keys, file paths, image data, user content, or secrets.
- Update analytics tests and `docs/analytics.md` or the relevant analytics contract when event names or properties change.
- Flag analytics added outside the shared runtime helpers or without opt-out/disabled behavior.

### Rust And Image Processing

Check that Rust changes preserve Cascade invariants:

- Pixel processing uses linear `f32` RGBA; sRGB conversion belongs only at load/display boundaries.
- Pixel-space params respect `ctx.preview_scale`; GPU manifests should list pixel-space params for automatic scaling.
- Per-pixel operations should default to GPU kernels unless GPU is unsuitable; CPU pixel loops should use Rayon patterns.
- Image constructors return `Result` and errors are propagated with `?`.
- New nodes declare complete `NodeSpec` inputs, outputs, params, defaults, and UI hints, then register cleanly.
- Evaluator, cache, dirty propagation, and connection type checks should remain deterministic and safe.

### Frontend

Check that frontend changes follow the existing architecture:

- Store actions live in slice files, not `store.ts`; shared mutable runtime state belongs in `kernel.ts`.
- Mutations sync to the engine first, then update local state.
- Param changes go through `graphStore.setParam()` or the live/commit param controller paths.
- UI controls should be driven by `NodeSpec` metadata unless a custom component is truly required.
- Components use theme CSS variables, not hardcoded hex/rgb colors.
- User-facing workflows should have ergonomic UI states, loading/error states, and focused tests when behavior changes.

### Testing And Validation

Match test expectations to risk:

- Rust engine/node behavior: unit tests and relevant workspace checks.
- WASM bridge changes: wasm build and bridge error-path tests where feasible.
- Frontend/store/UI behavior: Vitest/component tests, lint, typecheck, CSS lint when styles change.
- DSL behavior: parser/serializer/validator/differ/executor tests and semantic-equivalence coverage.
- Tauri-sensitive changes: `cargo check -p cascade-tauri` when touched or when dependent crates change.
- Analytics behavior: runtime/helper tests and payload privacy checks.

Flag PRs whose validation notes do not cover the surfaces actually changed.

## Output Format

Lead with findings. Use severity-oriented titles and tight references:

```text
Findings
- [P1] Title
  File/line: ...
  Why this matters: ...

Open Questions
- ...

Validation Gaps
- ...
```

If using Codex Desktop inline comments, emit one `::code-comment{...}` per actionable finding and keep the final response concise.
