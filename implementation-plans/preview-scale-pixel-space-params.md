# Fix: Preview vs Commit Rendering Differences (Pixel-Space Params)

## Goal

Nodes with pixel-space parameters (blur radii, translation offsets, filter sizes) produce visually
different results during preview (reduced-resolution) vs. commit (full-resolution). A Gaussian blur
with `sigma=20` on a 500px preview image blurs proportionally twice as much as on a 1000px full-res
image. Transform 2D `translate_x=100` shifts 20% of a preview vs 10% at full-res.

## Approach

Multiply pixel-space params by `ctx.preview_scale` before use in each affected node. This
compensates for the smaller image, producing results that match full-res commits. No full-res
re-evaluation needed — preview stays fast.

For GPU kernel nodes (Transform 2D), add `pixel_space_params: Vec<String>` to `KernelManifest`.
The `GpuKernelNode` executor scales those params by `ctx.preview_scale` before writing the uniform
buffer — no GLSL changes needed.

## Affected Areas

| Node | File | Pixel-space param(s) | Fix |
|------|------|----------------------|-----|
| GaussianBlur | `crates/cascade-nodes-std/src/filter.rs` | `sigma` | `* preview_scale` |
| Sharpen | `crates/cascade-nodes-std/src/filter_ops.rs` | `radius` | `* preview_scale` |
| Glow | `crates/cascade-nodes-std/src/filter_ops.rs` | `radius` | `* preview_scale` |
| DirectionalBlur | `crates/cascade-nodes-std/src/filter_ops.rs` | `length` | `* preview_scale` |
| Dilate | `crates/cascade-nodes-std/src/filter_ops.rs` | `radius` (int) | `* preview_scale`, round, min 1 |
| Erode | `crates/cascade-nodes-std/src/filter_ops.rs` | `radius` (int) | `* preview_scale`, round, min 1 |
| Median | `crates/cascade-nodes-std/src/filter_ops.rs` | `radius` (int) | `* preview_scale`, round, min 1 |
| Transform 2D | `crates/cascade-gpu/src/transform_kernels.rs` | `translate_x`, `translate_y` | `pixel_space_params` mechanism |
| Kuwahara | `crates/cascade-gpu/src/kuwahara.rs` | `size` (int) | `* preview_scale`, round, min 1 |

**No changes needed:** RadialBlur (normalized strength), Rotate (degrees), color/tone nodes, Resize
(output dims are intentional), Crop (deferred).

Documentation: add preview scaling note to `AGENTS.md`; symlink `CLAUDE.md → AGENTS.md`.

## Checklist

- [ ] Add `pixel_space_params` field to `KernelManifest` (`cascade-gpu/src/manifest.rs`)
- [ ] Store and use `pixel_space_params` in `GpuKernelNode` (`cascade-gpu/src/kernel_node.rs`)
- [ ] Mark `translate_x`, `translate_y` as pixel-space in Transform 2D manifest
- [ ] Scale `sigma` in `GaussianBlur::evaluate()`
- [ ] Scale `radius` in `Sharpen::evaluate()`
- [ ] Scale `radius` in `Glow::evaluate()`
- [ ] Scale `length` in `DirectionalBlur::evaluate()`
- [ ] Scale `radius` in `Dilate::evaluate()`
- [ ] Scale `radius` in `Erode::evaluate()`
- [ ] Scale `radius` in `Median::evaluate()`
- [ ] Scale `size` in `GpuKuwaharaNode::evaluate()`
- [ ] Add `eval_image_node_scaled` + `make_gradient_image` helpers to test module
- [ ] Add GaussianBlur preview consistency tests
- [ ] Add Sharpen, DirectionalBlur, Glow preview consistency tests
- [ ] Add Dilate/Erode/Median radius scaling tests
- [ ] Add Transform 2D manifest pixel_space_params test
- [ ] Update `AGENTS.md` with preview scaling section
- [ ] Symlink `CLAUDE.md → AGENTS.md`
- [ ] `cargo check`, `cargo test`, `cargo clippy`, `cargo fmt --check`
