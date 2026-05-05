#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/local-macos-release.sh
source "$SCRIPT_DIR/local-macos-release.sh"

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/cascade-release-test.XXXXXX")
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

cask_path="$tmp_dir/cascade.rb"
write_homebrew_cask \
    "0.2.1" \
    "c17cae83ba20abcfd175dd8c68780d378dd1f9f5fd3ea45470b96b9c46c91135" \
    "aarch64" \
    "$cask_path"

if grep -F '\\#{version}' "$cask_path" >/dev/null || grep -F '#{version}' "$cask_path" >/dev/null; then
    echo "Generated cask must not contain Ruby version interpolation" >&2
    exit 1
fi

grep -F 'url "https://github.com/zacharyfmarion/cascade/releases/download/v0.2.1/Cascade_0.2.1_aarch64.dmg",' "$cask_path" >/dev/null
grep -F 'homepage "https://github.com/zacharyfmarion/cascade"' "$cask_path" >/dev/null

ruby -e 'require "uri"; path = ARGV.fetch(0); url = File.read(path).match(/url "([^"]+)"/)[1]; URI.parse(url)' "$cask_path"

echo "OK: local macOS release script tests passed"
