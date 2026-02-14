# Compositor

A node-based image compositor inspired by Nuke and Blender's compositor. Rust core compiled to WASM for the browser, with a Tauri desktop shell for native performance.

## Architecture

```
compositor/
├── crates/
│   ├── compositor-core/          # Graph engine, evaluator, node trait, type system
│   ├── compositor-nodes-std/     # 34 built-in CPU nodes + Criterion benchmarks
│   ├── compositor-gpu/           # wgpu compute shader pipeline (GLSL → naga → WGSL)
│   ├── compositor-wasm/          # wasm-bindgen bridge for browser
│   └── compositor-runtime/       # Native runtime engine (used by Tauri + CLI bench)
├── apps/
│   ├── web/                      # React + Vite + @xyflow/react frontend
│   └── tauri/                    # Tauri v2 desktop app
└── .github/workflows/ci.yml     # CI: test, lint, bench, frontend checks
```

### Core concepts

- **Image format**: f16 RGBA in linear color space. sRGB conversion happens only at I/O boundaries.
- **Graph**: SlotMap-based DAG with cycle detection, type-safe connections, and dirty propagation.
- **Evaluator**: Pull-based from viewer nodes. Per-output caching keyed on `(frame_time, param_revision, upstream_hash)`.
- **Self-describing nodes**: Each node declares its own inputs, outputs, params, and UI hints via `NodeSpec`. The frontend renders controls automatically — adding a new Rust node requires zero frontend changes.
- **GPU kernels**: Users write GLSL `process()` functions. Naga transpiles to WGSL. wgpu dispatches compute shaders. JSON manifests declare ports/params.

### Node library (34 CPU + GPU kernels)

| Category | Nodes |
|----------|-------|
| Input | LoadImage, LoadImageSequence |
| Output | Viewer, ExportImage, ExportImageSequence |
| Color | BrightnessContrast, HueSaturation, Invert, Levels, Curves, ColorBalance, ChannelShuffle, Threshold, Posterize, Gamma |
| Filter | GaussianBlur, Sharpen, EdgeDetect, Dilate, Erode, Median |
| Composite | Blend (11 modes), AlphaOver |
| Transform | Resize, Crop, Flip, Rotate, Translate |
| Generator | SolidColor, Noise, Gradient, Checkerboard |
| Matte | Premultiply, Unpremultiply, SetAlpha, ExtractChannel, ChromaKey |
| GPU | Pixelate, Dither, user-defined via JSON manifests |

## Getting started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 22+
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (for browser builds)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (for desktop builds)

### Web (WASM)

```bash
# Build the WASM bridge
wasm-pack build crates/compositor-wasm --target web --out-dir ../../apps/web/src/wasm-pkg

# Install frontend dependencies and start dev server
cd apps/web
yarn install
yarn dev
```

### Desktop (Tauri)

```bash
cd apps/tauri/src-tauri
cargo tauri dev
```

### Run tests

```bash
# Rust tests (all crates)
cargo test --workspace

# Frontend lint + typecheck
cd apps/web
yarn lint
npx tsc -b --noEmit
```

### Run benchmarks

```bash
# Criterion benchmarks (compositor-nodes-std)
cargo bench --package compositor-nodes-std

# CLI benchmark tool (compositor-runtime)
cargo run --release --bin compositor-bench -- --input-dir <path-to-frames>
```

## CI

A single GitHub Actions workflow runs on push to `main` and on PRs:

| Job | What it checks |
|-----|----------------|
| **Rust Check & Test** | `cargo check --workspace` + `cargo test --workspace` |
| **Rust Lint** | `cargo clippy` (warnings = errors) + `cargo fmt --check` |
| **Benchmarks** | `cargo bench --no-run` (compile check only) |
| **Frontend** | `tsc --noEmit` + `eslint` |

## License

MIT
