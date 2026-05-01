# Local macOS Release Builds

## Goal

Move signed and notarized macOS DMG production out of GitHub Actions so a release agent can run the same build/package/upload flow locally on a Mac, using local release secrets from an ignored env file.

## Approach

- Add a local macOS release script that checks out the tagged release source in a temporary worktree, builds WASM and the Tauri app, signs the app and DMG, notarizes and staples the DMG, verifies the mounted artifact, and prepares versioned plus stable filenames.
- Extend `scripts/release.sh publish` so it builds local artifacts from the verified merge commit before pushing the tag, then creates or updates the GitHub Release and Homebrew cask locally after the tag is pushed.
- Replace the GitHub Actions macOS build/release jobs with tag validation only, avoiding Apple-hosted runners for DMG production.
- Document the local secret env file shape and update the release-agent guidance.

## Affected Areas

- `scripts/local-macos-release.sh`
- `scripts/release.sh`
- `scripts/README.md`
- `.github/workflows/release.yml`
- `.env.release.example`
- `.agents/skills/cascade-release/SKILL.md`
- `AGENTS.md`

## Checklist

- [x] Add local macOS build/upload script
- [x] Wire `release.sh publish` to local build and artifact publishing
- [x] Replace GitHub Actions macOS packaging with validation-only workflow
- [x] Document local secrets and updated release commands
- [x] Update release-agent instructions
- [x] Run shell syntax validation and review diffs
