use base64::{engine::general_purpose, Engine as _};
use compositor_core::ai::AiPredictionRequest;
use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

const DEPTH_ANYTHING_V2_VERSION: &str =
    "b239ea33cff32bb7abb5db39ffe9a09c14cbc2894331d1ef66fe096eed88ebd4";

pub struct AiDepthEstimate;

impl AiDepthEstimate {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AiDepthEstimate {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_depth_estimate".to_string(),
            display_name: "AI Depth Estimate".to_string(),
            category: "AI".to_string(),
            description: "Estimate depth from a single image using AI (Depth Anything V2)"
                .to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "depth".to_string(),
                label: "Depth".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "model_size".to_string(),
                label: "Model Size".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::String("Large".to_string()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Dropdown(vec![
                    "Small".to_string(),
                    "Base".to_string(),
                    "Large".to_string(),
                ]),
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            if let Some(cached) = ctx.ai_cached_outputs {
                return if cached.contains_key("depth") {
                    Ok(cached.clone())
                } else {
                    let mut outputs = HashMap::new();
                    outputs.insert("depth".to_string(), Value::None);
                    Ok(outputs)
                };
            }

            let ai = ctx.ai_provider.ok_or_else(|| {
                CompositorError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;

            if !ai.is_configured() {
                return Err(CompositorError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }

            let input_image = ctx.get_input_image("image")?;
            let png_bytes = encode_image_png(input_image)?;
            let image_data_uri = png_bytes_to_data_uri(&png_bytes);

            let model_size = ctx.get_param_string("model_size").unwrap_or("Large");

            let mut input = HashMap::new();
            input.insert("image".to_string(), image_data_uri.into());
            input.insert("model_size".to_string(), model_size.to_string().into());

            let request = AiPredictionRequest {
                version: DEPTH_ANYTHING_V2_VERSION.to_string(),
                input,
            };

            let result = ai.predict(request).await?;

            // depth-anything-v2 returns { "color_depth": "<url>", "grey_depth": "<url>" }
            let depth_url = result
                .output
                .get_field("grey_depth")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CompositorError::Other(
                        "Depth model did not return grey_depth URL".to_string(),
                    )
                })?
                .to_string();

            let image_bytes = ai.fetch_url(&depth_url).await?;
            let depth_image = decode_response_image(&image_bytes)?;

            let mut outputs = HashMap::new();
            outputs.insert("depth".to_string(), Value::Image(depth_image));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

fn encode_image_png(image: &Image) -> Result<Vec<u8>, CompositorError> {
    let rgba8 = image.to_rgba8_srgb();
    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
        .ok_or_else(|| CompositorError::Other("Failed to create image buffer".into()))?;
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| CompositorError::Other(format!("PNG encode failed: {e}")))?;
    Ok(buf)
}

fn png_bytes_to_data_uri(bytes: &[u8]) -> String {
    let b64 = general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{b64}")
}

fn decode_response_image(bytes: &[u8]) -> Result<Image, CompositorError> {
    let decoded = image::load_from_memory(bytes)
        .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw = rgba.as_raw();
    let pixel_count = (width as usize) * (height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let idx = i * 4;
            out[0] = srgb_to_linear(raw[idx]);
            out[1] = srgb_to_linear(raw[idx + 1]);
            out[2] = srgb_to_linear(raw[idx + 2]);
            out[3] = raw[idx + 3] as f32 / 255.0;
        });
    Ok(Image::from_f32_data(width, height, data))
}

fn srgb_to_linear(v: u8) -> f32 {
    let v = v as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub struct AiInpaint;

impl AiInpaint {
    pub fn new() -> Self {
        Self
    }
}

const SDXL_INPAINTING_VERSION: &str =
    "a4a8bafd6089e1716b06057c42b19378250d008b80fe87caa5cd36d40c1edd90";

impl Node for AiInpaint {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_inpaint".to_string(),
            display_name: "AI Inpaint".to_string(),
            category: "AI".to_string(),
            description: "Edit or fill image regions using AI (Stable Diffusion Inpainting)"
                .to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "mask".to_string(),
                    label: "Mask".to_string(),
                    ty: ValueType::Mask,
                    ..Default::default()
                },
            ],
            outputs: vec![PortSpec {
                name: "output".to_string(),
                label: "Output".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "prompt".to_string(),
                    label: "Prompt".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::TextArea,
                    promotable: true,
                },
                ParamSpec {
                    key: "strength".to_string(),
                    label: "Strength".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.05),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "guidance_scale".to_string(),
                    label: "Guidance Scale".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(7.5),
                    min: Some(1.0),
                    max: Some(20.0),
                    step: Some(0.5),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            if let Some(cached) = ctx.ai_cached_outputs {
                return if cached.contains_key("output") {
                    Ok(cached.clone())
                } else {
                    let mut outputs = HashMap::new();
                    outputs.insert("output".to_string(), Value::None);
                    Ok(outputs)
                };
            }

            let ai = ctx.ai_provider.ok_or_else(|| {
                CompositorError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;

            if !ai.is_configured() {
                return Err(CompositorError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }

            let prompt = ctx.get_param_string("prompt").unwrap_or("");
            if prompt.is_empty() {
                return Err(CompositorError::Other(
                    "Prompt is required for AI Inpaint".to_string(),
                ));
            }

            let strength = ctx.get_param_float("strength").unwrap_or(0.8);
            let guidance_scale = ctx.get_param_float("guidance_scale").unwrap_or(7.5);

            let mut input = HashMap::new();
            input.insert("prompt".to_string(), prompt.to_string().into());
            input.insert("strength".to_string(), (strength as f64).into());
            input.insert("guidance_scale".to_string(), (guidance_scale as f64).into());

            if let Some(img) = ctx.get_optional_input_image("image") {
                let png_bytes = encode_image_png(img)?;
                input.insert("image".to_string(), png_bytes_to_data_uri(&png_bytes).into());
            }

            if let Some(mask_val) = ctx.inputs.get("mask") {
                if let Value::Mask(m) = mask_val {
                    let png_bytes = encode_image_png(m)?;
                    input.insert("mask".to_string(), png_bytes_to_data_uri(&png_bytes).into());
                }
            }

            let request = AiPredictionRequest {
                version: SDXL_INPAINTING_VERSION.to_string(),
                input,
            };

            let result = ai.predict(request).await?;

            let output_url = result
                .output
                .first_url()
                .ok_or_else(|| {
                    CompositorError::Other(
                        "Inpainting model did not return an output URL".to_string(),
                    )
                })?
                .to_string();

            let image_bytes = ai.fetch_url(&output_url).await?;
            let output_image = decode_response_image(&image_bytes)?;

            let mut outputs = HashMap::new();
            outputs.insert("output".to_string(), Value::Image(output_image));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}
