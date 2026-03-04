# Cascade

A node-based image processing application inspired by Nuke and Blender's processor. Rust core compiled to WASM for the browser, with a Tauri desktop shell for native performance.

A node-based image processor inspired by Nuke and Blender's processor. Rust core compiled to WASM for the browser, with a Tauri desktop shell for native performance.

## Architecture

```
cascade/
├── crates/
│   ├── cascade-core/          # Graph engine, evaluator, node trait, type system
│   ├── cascade-nodes-std/     # 34 built-in CPU nodes + Criterion benchmarks
│   ├── cascade-gpu/           # wgpu compute shader pipeline (GLSL → naga → WGSL)
│   ├── cascade-ocio/          # OpenColorIO integration (display/view transforms)
│   ├── cascade-ocio-sys/      # OpenColorIO C FFI bindings (auto-stubs if not installed)
│   ├── cascade-wasm/          # wasm-bindgen bridge for browser
│   └── cascade-runtime/       # Native runtime engine (used by Tauri + CLI bench)
├── crates/
│   ├── cascade-core/          # Graph engine, evaluator, node trait, type system
│   ├── cascade-nodes-std/     # 34 built-in CPU nodes + Criterion benchmarks
│   ├── cascade-gpu/           # wgpu compute shader pipeline (GLSL → naga → WGSL)
│   ├── cascade-ocio/          # OpenColorIO integration (display/view transforms)
│   ├── cascade-ocio-sys/      # OpenColorIO C FFI bindings (auto-stubs if not installed)
│   ├── cascade-wasm/          # wasm-bindgen bridge for browser
│   └── cascade-runtime/       # Native runtime engine (used by Tauri + CLI bench)
├── apps/
│   ├── web/                      # React + Vite + @xyflow/react frontend
│   └── tauri/                    # Tauri v2 desktop app
└── .github/workflows/ci.yml     # CI: test, lint, bench, frontend checks
```

### Core concepts

- **Image format**: f32 RGBA in linear color space. sRGB conversion happens only at I/O boundaries. f16 is used only for GPU upload/readback.
- **Graph**: SlotMap-based DAG with cycle detection, type-safe connections, and dirty propagation.
- **Evaluator**: Pull-based from viewer nodes. Per-output caching keyed on `(frame_time, param_revision, upstream_hash)`.
- **Self-describing nodes**: Each node declares its own inputs, outputs, params, and UI hints via `NodeSpec`. The frontend renders controls automatically — adding a new Rust node requires zero frontend changes.
- **GPU kernels**: Users write GLSL `process()` functions. Naga transpiles to WGSL. wgpu dispatches compute shaders. JSON manifests declare ports/params.
- **Color management**: Pluggable `ColorManagement` trait with a builtin sRGB implementation and optional OpenColorIO backend. All compositing happens in linear working space; display/view transforms are applied only at the viewer output. Configure via Settings → Color in the UI.

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
- [OpenColorIO](https://opencolorio.org/) v2 (for color management in the desktop app)

### Color management setup (macOS)

The desktop app uses OpenColorIO for color management. Install it and set up an OCIO config:

```bash
# Install OpenColorIO
brew install opencolorio

# Create a config directory and download the ACES CG config
mkdir -p ~/.config/ocio
python3 -c "
import PyOpenColorIO as ocio
c = ocio.Config.CreateFromBuiltinConfig('cg-config-v2.1.0_aces-v1.3_ocio-v2.3')
with open('$HOME/.config/ocio/config.ocio', 'w') as f:
    f.write(c.serialize())
"

# Add to your shell config (~/.zshrc)
export OCIO="$HOME/.config/ocio/config.ocio"
```

The `$OCIO` environment variable tells the desktop app which config to load at startup. If it's not set or OpenColorIO isn't installed, the app falls back to builtin sRGB color management.

You can use any OCIO v2 config — ACES CG is a good default. Studio-specific configs work as well.

### Web (WASM)

```bash
# Build the WASM bridge
wasm-pack build crates/cascade-wasm --target web --out-dir ../../apps/web/src/wasm-pkg

# Install frontend dependencies and start dev server
cd apps/web
yarn install
yarn dev
```

The WASM build uses builtin color management only (no OCIO).

### Desktop (Tauri)

```bash
cd apps/tauri/src-tauri
cargo tauri dev
```

### AI nodes (Replicate)

AI-powered nodes (Depth Estimate, Inpaint) use the [Replicate](https://replicate.com) API. To enable them locally:

1. Create a Replicate account and get an API token from https://replicate.com/account/api-tokens
2. Start the dev server (`yarn dev`) — the Vite config proxies `/api/replicate/*` to Replicate's API to avoid browser CORS restrictions
3. In the app, go to **Settings → AI** and paste your Replicate API token
4. Add an AI node (e.g. AI Depth Estimate), connect an input image, and click **Run**

The Tauri desktop app calls Replicate directly and does not need the proxy.

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
# Criterion benchmarks (cascade-nodes-std)
cargo bench --package cascade-nodes-std

# CLI benchmark tool (cascade-runtime)
cargo run --release --bin cascade-bench -- --input-dir <path-to-frames>
cargo bench --package cascade-nodes-std

# CLI benchmark tool (cascade-runtime)
cargo run --release --bin cascade-bench -- --input-dir <path-to-frames>
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
