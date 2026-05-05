# Cascade Product Roadmap

## Vision

**Cascade is the fastest way to build, share, and run image pipelines — with GPU compute and AI assistance — anywhere.**

Cascade is not "open-source Nuke." It is a **programmable image platform** that runs in the browser and on the desktop, where anyone can build visual effects pipelines, share them as links, and extend them with custom GPU shaders — assisted by AI.

## Strategic Positioning

### What Makes Cascade Different

| Axis | Nuke / Fusion | Blender Compositor | Cascade |
|---|---|---|---|
| **Access** | $$$, desktop only | Free, desktop only, embedded in 3D app | Free, browser + desktop, standalone |
| **Extensibility** | Python scripting, proprietary plugin API | Python, limited to Blender ecosystem | Live GPU compute (GLSL), custom DSL, AI-generated nodes |
| **Shareability** | Project files only | .blend files only | URL links, embeddable, text DSL |
| **AI Integration** | None | None | AI graph authoring, AI GPU shader generation, AI processing nodes |
| **Onboarding** | Weeks | Days | Minutes (templates + AI) |
| **Architecture** | C++, decades of tech debt | C++, secondary to 3D core | Rust/WASM, modern from scratch |

### Core Differentiators (Moat)

1. **Browser-native compositing** — Zero install, shareable via URL, embeddable in docs/tools. No competitor runs a real node compositor in the browser with GPU compute.
2. **Programmable GPU compute** — Users write GLSL `process()` functions that compile to real-time GPU shaders. AI can generate these on demand. This isn't a plugin API — it's a live programmable compute pipeline.
3. **AI-native workflow** — Working DSL for AI graph manipulation (read/write/edit graphs as text), AI-assisted GLSL generation, and AI processing nodes. The AI doesn't just suggest — it builds.
4. **Correct compositing math** — f32 linear RGBA, EXR-style data/display windows, Porter-Duff compositing, OCIO color management. Professional results, accessible tools.

### Target Users

| Segment | Why Cascade | What They Do |
|---|---|---|
| **Indie game/film teams** | Can't afford Nuke, Blender compositor is awkward, Natron is dead | Look-dev, matte extraction, texture processing, comp |
| **Content & product image teams** | High-volume manual Photoshop workflows | Product photo cleanup, social media variants, batch processing |
| **Web-native creators & educators** | Nothing good runs in-browser for node compositing | Tutorials, demos, quick experiments, shareable examples |
| **Technical artists & creative coders** | Want programmable image compute without building a pipeline | Custom GPU effects, procedural textures, shader prototyping |
| **Developers building image tools** | No good embeddable node-graph image engine exists | Integrate compositing into their own products |

---

## Current State (What Works Today)

### Node Library (~50 nodes across 9 categories)

- **Color** (21 nodes) — Grade, ColorCorrect, HueShift, Curves, CDL, Clamp, Saturation, Posterize, Threshold, Exposure, WhiteBalance, LUT, sRGB conversion, etc.
- **Filter** (9) — GaussianBlur, Sharpen, Median, EdgeDetect, Emboss, DirectionalBlur, RadialBlur, Bloom, Defocus
- **Composite** (3) — Merge (14 Porter-Duff blend modes), AlphaOver, Premult/Unpremult
- **Transform** (8) — Translate, Scale, Rotate, Flip, Crop, Reformat, CornerPin, STMap
- **Generator** (9) — Solid, Checkerboard, Gradient, Noise, Ramp, Text, Grid, ColorWheel, etc.
- **Matte** (11) — ChromaKey, LuminanceKey, DifferenceMatte, EdgeBlur, MatteExpand, MatteShrink, etc.
- **Channel** (5) — Shuffle, SeparateRGBA, CombineRGBA, CopyChannels, etc.
- **Utility** (6) — Dot, Switch, Blend, etc.
- **Input/Output** (6) — LoadImage, SaveImage, Viewer, etc.

### Platform & Architecture

- ✅ Rust core → WASM (browser) + Tauri (desktop) from single codebase
- ✅ f32 RGBA linear color space, EXR-style data/display windows
- ✅ Pull-based evaluator with dirty propagation and LRU cache
- ✅ GPU compute pipeline (GLSL → naga → wgpu)
- ✅ Self-describing NodeSpec system (add Rust node → UI auto-generates)
- ✅ React + xyflow + Zustand frontend with 12-slice store architecture
- ✅ Undo/redo (50 deep), cut/copy/paste, context menus
- ✅ Blender-style inline parameter sliders
- ✅ Full-stack error handling with per-node error attribution
- ✅ Criterion benchmarks, Playwright E2E tests, CI pipeline

