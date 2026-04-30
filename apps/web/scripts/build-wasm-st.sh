#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${WEB_DIR}"

OUT_DIR="${WEB_DIR}/src/wasm-pkg"
rm -rf "${OUT_DIR}"

exec wasm-pack build ../../crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg
