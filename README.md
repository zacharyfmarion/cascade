<p align="center">
  <img src="apps/tauri/src-tauri/icons/128x128.png" alt="Cascade" width="128" height="128">
</p>

<h1 align="center">Cascade</h1>

<p align="center">
  <strong>Node-based image processing for the web and desktop</strong>
</p>

<p align="center">
  <a href="https://cascade-editor.pages.dev"><img src="https://img.shields.io/badge/Web-Try_Now-brightgreen.svg" alt="Try Now"></a>
  <img src="https://img.shields.io/github/v/release/zacharyfmarion/cascade?display_name=tag" alt="Latest Release">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8DB.svg" alt="Tauri">
  <img src="https://img.shields.io/badge/React-19-61DAFB.svg" alt="React">
  <img src="https://img.shields.io/badge/Rust-stable-f74c00.svg" alt="Rust">
</p>

---

## 🔩 What It Is

Cascade is a free node-based image editor. Wire nodes together to build reusable editing pipelines, then apply them to any image. It runs entirely in your browser — no install needed — and ships as a macOS desktop app for users who want native filesystem access.

## ✨ Features

### Graph Editor
- **Visual node graph** — Connect typed inputs and outputs; cycles are rejected and dirty propagation flows downstream automatically
- **Type-checked connections** — The engine enforces connection types at the graph level, not just in the UI
- **GPU-accelerated nodes** — Per-pixel transforms run as wgpu compute shaders via GLSL kernel manifests; CPU fallback when GPU is unavailable

### Image Processing
- **Built-in nodes** — Color correction, blending, filters, resize, alpha compositing, sRGB conversion, and more
- **Linear color pipeline** — All processing in linear f32 RGBA; sRGB conversion only at I/O boundaries
- **Scripted GPU kernels** — Register custom GLSL kernels via JSON manifests without writing Rust

### AI Integrations
- **Replicate-backed nodes** — Use Replicate models as processing nodes with a user-supplied API token
- **AI assistant** — In-app assistant powered by a user-supplied Anthropic API key
- All AI features are optional and bring-your-own-key; ignore them entirely if you do not need them

### Platform
- **Web** — Runs in the browser via WebAssembly; ships both single-threaded and threaded WASM bundles
- **Desktop (macOS)** — Native app via Tauri with filesystem access, native packaging, and Tauri shell features
- **Shared core** — Web and desktop targets share the same Rust engine

## 📦 Installation

### Web

The web app is the fastest way to evaluate Cascade. No installation required — the engine runs via WebAssembly in your browser.

**Deployment note:** The threaded WASM bundle requires `SharedArrayBuffer`, which means serving the app with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without those headers the app falls back to the single-threaded engine automatically.

### Desktop (macOS)

Install via Homebrew:

```bash
brew tap zacharyfmarion/homebrew-cascade
brew install --cask cascade
```

Or download the latest signed DMG from [GitHub Releases](https://github.com/zacharyfmarion/cascade/releases):

- [Apple Silicon DMG](https://github.com/zacharyfmarion/cascade/releases/latest/download/Cascade_latest_aarch64.dmg)
- [Intel DMG](https://github.com/zacharyfmarion/cascade/releases/latest/download/Cascade_latest_x64.dmg)

Requires macOS 10.15 (Catalina) or later.

### Development

Local setup, build commands, and contributor-facing references live in [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md).

## 🤝 Contributing

Contributions are welcome! Please:

1. Check existing issues or create a new one to discuss your idea
2. Fork the repository and create a feature branch
3. Follow the code style (`cargo fmt` for Rust, ESLint for TypeScript)
4. Update documentation as needed
5. Submit a pull request

For detailed development guidelines, see [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Please also read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before participating in discussions or pull requests.

## 📄 License

Cascade is released under the MIT License. See [LICENSE](./LICENSE) for details.

## 🙏 Acknowledgments

Built with:

- [Tauri](https://tauri.app/) — Rust-powered desktop framework
- [React](https://react.dev/) — UI framework
- [React Flow](https://reactflow.dev/) — Node graph UI
- [wgpu](https://wgpu.rs/) — GPU compute pipeline
- [Rayon](https://github.com/rayon-rs/rayon) — CPU parallelism
- [Zustand](https://github.com/pmndrs/zustand) — Frontend state management
- [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) — WebAssembly bridge
- [Vite](https://vitejs.dev/) — Frontend build tooling
