---
name: create-feature
description: Use when the user asks to take a feature or bug fix from prompt to implementation, especially prompts like "/create a new feature", "build this feature end-to-end", "take this from plan to PR", or "own this change through validation and handoff". This skill is for repo-local delivery workflows that must create and maintain implementation plans, choose appropriate tests, run deterministic validation, and open a draft PR against main.
---

# Create Feature

Use this skill when the user wants one agent to carry a repo change through planning, execution, validation, and PR handoff.

## What This Skill Owns

- Create and maintain an implementation plan for non-trivial work.
- Inspect the current checkout and make sure it is ready before editing.
- Implement the requested change directly unless a material product decision blocks progress.
- Add or update tests that match the changed behavior.
- Run local validation using the commands listed below.
- Open a draft PR against `main`.

## Required Reads

Before changing code, read these repo guides:

1. `AGENTS.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. Any relevant existing file under `implementation-plans/`

## Checkout Readiness

Do not create a worktree in this skill.

Instead:

1. Inspect checkout state with non-interactive Git commands.
2. If the repo is in a Git worktree, make sure that worktree is actually ready for development.
3. If the repo is in a normal checkout, continue in place.

Default readiness expectations:

- Install frontend dependencies when needed: run `yarn install` from `apps/web/`.
- Rust tooling check is only needed when the change touches `crates/` or `apps/tauri/`.

## Planning Contract

For non-trivial work, derive a concise slug from the task and create `implementation-plans/<slug>.md`.

Use the established plan format:

- `# <Title>`
- `## Goal`
- `## Approach`
- `## Affected Areas`
- `## Checklist`

Keep the checklist current while you work. Mark steps complete as soon as they are actually done using `- [x]`.

Do not create an implementation plan for narrow housekeeping work such as typo-only edits, formatting cleanup, CI fixes, or other small maintenance tasks.

## Execution Contract

After planning, implement directly unless blocked by a real product ambiguity.

Always:

- Prefer the smallest change that fully solves the task.
- Read existing patterns before introducing new ones.
- Default to GPU kernel nodes over CPU nodes for per-pixel transforms — GPU nodes are dramatically faster and simpler for these cases.
- Avoid inventing new repo workflow conventions when an existing one can be extended.
- Keep a running summary of what changed and why for the PR body.
- When you hit an architectural limitation, stop and surface it to the user rather than working around it.

## Test Expectations

Choose tests based on the changed behavior:

- Add or update Rust unit tests (`#[cfg(test)]` inline modules) for changed Rust logic.
- Add or update frontend tests for changed UI behavior.
- If no new tests are needed, be ready to justify that in the PR.

## Validation Commands

Run the appropriate subset of these commands based on what changed. Never run commands for areas the change does not touch.

### Rust (when `crates/` or `apps/tauri/` changed)

```bash
# From repo root
cargo check --workspace --exclude cascade-ocio-sys --exclude cascade-ocio --exclude cascade-tauri
cargo test --workspace --exclude cascade-ocio-sys --exclude cascade-ocio --exclude cascade-tauri
cargo clippy --workspace --exclude cascade-ocio-sys --exclude cascade-ocio --exclude cascade-tauri --all-targets -- -D warnings
cargo fmt --all -- --check
```

Note: `cascade-ocio-sys`, `cascade-ocio`, and `cascade-tauri` require system libraries not available in all environments — always exclude them unless you have confirmed the relevant libraries are installed.

### Frontend (when `apps/web/` changed)

```bash
# From apps/web/
yarn lint
npx tsc -b --noEmit
```

### WASM bridge (when `crates/cascade-wasm/` changed)

```bash
wasm-pack build crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg
```

In your final summary and PR notes, report:

- Which validations ran
- Which validations were skipped
- Why each skipped validation was not necessary

## Pull Request Handoff

Unless the user asked otherwise, open a draft PR against `main`.

Before creating the PR:

1. Confirm the working tree contains only intended changes.
2. Fill the PR body using `.github/PULL_REQUEST_TEMPLATE.md`.
3. Include the implementation plan path in the PR notes when one was created.
4. Summarize tests added, validations run, and intentionally skipped checks.

Use `gh pr create --draft --base main`.

If `gh` auth or GitHub access is unavailable, stop after local validation and report the exact blocker.

## Guardrails

- Do not create or switch worktrees from this skill.
- Do not skip the implementation plan for non-trivial work.
- Do not open the PR before required local validation succeeds.
- Do not target any base branch other than `main` unless the user explicitly says so.
- Do not use `unwrap()` or `panic!()` in library code — propagate errors with `CascadeError`.
- Do not use hardcoded hex/rgb colors in React components — use CSS custom properties from `src/styles/theme.css`.
