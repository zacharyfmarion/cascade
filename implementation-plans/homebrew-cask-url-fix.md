# Homebrew Cask URL Fix

## Goal

Fix the generated Homebrew cask so `brew install --cask cascade` receives a valid DMG URL, and prevent future releases from publishing a cask for an inaccessible release asset.

## Approach

- Generate a concrete versioned release-asset URL in the cask instead of escaped Ruby interpolation.
- Add a public asset accessibility preflight before pushing Homebrew tap updates.
- Add a focused shell regression test for the generated cask URL.
- Repair the current live Homebrew tap cask when access allows.

## Affected Areas

- `scripts/local-macos-release.sh`
- `scripts/test-local-macos-release.sh`
- `scripts/README.md`
- `implementation-plans/homebrew-cask-url-fix.md`
- `zacharyfmarion/homebrew-cascade` live tap, if push access is available

## Checklist

- [x] Patch the cask generator
- [x] Add regression validation for cask URL generation
- [x] Run targeted shell validations
- [x] Repair the live Homebrew tap cask
- [x] Commit, push, and open a draft PR
