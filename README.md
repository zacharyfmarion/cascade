# Cascade

Cascade is a node-based image processing application built around a Rust graph engine with a React frontend.
The project is being opened up web-first: the browser app is the primary supported target today, while the Tauri desktop shell is still catching up to feature parity.

## Status

- Web: active development target and the best place to evaluate the project today
- Desktop: usable for development work, but not yet at parity with the web app
- AI features: optional, bring-your-own-key integrations for supported providers

This repository is intended for contributors and early adopters who are comfortable working in a fast-moving codebase.

## What Cascade Does

- Builds image processing pipelines as typed node graphs
- Evaluates graphs through a Rust core shared by web and desktop frontends
- Renders node controls from backend `NodeSpec` metadata
- Supports CPU nodes today and GPU-backed execution paths where available
- Handles still-image workflows, graph editing, playback-oriented nodes, and scripted GPU kernels

## Architecture

```text
cascade/
├── crates/
│   ├── cascade-core/       # Graph engine, evaluator, type system, node traits
│   ├── cascade-nodes-std/  # Built-in CPU nodes and benchmarks
│   ├── cascade-gpu/        # wgpu compute pipeline and kernel runtime
│   ├── cascade-wasm/       # wasm-bindgen bridge used by the web app
│   ├── cascade-runtime/    # Native runtime used by desktop and CLI tooling
│   ├── cascade-ocio/       # Optional OpenColorIO integration
│   ├── cascade-ocio-sys/   # OpenColorIO FFI bindings
│   └── cascade-video/      # Video I/O support
├── apps/
│   ├── web/                # React + Vite + Zustand + React Flow frontend
│   └── tauri/              # Tauri desktop shell
├── docs/                   # Architecture and design notes
└── .github/workflows/ci.yml
```

## Web-First Quick Start

### Prerequisites

- Rust stable via [rustup](https://rustup.rs/)
- Node.js 22+
- `wasm-pack`
- Nightly Rust with `rust-src` if you want the threaded WASM build

### Run The Web App

```bash
yarn install
cd apps/web
yarn dev
```

The web app's `predev` hook builds both WASM bundles automatically.

### Useful Commands

From the repository root:

```bash
yarn install
yarn workspace web lint
yarn workspace web lint:css
yarn workspace web test
```

From `apps/web/`:

```bash
yarn build:wasm
yarn dev
npx playwright test
```

From the repository root for Rust validation:

```bash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

## Deployment Notes For Web

- Cascade ships both single-threaded and threaded WASM bundles.
- Threaded WASM requires `SharedArrayBuffer`, which in practice means serving the app with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
- If those headers are unavailable, the app falls back to the single-threaded engine automatically.
- The repository's current contributor workflow is strongest for local development and CI. Hosted deployment guidance will continue to evolve as the web release hardens.

## AI Integrations

AI-powered workflows are optional.

- Replicate-backed nodes use a user-supplied API token
- The AI assistant uses a user-supplied Anthropic API key
- In the web app, those settings are stored locally in the browser for the current user profile

If you do not want to use AI features, you can ignore them entirely.

## Desktop Status

The desktop app remains in the repository because it shares the same core engine and is an active part of the roadmap.
That said, the web app is the better target for evaluation, contribution, and first release feedback right now.

If you are looking for the most complete experience today, start with [`apps/web`](./apps/web/README.md).

## Contributing

Contributions are welcome.
Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and workflow guidance.

## Community

Please read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating in discussions or pull requests.

## License

Cascade is released under the MIT License.
See [LICENSE](./LICENSE) for details.
