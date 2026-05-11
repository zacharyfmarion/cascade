# Release Scripts

This directory contains scripts to help with the Cascade release process.

## `release.sh`

`release.sh` uses a protected-branch-friendly two-step flow so production desktop
releases can be prepared safely and published only after the release PR is
merged to `main`.

### Prerequisites

Before running the release script, ensure you have:

1. **GitHub CLI (`gh`)** installed and authenticated:
   ```bash
   brew install gh
   gh auth login
   ```
2. **`jq`** for JSON processing:
   ```bash
   brew install jq
   ```
3. **Node.js and Yarn** available:
   ```bash
   node --version
   yarn --version
   ```
4. **Rust toolchain** available so `Cargo.lock` can be refreshed:
   ```bash
   rustc --version
   cargo --version
   ```
5. **A clean working directory** with no uncommitted or untracked files.
6. **The canonical release remote** configured locally. By default the script
   uses:
   - `RELEASE_GITHUB_REPO=zacharyfmarion/cascade`
   - `RELEASE_REMOTE=cascade`

### Usage

Prepare the release PR:

```bash
./scripts/release.sh prepare 0.10.0
```

After that PR is merged to `main`, publish the release from a local Mac:

```bash
./scripts/release.sh publish 0.10.0
```

`publish` now builds, signs, notarizes, staples, and verifies the macOS DMG
locally before pushing the tag. After the tag is pushed, it creates or updates
the GitHub Release and updates the Homebrew cask from the same local artifacts.

For automation, `prepare` also supports non-interactive changelog input:

```bash
./scripts/release.sh prepare 0.10.0 --notes-file /tmp/release-notes.md --yes
./scripts/release.sh prepare 0.10.0 --notes "### Added\n- Example" --yes
cat /tmp/release-notes.md | ./scripts/release.sh prepare 0.10.0 --notes-stdin --yes
```

### `prepare`

The `prepare` command will:

1. Verify required tools, remote configuration, and repository state.
2. Fetch `cascade/main` by default.
3. Create `release/vX.Y.Z` from that remote branch.
4. Collect release notes.
5. Update:
   - `package.json`
   - `apps/web/package.json`
   - `apps/tauri/src-tauri/Cargo.toml`
   - `apps/tauri/src-tauri/tauri.conf.json`
   - `Cargo.lock`
   - `CHANGELOG.md`
6. Commit the bump as `chore: prepare release vX.Y.Z`.
7. Push the release branch to the configured release remote.
8. Open a PR to `main` with `gh pr create`.

### `publish`

The `publish` command will:

1. Fetch the configured release remote’s `main` branch and tags.
2. Find the merged PR for `release/vX.Y.Z`.
3. Resolve the PR merge commit.
4. Verify that commit is reachable from `main`.
5. Verify the tagged commit contains matching release versions in the tracked
   version files.
6. Verify `CHANGELOG.md` contains a non-empty `X.Y.Z` entry.
7. Build signed and notarized local macOS artifacts from the verified merge
   commit in a temporary worktree.
8. Create and push the annotated tag `vX.Y.Z`.
9. Create or update the GitHub Release using the matching `CHANGELOG.md` entry
   as the release body.
10. Update the Homebrew cask in `zacharyfmarion/homebrew-cascade`.

GitHub Actions now validates release tags only. It intentionally does not build
DMGs or use Apple-hosted runners.

Useful `publish` options:

```bash
./scripts/release.sh publish 0.10.0 --env-file .env.release.local
./scripts/release.sh publish 0.10.0 --skip-deps
./scripts/release.sh publish 0.10.0 --skip-homebrew
./scripts/release.sh publish 0.10.0 --skip-local-build
```

Use `--skip-local-build` only for recovery. It pushes the verified tag without
creating release artifacts, then prints the local command needed to finish.

### Local macOS Artifact Builder

`scripts/local-macos-release.sh` is the lower-level local equivalent of the old
macOS GitHub Actions build job.

```bash
./scripts/local-macos-release.sh build 0.10.0 --source-ref v0.10.0
./scripts/local-macos-release.sh publish-artifacts 0.10.0 --source-ref v0.10.0
./scripts/local-macos-release.sh all 0.10.0 --source-ref v0.10.0
```

The script:

1. Creates a temporary Git worktree at the requested release ref.
2. Installs required Rust targets/tooling unless `--skip-deps` is passed.
3. Runs `yarn install --immutable`.
4. Builds the WASM bundles.
5. Builds the signed Tauri app bundle.
6. Creates, signs, notarizes, staples, mounts, and verifies the DMG.
7. Writes versioned and stable artifacts to
   `target/release-artifacts/vX.Y.Z/`.
8. Uploads artifacts to GitHub Releases and updates Homebrew when requested.

The Homebrew update verifies that the versioned DMG URL is publicly accessible
before pushing the tap change. A public tap cannot install a cask whose DMG lives
behind private GitHub release permissions.

### Example Release Notes Format

When prompted for release notes, use Markdown in this shape:

```markdown
### Added

- New desktop capability

### Changed

- Improved existing workflow

### Fixed

- Resolved a user-facing bug
```

### Production Release Secrets

Local release secrets should live in `.env.release.local`, copied from
`.env.release.example`. That file is ignored and should be populated from your
password manager before a local publish.

Required values:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `HOMEBREW_TAP_TOKEN`

Optional values, only needed when the Developer ID certificate is not already
installed in the local login keychain:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`

These releases are intended for **public GA distribution**, not ad-hoc local
desktop bundles. Do not commit `.env.release.local` or paste these secrets into
release notes, PRs, or CI logs.

### Troubleshooting

**"`gh` is required"**

- Install with `brew install gh`
- Authenticate with `gh auth login`

**"Git remote 'cascade' is not configured"**

- Add the canonical remote:
  ```bash
  git remote add cascade https://github.com/zacharyfmarion/cascade.git
  ```
- Or override the script:
  ```bash
  RELEASE_REMOTE=my-remote ./scripts/release.sh prepare 0.10.0
  ```

**"You have uncommitted or untracked changes"**

- Commit, stash, or clean the working tree before running `prepare` or `publish`

**"Expected exactly one merged PR"**

- Make sure the `release/vX.Y.Z` PR exists and has been merged to `main`

**"Tagged commit version mismatch"**

- Verify the merged release PR updated all tracked version sources before
  running `publish`

**"Release asset is not publicly accessible"**

- Make sure the release DMG is available to unauthenticated users before
  publishing the public Homebrew cask.
- If the source repository must remain private, upload the DMG to public hosting
  and update the cask URL strategy before running the Homebrew update.

### Manual Fallback

If you need to recover manually:

1. Create a release branch from `main`
2. Update the release version files and `CHANGELOG.md`
3. Open and merge the release PR
4. Create the annotated tag on the merged release commit:
   ```bash
   git tag -a vX.Y.Z <merge-commit-sha> -m "Release vX.Y.Z"
   git push cascade refs/tags/vX.Y.Z
   ```
