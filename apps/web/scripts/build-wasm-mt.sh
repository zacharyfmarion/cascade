#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${WEB_DIR}"

THREAD_WASM_FLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals"
THREAD_LINK_FLAGS="-C link-arg=--shared-memory -C link-arg=--max-memory=1073741824 -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base"
THREAD_BUILD_FLAGS="${THREAD_WASM_FLAGS} ${THREAD_LINK_FLAGS}"

# Preserve any caller-provided flags such as CI's RUSTFLAGS=-Dwarnings.
export RUSTFLAGS="${RUSTFLAGS:+${RUSTFLAGS} }${THREAD_BUILD_FLAGS}"
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="${CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS:+${CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS} }${THREAD_BUILD_FLAGS}"
export RUSTUP_TOOLCHAIN=nightly
export CARGO_UNSTABLE_BUILD_STD=std,panic_abort

exec wasm-pack build ../../crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg-threads --features wasm-threads
