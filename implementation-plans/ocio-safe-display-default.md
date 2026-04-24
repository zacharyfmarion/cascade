# OCIO Safe Display Default

## Goal

Fix a color mismatch on the desktop (Tauri) app where the Load Image node thumbnail looks dramatically different from the Viewer node output when `$OCIO` is set. Default to a neutral (no tone-mapping) display transform so that the image editing experience is consistent by default, with OCIO tone-mapping opt-in via the viewer toolbar.

## Approach

When OCIO loads from `$OCIO`, `sync_active_display_view()` was automatically called, picking the first available view in the config — often a tone-mapping transform (e.g. ACES RRT). This made the Viewer output look dramatically different from the Load Image `<img>` thumbnail, which bypasses OCIO entirely.

Two targeted changes:

1. **Stop auto-selecting an OCIO view on load.** Remove `sync_active_display_view()` calls from `load_ocio_config` and `load_ocio_from_env`. The engine keeps defaults (`active_display = "sRGB"`, `active_view = "Standard"`).

2. **Add fallback in `image_to_rgba8_with_display`.** When `create_display_transform` fails (e.g. "Standard" doesn't exist in the OCIO config), fall back to `create_transform(working_space → sRGB)`. This uses OCIO's own color math to convert from the working space (e.g. ACEScg) to sRGB — correct color, no tone mapping.

Result:
- **Web**: unchanged (builtin CM, `create_display_transform` succeeds → linear→sRGB).
- **Desktop, default**: OCIO loaded but display view = "Standard" → fallback to working_space→sRGB (no tone mapping). Matches browser `<img>` rendering.
- **Desktop, explicit OCIO view**: user picks a view in toolbar → `create_display_transform` succeeds → full OCIO display+view transform applied.

## Affected Areas

- `crates/cascade-runtime/src/lib.rs` — remove `sync_active_display_view()` calls
- `crates/cascade-nodes-std/src/output.rs` — add display transform fallback

## Checklist

- [x] Remove `sync_active_display_view()` from `load_ocio_config` and `load_ocio_from_env`
- [x] Add `or_else` fallback to `create_transform(working_space, sRGB)` in `image_to_rgba8_with_display`
- [x] `cargo check` (relevant crates)
- [x] `cargo test` (relevant crates)
- [x] `cargo clippy` (relevant crates)
- [x] `cargo fmt --check`
- [x] `cargo check -p cascade-tauri`
- [ ] Draft PR opened
