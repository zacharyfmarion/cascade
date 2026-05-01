---
name: cascade-release
description: Use when the user wants to prepare or publish a Cascade release, especially prompts like "release version 0.10.0", "prepare the next release", "publish the merged release tag", or "write the changelog for the next release". This skill drives the protected-branch release workflow with scripts/release.sh and local macOS DMG publishing.
---

# Cascade Release

Use this skill only in a Cascade repository checkout.

## What This Skill Does

- Prepares a release PR with version bumps and a changelog entry.
- Publishes a merged release by tagging the exact merge commit.
- Builds, signs, notarizes, staples, verifies, uploads, and Homebrew-publishes macOS DMGs locally from a Mac.
- Drafts a clean changelog section when the user does not provide one.

## Release Commands

- Prepare: `./scripts/release.sh prepare <version> --notes-file <path> --yes`
- Publish from a local Mac: `./scripts/release.sh publish <version> --env-file .env.release.local`

Read `scripts/README.md` if the workflow needs clarification.

## Workflow

1. Confirm you are in a Cascade repository checkout.
2. Inspect repo state before acting:
   - `git status --short --branch`
   - `git tag --list "v<version>"`
   - `gh pr list --repo zacharyfmarion/cascade --state all --base main --head "release/v<version>" --json number,state,isDraft,mergeStateStatus,url`
3. Choose the action:
   - If tag `v<version>` already exists, do not prepare or publish again; report the existing release state.
   - If a merged PR exists for `release/v<version>` and the tag does not exist, run `publish` from a local Mac.
   - Otherwise, run `prepare`.
4. For `prepare`, create release notes in a temporary Markdown file and pass them with `--notes-file ... --yes`.
5. After `prepare`, report the PR URL and clearly say that merge is still required before publish.
6. For `publish`, make sure `.env.release.local` exists or the equivalent values are already exported from the user's password manager:
   - `APPLE_SIGNING_IDENTITY`
   - `APPLE_ID`
   - `APPLE_PASSWORD`
   - `APPLE_TEAM_ID`
   - `HOMEBREW_TAP_TOKEN`
   - optional `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` when the signing certificate is not already installed locally.
7. After `publish`, report the tagged version, GitHub Release artifact upload, and Homebrew update. GitHub Actions validates the tag only; it does not build DMGs.

## Changelog Format

Unless the user explicitly wants a different format, write release notes in this shape:

```markdown
### Added
- ...

### Changed
- ...

### Fixed
- ...
```

Rules:

- Omit empty sections instead of leaving placeholders.
- Keep bullets concise and user-facing.
- Group by product outcome, not by internal refactor.
- Use the user's supplied notes verbatim when they are already well-structured.
- If the user gives rough notes, rewrite them into clean release-note bullets before calling the script.

## How To Draft Notes

- If the user provides exact changelog content, use that.
- If the user provides rough themes only, rewrite them into the standard sections above.
- If the user provides no changelog details, inspect recent changes since the latest tag with git history and changed files, then draft notes conservatively.
- Prefer visible product changes, fixes, workflow changes, and compatibility notes over internal implementation details.

Useful commands:

- `git tag --list 'v*' --sort=-version:refname | head`
- `git log --oneline <last-tag>..HEAD`
- `git diff --stat <last-tag>..HEAD`

## Temporary Notes File

Create the changelog body in a temp file, then pass that file to the script. Example pattern:

```bash
tmpfile="$(mktemp)"
cat > "$tmpfile" <<'EOF'
### Added
- Example item

### Fixed
- Example fix
EOF
./scripts/release.sh prepare 0.10.0 --notes-file "$tmpfile" --yes
rm -f "$tmpfile"
```

## Safety Checks

- Do not run `prepare` or `publish` if the working tree is dirty; surface the problem first.
- Do not try to bypass branch protection or push directly to `main`.
- Do not publish a tag if the release PR has not been merged.
- Do not expect GitHub Actions to build macOS DMGs; release DMGs are local Mac artifacts.
- Do not silently invent changelog claims that are not supported by recent repo changes or user instructions.