### AI Features (Working)

- ✅ **AI Chat Assistant** with Claude — floating panel, vision (512px thumbnails)
- ✅ **Graph DSL** — bidirectional text representation (`handle = NodeType(param: value)`, `target.input <- source.output`), AI reads/writes/edits graphs via 5 tools
- ✅ **AI Node Creation** — AI writes DSL to create and wire new nodes, working end-to-end
- ✅ **GPU Script Node** — user-authored GLSL `process()` functions compiled to real-time GPU shaders via wgpu
- ✅ **AI-assisted GLSL generation** — AI writes GPU shader code for the Script node
- ✅ **AI Processing Nodes** — Depth estimation, inpainting via Replicate API

### Node Groups (Working, Needs Investment)

- ✅ Create groups from selected nodes
- ✅ Enter/exit group editing (editing stack navigation)
- ✅ Group I/O nodes (group_input, group_output)
- ✅ Dynamic interface (add/remove ports)
- ✅ Export group as package (JSON)
- ⚠️ **Buggy**: Needs stability investment before being a reliable workflow primitive

---

## Roadmap

### Phase 1: Make It Reliable & Useful
*Goal: Someone can do real work in Cascade and come back tomorrow. The existing features work well enough to trust.*

**Priority: Ship quality over new features.**

#### 1.1 Node Group Stability 🔧
Node groups are the foundation of reusable pipelines, templates, and the future ecosystem. They exist and have received hardening investment (panic safety, cycle detection, atomic updates, param preservation) but need further reliability work.

- [x] Harden group internals (panic safety, cycle detection, atomic updates, param preservation)
- [ ] Audit and fix remaining group bugs (connection handling, undo/redo within groups, nested group edge cases)
- [ ] Stabilize enter/exit editing flow
- [ ] Ensure groups work correctly with all node types (including GPU Script nodes)
- [ ] Group import from JSON (complement to existing export)
- [ ] Duplicate/instantiate groups within a project
#### 1.2 AI + GPU Script Integration 🧠⚡
The AI DSL and GPU Script node are now connected via `create_gpu_script` and `get_gpu_script_manifest` AI tools. The foundation is in place — AI can programmatically create GPU Script nodes and inspect their manifests. Next steps are deepening the integration.

- [x] AI can create GPU Script nodes programmatically (`create_gpu_script` tool)
- [x] AI can inspect GPU Script manifests (`get_gpu_script_manifest` tool)
- [ ] AI can read and modify existing GPU Script GLSL code (edit, not just create)
- [ ] AI understands GPU Script parameters and can set appropriate defaults, ranges, and UI hints
- [ ] GPU Script node improvements: better error messages on compile failure, parameter hot-reload, preview during editing
- [ ] Consider: unified DSL syntax for declaring GPU Script nodes inline (e.g., `effect = GpuScript(glsl: "...", params: {...})`)
#### 1.3 AI API Access (CORS) 🌐
The AI features are already BYOK — users supply their own Replicate and Anthropic API keys, stored locally. The only infrastructure issue is **CORS**: browser `fetch()` can't call `api.replicate.com` directly because Replicate doesn't return `Access-Control-Allow-Origin` headers. A thin Cloudflare Worker proxy (`workers/proxy/`) adds CORS headers to make browser requests work. In dev, Vite's dev server proxy handles this.

