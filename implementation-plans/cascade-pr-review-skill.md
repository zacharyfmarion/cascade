# Cascade PR Review Skill

## Goal

Create a repo-local PR review skill that helps agents review Cascade pull requests with project-specific judgment around correctness, DSL parity, architecture quality, error handling, analytics, tests, and validation.

## Approach

- Add `cascade-pr-review` as an instruction-only skill under `.agents/skills/`.
- Generate the standard `agents/openai.yaml` metadata for Codex UI discovery.
- Expose the same skill to Claude Code through a `.claude/skills/` symlink so `.agents/skills/` remains the source of truth.
- Validate the skill structure and symlink behavior without running unrelated Rust or frontend checks.

## Affected Areas

- `.agents/skills/cascade-pr-review/`
- `.claude/skills/cascade-pr-review`
- `implementation-plans/cascade-pr-review-skill.md`

## Checklist

- [x] Create the implementation plan.
- [x] Initialize the `cascade-pr-review` skill folder.
- [x] Write Cascade-specific PR review instructions.
- [x] Generate or update `agents/openai.yaml`.
- [x] Add the Claude Code symlink.
- [x] Run skill validation and symlink checks.
- [x] Prepare the branch for draft PR handoff.
