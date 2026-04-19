# Cascade macOS DMG Release Process

## Goal

Add a production-ready macOS desktop release flow for Cascade with protected-branch release prep, signed and notarized DMG artifacts for Apple Silicon and Intel, public download surfaces, Homebrew cask updates, and a dedicated Codex release skill.

## Approach

- Add repo-level release metadata and version tracking that can be validated from a tagged commit.
- Introduce a two-step `scripts/release.sh` workflow for preparing and publishing releases against the canonical `cascade` remote and GitHub repo.
- Add a tag-driven GitHub Actions release pipeline that validates versions, builds signed/notarized DMGs, creates the GitHub Release, and updates the Homebrew cask.
- Update the Tauri desktop config and the web UI so the macOS release artifacts are visible and consumable from both docs and the product shell.
- Add a repo-owned `cascade-release` skill and install the same skill into `$CODEX_HOME/skills`.

## Affected Areas

- `package.json`
- `apps/web/package.json`
- `README.md`
- `scripts/`
- `.github/workflows/`
- `apps/tauri/src-tauri/`
- `apps/web/src/`
- `.agents/skills/`
- `$CODEX_HOME/skills/`
- `AGENTS.md`

## Checklist

- [x] Add release metadata and version tracking (`CHANGELOG.md`, package versions, version consumer updates)
- [x] Add `scripts/release.sh` and `scripts/README.md`
- [x] Add the GitHub Actions macOS release workflow
- [x] Add Tauri macOS entitlements and bundle config
- [x] Add README and in-app desktop download surfaces
- [x] Add the repo-local and installed `cascade-release` skill
- [x] Update `AGENTS.md` with release-skill guidance
- [x] Run targeted validation and review final diffs
