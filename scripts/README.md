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

After that PR is merged to `main`, publish the release:

```bash
./scripts/release.sh publish 0.10.0
```

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
7. Create and push only the annotated tag `vX.Y.Z`.

Pushing that tag triggers GitHub Actions to:

1. Validate the tagged commit.
2. Build and notarize macOS DMGs for Apple Silicon and Intel.
3. Create the GitHub Release using the matching `CHANGELOG.md` entry as the
   release body.
4. Update the Homebrew cask in `zacharyfmarion/homebrew-cascade`.

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

The tag-driven GitHub Actions release workflow expects these repository secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `HOMEBREW_TAP_TOKEN`

These releases are intended for **public GA distribution**, not ad-hoc local
desktop bundles.

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