**Confirmed**: Replicate has no browser/CORS support and no plans to add it (SDK docs explicitly state browser is unsupported; GitHub issue #164 closed with no solution, March 2025). The Cloudflare Worker proxy is the correct architecture.

- [x] ~~Investigate Replicate browser/CORS support~~ — confirmed not available, proxy is required
- [x] ~~Document the Cloudflare Worker~~ — comprehensive JSDoc added to `workers/proxy/worker.js` explaining why it exists, security model, and architecture
- [ ] For Tauri desktop builds: call Replicate directly from the Rust backend (no CORS restriction), bypassing the proxy
- [x] ~~Verify Anthropic API production path~~ — FIXED: AI chat was routing through `/api/anthropic/v1` (Vite dev proxy only, broken in production). Updated `transport.ts` to use Anthropic's `anthropic-dangerous-direct-browser-access` header for direct browser access (same pattern as ScriptNodeEditor). GPU Script GLSL generation was already working in production.
- [ ] Add clear user-facing docs: "You need your own API keys for AI features"

#### 1.4 I/O Maturity 📁 (Partially Complete)
Getting images in and out reliably is table-stakes.

- [x] EXR multi-layer support — dynamic ports per layer, SaveExr node, full encode/decode pipeline
- [x] EXR performance — single-pass decode for all layers
- [x] Instance-aware specs for dynamic port connections (SpecProvider trait)
- [x] Image sequence input/output (LoadImageSequence with EXR support)
- [ ] Drag-and-drop improvements (multiple files, folder drop)
- [ ] Metadata preservation through the pipeline
- [ ] Common format support audit (WebP, AVIF, HDR)
#### 1.5 Frontend Polish 🎨 (Partially Complete)
Existing UX gaps that hurt daily use.

- [x] Fix live param race conditions (Engineering Roadmap Phase 3)
- [x] Fix color picker and color ramp input lag during drag
- [x] Performance: proxy resolution rendering for large images (engine-side preview scaling)
- [x] Performance: background thread rendering via Web Worker for live param drags
- [x] WASM multi-threading (wasm-bindgen-rayon) — all Rayon parallelism works in browser
- [x] Viewer enhancements — channel isolation, pixel inspector, gain/gamma controls
- [x] Toast notification system for user feedback
- [x] Mini-map improvements, better zoom/pan UX
- [x] Keyboard shortcuts audit and documentation
- [ ] Node deletion cleanup edge cases (Engineering Roadmap Phase 3)
- [ ] Full async background rendering for non-live evaluation
---

### Phase 2: Make It Shareable
*Goal: Graphs spread. People discover Cascade through someone else's work. The web-native advantage becomes the growth engine.*

#### 2.1 Templates & Presets 📋
Templates dramatically reduce time-to-value and showcase what's possible.

- [ ] Template system — load a pre-built graph as a starting point
- [ ] Ship 10-15 curated starter templates:
  - Product photography cleanup (background removal + color grade)
  - Social media image variants (resize + overlay + text)
  - Film look-dev (CDL + curves + grain + vignette)
  - Texture generation (noise + warp + colorize)
  - Matte extraction (chroma key + edge refinement)
  - Custom GPU effect showcase (chromatic aberration, glitch, CRT)
- [ ] "Save as template" from any graph
- [ ] Template browser with previews in the node library panel
- [ ] Node group presets — save and reuse parameterized groups

#### 2.2 Share as URL / Embed 🔗
This is the web-native superpower. No other compositor can do this.

- [ ] Graph serialization to URL-safe format (DSL text or compressed JSON)
- [ ] "Share" button → generates a link that opens Cascade with the graph pre-loaded
- [ ] Embed mode — `<iframe>` embed with reduced UI for docs, tutorials, blog posts
- [ ] Read-only viewer mode (see the graph and result without editing)
- [ ] "Remix" button — fork someone's shared graph into your own workspace

#### 2.3 Project Organization 📂
Move beyond single-graph sessions.

- [ ] Multiple compositions per project
- [ ] Named bookmarks / favorites for nodes and groups
- [ ] Recent projects list
- [ ] Auto-save and recovery
- [ ] Version history (local, leveraging DSL diffability)

#### 2.4 Batch / Headless Rendering 🏭
Turns Cascade from a GUI tool into a pipeline tool.

- [ ] CLI interface: `cascade render graph.json --input plate.exr --output result.exr`
- [ ] Batch mode: render a graph over a folder of input images
- [ ] Parameterized rendering: override node params from CLI args
- [ ] CI/CD integration (run Cascade as a build step)
- [ ] Node.js / Rust library mode (embed the engine in other tools)

---

### Phase 3: Make It Smart
*Goal: AI removes the expertise barrier. Non-experts can build sophisticated pipelines. Experts can move faster.*

#### 3.1 AI Assistant Polish 🤖
The assistant works. Make it great.

- [ ] Iterative self-correction — AI renders, sees result, adjusts
- [ ] Multi-turn context — AI remembers the conversation and graph evolution
- [ ] Suggested prompts / quick actions ("Make it warmer", "Add a vignette", "Key out the green")
- [ ] Cmd+K palette — quick AI actions without opening the full chat
- [ ] Natural language parameter adjustment ("make the blur stronger", "shift the hue toward orange")

#### 3.2 AI GPU Shader Generation (Differentiator) ⚡
This is what no one else has. Invest heavily.

- [ ] Curated library of AI-generated GPU effects as examples/templates
- [ ] "Effect gallery" — browse community GPU scripts, fork and modify
- [ ] AI can compose multiple GPU stages (chain Script nodes intelligently)
- [ ] Shader parameter inference — AI generates sensible slider ranges and labels
- [ ] Live preview during AI generation (stream partial GLSL, compile incrementally)
- [ ] Safety: sandboxed shader execution, prevent infinite loops, resource limits

#### 3.3 AI Processing Nodes (Commodity, Lower Priority) 🧩
These are nice-to-have but not differentiators — every image app is adding them.

- [ ] Expand to: style transfer, super-resolution, background removal, color grading suggestions
- [ ] Support multiple providers beyond Replicate (local models via ONNX, other APIs)
- [ ] Position as optional power-ups, not core product
- [ ] Ensure graceful degradation when AI services are unavailable

---

### Phase 4: Earn the Right (Build Only With User Demand)
*Goal: Add VFX-hard features when adoption signals justify the investment. These are expensive to build and serve a narrow audience — only worth it when that audience is actively using Cascade.*

**Gate**: Only move items from Phase 4 to active development when there is clear evidence of user demand (GitHub issues, Discord requests, usage data showing users hitting the limitation).

#### 4.1 Animation & Keyframes 🎬
Plan exists. Enables motion graphics and temporal workflows without requiring tracking.

- [ ] Per-parameter FCurves (Nuke-style) — Float, Int, Bool, Color
- [ ] Keyframe indicators on parameter widgets
- [ ] Timeline bar with playback controls
- [ ] Dopesheet panel (MVP)
- [ ] Curve editor (full)
- [ ] Frame range, FPS, playback settings

#### 4.2 Drawing & Masking ✏️
Roto and bezier masks. Only build when users are asking.

- [ ] Roto node — bezier spline masks with feathering
- [ ] Paint node — basic brush-based masking
- [ ] Shape generators (rectangle, ellipse, polygon masks)
- [ ] Per-point animation (requires 4.1)

#### 4.3 Motion & Tracking 🎯
2D tracking and stabilization. Extremely hard to do well. Only build when competitive pressure demands it.

- [ ] Point tracking (single and multi-point)
- [ ] Stabilization (translate, rotate, scale)
- [ ] Corner pin tracking
- [ ] Planar tracking (stretch goal)

#### 4.4 Advanced Compositing 🔬
Niche features for specific workflows.

- [ ] Expressions / parameter linking (simpler than full scripting — link one param to another with math)
- [x] Time operations (TimeOffset, FrameHold, FrameBlend) — **completed, no longer requires animation system**
- [ ] Mesh warp, Spherize, Twirl, Wave distortions
- [ ] Vector blur / motion blur on transforms
- [x] Multi-channel EXR / AOV workflows — **completed** (EXR multi-layer support with dynamic ports)
- [ ] Deep compositing (very niche, massive complexity — likely never worth it for Cascade's audience)
---

### Phase 5: Platform & Ecosystem (Long-term)
*Goal: Cascade becomes a platform others build on, not just a tool.*

#### 5.1 Plugin Ecosystem
- [ ] Public node API for third-party Rust/WASM nodes
- [ ] Node package registry (share and install community nodes)
- [ ] GPU Script sharing platform (browse, fork, publish shaders)

#### 5.2 Collaboration
- [ ] Real-time collaborative editing (CRDT-based)
- [ ] Comments and annotations on graphs
- [ ] Review mode (client reviews comp with feedback)

#### 5.3 Integrations
- [ ] Blender bridge (send renders to Cascade for comp)
- [ ] Game engine integration (Unreal/Unity/Godot texture pipeline)
- [ ] Figma/design tool export
- [ ] Cloud rendering for heavy batch jobs

---

## Engineering Prerequisites

These engineering investments from the [Engineering Roadmap](./ENGINEERING_ROADMAP.md) are prerequisites for product phases:

| Engineering Work | Enables Product Phase | Status |
|---|---|---|
| Full-stack error handling | Phase 1 (reliability) | ✅ Done |
| Cache eviction, selective invalidation | Phase 1 (performance) | ✅ Done |
| Store split (14 slices) | Phase 1 (frontend) | ✅ Done |
| GPU/CPU node unification | Phase 1 (node library) | ✅ Done |
| System-level mask support | Phase 1 (GPU node usability) | ✅ Done |
| WASM multi-threading | Phase 1 (performance) | ✅ Done |
| Web Worker engine + preview scaling | Phase 1 (live param UX) | ✅ Done |
| EXR multi-layer support | Phase 1 (I/O maturity) | ✅ Done |
| GPU texture pooling | Phase 1 (GPU Script perf) | Pending |
| Live param race condition fix | Phase 1 (frontend polish) | ✅ Done |
| EngineBridge abstraction split | Phase 2 (batch/headless) | Pending |
| EvalSession / ResourceStore | Phase 2 (project org) | Pending |
| Full async background rendering | Phase 1 (UX) | Pending |
| Tile-based processing | Phase 4 (large image perf) | Pending |
---

## Success Metrics

Stop measuring against Nuke's feature list. Measure:

| Metric | What It Tells You | Target (6mo post-launch) |
|---|---|---|
| **Activation rate** | % of visitors who complete a first useful render | > 40% |
| **Weekly retained creators** | People who come back and build graphs | > 500 |
| **Graphs shared** | Viral coefficient — do people send Cascade links? | > 100/week |
| **Custom GPU scripts created** | Are technical users extending the platform? | > 50 unique |
| **Time to first useful output** | Onboarding quality | < 5 minutes |
| **Template usage rate** | Are templates driving activation? | > 60% of new users start from template |
| **AI assistant usage** | Is AI reducing the expertise barrier? | > 30% of sessions use AI |

---

## What This Roadmap Deliberately Omits

These are features from the old roadmap that are intentionally deprioritized or removed:

| Feature | Why Omitted |
|---|---|
| **Deep compositing** | Massive complexity, extremely niche audience. Not worth the investment for Cascade's target users. |
| **ZDefocus** | Depth-based defocus is cool but narrow. AI depth estimation + regular Defocus gets 80% there. |
| **Grain synthesis** | Nice-to-have but not a driver of adoption. Can be done via GPU Script. |
| **Denoise** | Commodity feature. Better served by AI models than hand-coded algorithms. |
| **3D awareness** | Cascade is a 2D compositing tool. Don't try to be a 3D tool. |
| **Full Python scripting** | The DSL + AI + GPU Script covers the extensibility need. Python adds massive complexity. |

---

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-06 | Mark I/O Maturity (1.4) as partially complete | EXR multi-layer, image sequences, SaveExr all shipped. Remaining: drag-drop improvements, metadata preservation, format audit. |
| 2026-03-06 | Move Time Nodes and EXR/AOV out of Phase 4.4 | Both completed ahead of schedule — time nodes don't require animation system, EXR support shipped with dynamic ports. |
| 2026-03-06 | Elevate GPU texture pooling priority | With 35+ GPU nodes after unification, chained GPU pipelines are common. Texture pooling is now a real-world performance need, not theoretical. |
| 2026-03-04 | Pivot from "Nuke gap analysis" to "programmable image platform" | Chasing Nuke parity targets an already-served audience with the hardest features. Web-native + AI + GPU compute is the actual differentiation. |
| 2026-03-04 | Deprioritize roto/tracking to Phase 4 (demand-gated) | Expensive to build well, serves narrow audience, doesn't leverage any of Cascade's unique strengths. |
| 2026-03-04 | Prioritize AI+GPU Script integration as Phase 1 | This is the killer feature no competitor has. Unifying the working DSL with GPU Script creation makes it coherent. |
| 2026-03-04 | Add templates/presets as Phase 2 priority | Templates are the highest-leverage onboarding tool. Show users what's possible, reduce time-to-value. |
| 2026-03-04 | Flag AI proxy architecture as pre-release blocker | Shipping with a shared Cloudflare Worker proxying user API keys is not acceptable for a public release. |
| 2026-03-04 | Gate Phase 4 features on user demand signals | Prevents building expensive features nobody asked for. Let adoption data drive the investment. |
