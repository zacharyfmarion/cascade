# GPT Image 2 Default

## Goal

Add Replicate `openai/gpt-image-2` support to the AI Generate Image node and make it the default image generation model.

## Approach

Keep the existing Replicate provider path unchanged and extend the AI Generate Image node's model mapping. GPT Image 2 needs `input_images` for references and only supports `1:1`, `3:2`, and `2:3` aspect ratios, so the node should build a model-specific payload and return a clear error for unsupported aspect ratios.

## Affected Areas

- `crates/cascade-nodes-std/src/ai.rs`
- AI Generate Image node defaults and dropdown metadata
- Unit tests for model defaults and Replicate payload mapping

## Checklist

- [x] Add GPT Image 2 to AI Generate Image model options as the default
- [x] Build GPT Image 2 payloads using `input_images` and supported aspect ratios
- [x] Add focused Rust tests for default metadata and payload mapping
- [x] Run targeted Rust validation
- [x] Open a draft PR against `main`
