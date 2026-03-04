use base64::{engine::general_purpose, Engine as _};
use cascade_core::ai::AiPredictionRequest;
use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

const DEPTH_ANYTHING_V2_VERSION: &str =
    "b239ea33cff32bb7abb5db39ffe9a09c14cbc2894331d1ef66fe096eed88ebd4";

pub struct AiDepthEstimate;

impl Default for AiDepthEstimate {
    fn default() -> Self {
        Self::new()
    }
}

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
                CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;

            if !ai.is_configured() {
                return Err(CascadeError::Other(
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
                model: None,
                input,
            };

            let result = ai.predict(request).await?;
            let depth_url = result
                .output
                .get_field("grey_depth")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    CascadeError::Other("Depth model did not return grey_depth URL".to_string())
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

pub fn encode_image_png(image: &Image) -> Result<Vec<u8>, CascadeError> {
    let rgba8 = image.to_rgba8_srgb();
    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
        .ok_or_else(|| CascadeError::Other("Failed to create image buffer".into()))?;
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| CascadeError::Other(format!("PNG encode failed: {e}")))?;
    Ok(buf)
}

fn png_bytes_to_data_uri(bytes: &[u8]) -> String {
    let b64 = general_purpose::STANDARD.encode(bytes);
    format!("data:image/png;base64,{b64}")
}

pub fn decode_response_image(bytes: &[u8]) -> Result<Image, CascadeError> {
    let decoded =
        image::load_from_memory(bytes).map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
        return Err(CascadeError::ImageTooLarge {
            width,
            height,
            max: MAX_IMAGE_DIM,
        });
    }
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
    Image::from_f32_data(width, height, data)
}

