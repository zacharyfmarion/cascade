use compositor_core::ai::AiImageRequest;
use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct AiInpaint;

impl AiInpaint {
    pub fn new() -> Self {
        Self
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
}

fn srgb_to_linear(v: u8) -> f32 {
    let v = v as f32 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
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
                    key: "model".to_string(),
                    label: "Model".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("gpt-image-1".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "gpt-image-1".to_string(),
                        "dall-e-3".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "quality".to_string(),
                    label: "Quality".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("medium".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "low".to_string(),
                        "medium".to_string(),
                        "high".to_string(),
                    ]),
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
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

            let model = ctx.get_param_string("model").unwrap_or("gpt-image-1");
            let quality = ctx.get_param_string("quality").unwrap_or("medium");

            let input_image = if let Some(img) = ctx.get_optional_input_image("image") {
                Some(Self::encode_image_png(img)?)
            } else {
                None
            };

            let mask = if let Some(mask_val) = ctx.inputs.get("mask") {
                if let Value::Mask(m) = mask_val {
                    Some(Self::encode_image_png(m)?)
                } else {
                    None
                }
            } else {
                None
            };

            let request = AiImageRequest {
                prompt: prompt.to_string(),
                model: model.to_string(),
                input_image,
                mask,
                width: None,
                height: None,
                quality: Some(quality.to_string()),
            };

            let result = ai.generate_sync(request).await?;
            let output_image = Self::decode_response_image(&result.image_bytes)?;

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
