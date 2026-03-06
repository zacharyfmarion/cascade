# GPU kernel manifest cleanup

## Goal
Update GPU kernel manifests to remove "GPU" from display names, correct categories, and align port naming with CPU conventions.

## Scope
- `crates/cascade-gpu/src/color_kernels.rs`
- `crates/cascade-gpu/src/blend_kernels.rs`
- `crates/cascade-gpu/src/matte_kernels.rs`
- `crates/cascade-gpu/src/color_kernels_advanced.rs`
- `crates/cascade-gpu/src/transform_kernels.rs`
- `crates/cascade-gpu/src/utility_kernels.rs`
- `crates/cascade-gpu/src/manifest.rs`

## Plan
- [ ] Review kernel manifest files to identify display names, categories, and port names that need changes.
- [ ] Update display_name values to remove GPU prefixes/suffixes.
- [ ] Fix categories for blend/matte/advanced color/pixelate manifests.
- [ ] Rename output ports from `output` to `image` across GPU kernel manifests.
- [ ] Rename specified input ports in blend kernels and update labels to match.
- [ ] Run `cargo check -p cascade-gpu`.
- [ ] Run `cargo test -p cascade-gpu`.