fn srgb_to_linear(v: u8) -> f32 {
    let v = v as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub struct AiRemoveBackground;

impl Default for AiRemoveBackground {
    fn default() -> Self {
        Self::new()
    }
}

impl AiRemoveBackground {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AiRemoveBackground {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_remove_background".to_string(),
            display_name: "AI Remove Background".to_string(),
            category: "AI".to_string(),
            description: "Remove background from an image using AI".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "model".to_string(),
                label: "Model".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::String("851 Labs".to_string()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Dropdown(vec![
                    "851 Labs".to_string(),
                    "BRIA RMBG 2.0".to_string(),
                ]),
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            if let Some(cached) = ctx.ai_cached_outputs {
                return if cached.contains_key("image") {
                    Ok(cached.clone())
                } else {
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::None);
                    Ok(outputs)
                };
            }

            let ai = ctx.ai_provider.ok_or_else(|| {
                CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;

            if !ai.is_configured() {
                return Err(CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }

            let input_image = ctx.get_input_image("image")?;
            let png_bytes = encode_image_png(input_image)?;
            let image_data_uri = png_bytes_to_data_uri(&png_bytes);

            let model_name = ctx.get_param_string("model").unwrap_or("851 Labs");

            let mut input = HashMap::new();
            input.insert("image".to_string(), image_data_uri.into());
            let request = match model_name {
                "BRIA RMBG 2.0" => AiPredictionRequest {
                    version: String::new(),
                    model: Some("bria/remove-background".to_string()),
                    input,
                },
                // Default: 851 Labs (community model, requires version hash)
                _ => AiPredictionRequest {
                    version: "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
                        .to_string(),
                    model: None,
                    input,
                },
            };

            let result = ai.predict(request).await?;

            let output_url = result
                .output
                .first_url()
                .ok_or_else(|| {
                    CascadeError::Other(
                        "Background removal model did not return an output URL".to_string(),
                    )
                })?
                .to_string();

            let image_bytes = ai.fetch_url(&output_url).await?;
            let output_image = decode_response_image(&image_bytes)?;

            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output_image));
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

pub struct AiUpscale;

impl Default for AiUpscale {
    fn default() -> Self {
        Self::new()
    }
}

impl AiUpscale {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AiUpscale {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_upscale".to_string(),
            display_name: "AI Upscale".to_string(),
            category: "AI".to_string(),
            description: "Upscale an image using AI super-resolution models".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "model".to_string(),
                    label: "Model".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("Real-ESRGAN".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "Real-ESRGAN".to_string(),
                        "Google Upscaler".to_string(),
                        "Recraft Crisp Upscale".to_string(),
                        "Clarity Upscaler".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "scale".to_string(),
                    label: "Scale".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Int(4),
                    min: Some(2.0),
                    max: Some(10.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
                    promotable: false,
                },
                ParamSpec {
                    key: "face_enhance".to_string(),
                    label: "Face Enhance".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: false,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            if let Some(cached) = ctx.ai_cached_outputs {
                return if cached.contains_key("image") {
                    Ok(cached.clone())
                } else {
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::None);
                    Ok(outputs)
                };
            }

            let ai = ctx.ai_provider.ok_or_else(|| {
                CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;

            if !ai.is_configured() {
                return Err(CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }

            let input_image = ctx.get_input_image("image")?;
            let png_bytes = encode_image_png(input_image)?;
            let image_data_uri = png_bytes_to_data_uri(&png_bytes);

            let model_name = ctx.get_param_string("model").unwrap_or("Real-ESRGAN");
            let scale = ctx.get_param_int("scale").unwrap_or(4);
            let face_enhance = ctx.get_param_bool("face_enhance").unwrap_or(false);

            let (model_id, input) = match model_name {
                "Google Upscaler" => {
                    let mut input = HashMap::new();
                    input.insert("image".to_string(), image_data_uri.into());
                    let scale_str = if scale >= 4 {
                        "4".to_string()
                    } else {
                        "2".to_string()
                    };
                    input.insert("scale".to_string(), scale_str.into());
                    ("google/upscaler", input)
                }
                "Recraft Crisp Upscale" => {
                    let mut input = HashMap::new();
                    input.insert("image".to_string(), image_data_uri.into());
                    ("recraft-ai/recraft-crisp-upscale", input)
                }
                "Clarity Upscaler" => {
                    let mut input = HashMap::new();
                    input.insert("image".to_string(), image_data_uri.into());
                    input.insert("scale_factor".to_string(), (scale as f64).into());
                    ("philz1337x/clarity-upscaler", input)
                }
                // Default: Real-ESRGAN
                _ => {
                    let mut input = HashMap::new();
                    input.insert("image".to_string(), image_data_uri.into());
                    input.insert("scale".to_string(), (scale as f64).into());
                    input.insert("face_enhance".to_string(), face_enhance.into());
                    ("nightmareai/real-esrgan", input)
                }
            };

            let request = AiPredictionRequest {
                version: String::new(),
                model: Some(model_id.to_string()),
                input,
            };

            let result = ai.predict(request).await?;

            let output_url = result
                .output
                .first_url()
                .ok_or_else(|| {
                    CascadeError::Other("Upscale model did not return an output URL".to_string())
                })?
                .to_string();

            let image_bytes = ai.fetch_url(&output_url).await?;
            let output_image = decode_response_image(&image_bytes)?;

            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output_image));
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

pub struct AiInpaint;
impl Default for AiInpaint {
    fn default() -> Self {
        Self::new()
    }
}

impl AiInpaint {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AiInpaint {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_inpaint".to_string(),
            display_name: "AI Inpaint".to_string(),
            category: "AI".to_string(),
            description: "Edit or fill image regions using AI".to_string(),
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
                    ty: ValueType::Image,
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
                    ty: ValueType::String,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::TextArea,
                    promotable: true,
                },
                ParamSpec {
                    key: "model".to_string(),
                    label: "Model".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("FLUX Fill Pro".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "FLUX Fill Pro".to_string(),
                        "FLUX Fill Dev".to_string(),
                        "SD Inpainting".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "guidance".to_string(),
                    label: "Guidance".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(30.0),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
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
                CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;
            if !ai.is_configured() {
                return Err(CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }
            let prompt = ctx.get_param_string("prompt").unwrap_or("");
            if prompt.is_empty() {
                return Err(CascadeError::Other(
                    "Prompt is required for AI Inpaint".to_string(),
                ));
            }
            let model_name = ctx.get_param_string("model").unwrap_or("FLUX Fill Pro");
            let guidance = ctx.get_param_float("guidance").unwrap_or(30.0);
            let strength = ctx.get_param_float("strength").unwrap_or(0.8);
            let mut input = HashMap::new();
            input.insert("prompt".to_string(), prompt.to_string().into());
            if let Some(img) = ctx.get_optional_input_image("image") {
                let png_bytes = encode_image_png(img)?;
                input.insert(
                    "image".to_string(),
                    png_bytes_to_data_uri(&png_bytes).into(),
                );
            }
            if let Some(mask) = ctx.get_optional_input_image("mask") {
                let png_bytes = encode_image_png(mask)?;
                input.insert("mask".to_string(), png_bytes_to_data_uri(&png_bytes).into());
            }
            let model_id = match model_name {
                "FLUX Fill Pro" => {
                    input.insert("guidance".to_string(), guidance.into());
                    "black-forest-labs/flux-fill-pro"
                }
                "FLUX Fill Dev" => {
                    input.insert("guidance".to_string(), guidance.into());
                    "black-forest-labs/flux-fill-dev"
                }
                "SD Inpainting" => {
                    input.insert("strength".to_string(), strength.into());
                    input.insert("guidance_scale".to_string(), guidance.into());
                    "stability-ai/stable-diffusion-inpainting"
                }
                _ => "black-forest-labs/flux-fill-pro",
            };
            let request = AiPredictionRequest {
                version: String::new(),
                model: Some(model_id.to_string()),
                input,
            };

            let result = ai.predict(request).await?;
            let output_url = result
                .output
                .first_url()
                .ok_or_else(|| {
                    CascadeError::Other(
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

/// Collect connected reference images from optional input ports, in deterministic order.
/// Returns data URIs suitable for API payloads.
fn collect_reference_image_uris(
    ctx: &EvalContext<'_>,
    port_names: &[&str],
) -> Result<Vec<String>, CascadeError> {
    let mut uris = Vec::new();
    for &name in port_names {
        if let Some(img) = ctx.get_optional_input_image(name) {
            let png_bytes = encode_image_png(img)?;
            uris.push(png_bytes_to_data_uri(&png_bytes));
        }
    }
    Ok(uris)
}

pub struct AiGenerateImage;
impl Default for AiGenerateImage {
    fn default() -> Self {
        Self::new()
    }
}

impl AiGenerateImage {
    pub fn new() -> Self {
        Self
    }

    /// Reference image port names in connection order.
    const REF_PORTS: [&str; 4] = ["ref_1", "ref_2", "ref_3", "ref_4"];
}
impl Node for AiGenerateImage {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "ai_generate_image".to_string(),
            display_name: "AI Generate Image".to_string(),
            category: "AI".to_string(),
            description:
                "Generate an image from a text prompt using AI, optionally with reference images"
                    .to_string(),
            inputs: vec![
                PortSpec {
                    name: "ref_1".to_string(),
                    label: "Reference 1".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "ref_2".to_string(),
                    label: "Reference 2".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "ref_3".to_string(),
                    label: "Reference 3".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "ref_4".to_string(),
                    label: "Reference 4".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
            ],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "prompt".to_string(),
                    label: "Prompt".to_string(),
                    ty: ValueType::String,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::TextArea,
                    promotable: true,
                },
                ParamSpec {
                    key: "model".to_string(),
                    label: "Model".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("Nano Banana 2".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "Nano Banana 2".to_string(),
                        "Nano Banana Pro".to_string(),
                        "Gemini 2.5 Flash".to_string(),
                        "FLUX 1.1 Pro".to_string(),
                        "FLUX 1.1 Pro Ultra".to_string(),
                        "FLUX Schnell".to_string(),
                        "FLUX Kontext".to_string(),
                        "Seedream 4.5".to_string(),
                        "Ideogram v3".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "aspect_ratio".to_string(),
                    label: "Aspect Ratio".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("1:1".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "1:1".to_string(),
                        "4:3".to_string(),
                        "3:4".to_string(),
                        "16:9".to_string(),
                        "9:16".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "guidance".to_string(),
                    label: "Guidance".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(2.5),
                    min: Some(1.0),
                    max: Some(10.0),
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
                return if cached.contains_key("image") {
                    Ok(cached.clone())
                } else {
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::None);
                    Ok(outputs)
                };
            }
            let ai = ctx.ai_provider.ok_or_else(|| {
                CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                )
            })?;
            if !ai.is_configured() {
                return Err(CascadeError::Other(
                    "AI provider not configured. Set an API key in Settings.".to_string(),
                ));
            }

            let prompt = ctx.get_param_string("prompt").unwrap_or("").to_string();
            if prompt.is_empty() {
                return Err(CascadeError::Other(
                    "Prompt is required for AI Generate Image".to_string(),
                ));
            }
            let model_name = ctx.get_param_string("model").unwrap_or("Nano Banana 2");
            let aspect_ratio = ctx.get_param_string("aspect_ratio").unwrap_or("1:1");
            let ref_uris = collect_reference_image_uris(ctx, &Self::REF_PORTS)?;
            let mut input = HashMap::new();
            input.insert("prompt".to_string(), prompt.into());
            input.insert("aspect_ratio".to_string(), aspect_ratio.to_string().into());
            // Build model-specific payload
            let model_id = match model_name {
                "FLUX Kontext" => {
                    // Kontext accepts a single input_image + prompt.
                    // Uses match_input_image aspect ratio when a ref is connected.
                    if let Some(uri) = ref_uris.first() {
                        input.insert("input_image".to_string(), uri.clone().into());
                        input.insert(
                            "aspect_ratio".to_string(),
                            "match_input_image".to_string().into(),
                        );
                    }
                    let guidance = ctx.get_param_float("guidance").unwrap_or(2.5);
                    input.insert("guidance".to_string(), guidance.into());
                    "black-forest-labs/flux-kontext-dev"
                }
                "Gemini 2.5 Flash" | "Nano Banana Pro" | "Nano Banana 2" => {
                    // Gemini / Nano Banana models accept image_input as an array of URIs.
                    if !ref_uris.is_empty() {
                        input.insert("image_input".to_string(), ref_uris.into());
                    }
                    match model_name {
                        "Nano Banana Pro" => "google/nano-banana-pro",
                        "Nano Banana 2" => "google/nano-banana-2",
                        _ => "google/gemini-2.5-flash-image",
                    }
                }
                _ => {
                    // Text-only models: FLUX 1.1 Pro, Ultra, Schnell, etc.
                    // Reference images are silently ignored for models that don't support them.
                    match model_name {
                        "FLUX 1.1 Pro" => "black-forest-labs/flux-1.1-pro",
                        "FLUX 1.1 Pro Ultra" => "black-forest-labs/flux-1.1-pro-ultra",
                        "FLUX Schnell" => "black-forest-labs/flux-schnell",
                        "Seedream 4.5" => "bytedance/seedream-4.5",
                        "Ideogram v3" => "ideogram-ai/ideogram-v3-balanced",
                        _ => "black-forest-labs/flux-1.1-pro",
                    }
                }
            };
            let request = AiPredictionRequest {
                version: String::new(),
                model: Some(model_id.to_string()),
                input,
            };

            let result = ai.predict(request).await?;
            let output_url = result
                .output
                .first_url()
                .ok_or_else(|| {
                    CascadeError::Other(
                        "Image generation model did not return an output URL".to_string(),
                    )
                })?
                .to_string();
            let image_bytes = ai.fetch_url(&output_url).await?;
            let output_image = decode_response_image(&image_bytes)?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output_image));
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
