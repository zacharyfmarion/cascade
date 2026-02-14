use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Blend;

impl Blend {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Blend {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "blend".to_string(),
            display_name: "Blend".to_string(),
            category: "Composite".to_string(),
            description: "Blend two images".to_string(),
            inputs: vec![
                PortSpec {
                    name: "base".to_string(),
                    label: "Base".to_string(),
                    ty: ValueType::Image,
                },
                PortSpec {
                    name: "blend_input".to_string(),
                    label: "Blend".to_string(),
                    ty: ValueType::Image,
                },
                PortSpec {
                    name: "mask".to_string(),
                    label: "Mask".to_string(),
                    ty: ValueType::Image,
                },
            ],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "mode".to_string(),
                    label: "Mode".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(18.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Normal".to_string(),
                        "Add".to_string(),
                        "Multiply".to_string(),
                        "Screen".to_string(),
                        "Overlay".to_string(),
                        "Soft Light".to_string(),
                        "Hard Light".to_string(),
                        "Difference".to_string(),
                        "Darken".to_string(),
                        "Lighten".to_string(),
                        "Color Dodge".to_string(),
                        "Color Burn".to_string(),
                        "Linear Burn".to_string(),
                        "Vivid Light".to_string(),
                        "Linear Light".to_string(),
                        "Pin Light".to_string(),
                        "Exclusion".to_string(),
                        "Subtract".to_string(),
                        "Divide".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "opacity".to_string(),
                    label: "Opacity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let base = ctx.get_input_image("base")?;
        let blend = ctx.get_input_image("blend_input")?;
        let mask_image = ctx.get_optional_input_image("mask");
        let mode = ctx.get_param_int("mode")?;
        let opacity = (ctx.get_param_float("opacity")? as f32).clamp(0.0, 1.0);
        let pixel_count = base.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        let base_width = base.width as usize;
        let blend_width = blend.width as usize;
        let blend_max_x = blend.width.saturating_sub(1) as usize;
        let blend_max_y = blend.height.saturating_sub(1) as usize;
        let base_data = &base.data;
        let blend_data = &blend.data;
        let (mask_data, mask_width, mask_max_x, mask_max_y) = match mask_image {
            Some(mask) => (
                Some(&mask.data),
                mask.width as usize,
                mask.width.saturating_sub(1) as usize,
                mask.height.saturating_sub(1) as usize,
            ),
            None => (None, 0, 0, 0),
        };
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let base_r = base_data[idx];
                let base_g = base_data[idx + 1];
                let base_b = base_data[idx + 2];
                let base_a = base_data[idx + 3];
                let x = i % base_width;
                let y = i / base_width;
                let blend_x = x.min(blend_max_x);
                let blend_y = y.min(blend_max_y);
                let blend_idx = (blend_y * blend_width + blend_x) * 4;
                let blend_r = blend_data[blend_idx];
                let blend_g = blend_data[blend_idx + 1];
                let blend_b = blend_data[blend_idx + 2];
                let blend_a = blend_data[blend_idx + 3];
                let blended_r = blend_channel(base_r, blend_r, mode);
                let blended_g = blend_channel(base_g, blend_g, mode);
                let blended_b = blend_channel(base_b, blend_b, mode);
                let effective_opacity = if let Some(mask_data) = mask_data {
                    let mask_x = x.min(mask_max_x);
                    let mask_y = y.min(mask_max_y);
                    let mask_idx = (mask_y * mask_width + mask_x) * 4;
                    let mask_r = mask_data[mask_idx];
                    let mask_g = mask_data[mask_idx + 1];
                    let mask_b = mask_data[mask_idx + 2];
                    let mask_luma = 0.2126 * mask_r + 0.7152 * mask_g + 0.0722 * mask_b;
                    (opacity * mask_luma).clamp(0.0, 1.0)
                } else {
                    opacity
                };
                let out_r = base_r + (blended_r - base_r) * effective_opacity;
                let out_g = base_g + (blended_g - base_g) * effective_opacity;
                let out_b = base_b + (blended_b - base_b) * effective_opacity;
                let out_a = base_a.max(blend_a);
                out[0] = out_r.clamp(0.0, 1.0);
                out[1] = out_g.clamp(0.0, 1.0);
                out[2] = out_b.clamp(0.0, 1.0);
                out[3] = out_a.clamp(0.0, 1.0);
            });
        let output = Image::from_f32_data(base.width, base.height, data);
        let mut outputs = HashMap::new();
        outputs.insert("image".to_string(), Value::Image(output));
        Ok(outputs)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

pub struct AlphaOver;

impl AlphaOver {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AlphaOver {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "alpha_over".to_string(),
            display_name: "Alpha Over".to_string(),
            category: "Composite".to_string(),
            description: "Composite foreground over background".to_string(),
            inputs: vec![
                PortSpec {
                    name: "background".to_string(),
                    label: "Background".to_string(),
                    ty: ValueType::Image,
                },
                PortSpec {
                    name: "foreground".to_string(),
                    label: "Foreground".to_string(),
                    ty: ValueType::Image,
                },
                PortSpec {
                    name: "mask".to_string(),
                    label: "Mask".to_string(),
                    ty: ValueType::Image,
                },
            ],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![ParamSpec {
                key: "opacity".to_string(),
                label: "Opacity".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
            }],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let background = ctx.get_input_image("background")?;
        let foreground = ctx.get_input_image("foreground")?;
        let mask_image = ctx.get_optional_input_image("mask");
        let opacity = (ctx.get_param_float("opacity")? as f32).clamp(0.0, 1.0);
        let pixel_count = background.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        let bg_width = background.width as usize;
        let fg_width = foreground.width as usize;
        let fg_max_x = foreground.width.saturating_sub(1) as usize;
        let fg_max_y = foreground.height.saturating_sub(1) as usize;
        let bg_data = &background.data;
        let fg_data = &foreground.data;
        let (mask_data, mask_width, mask_max_x, mask_max_y) = match mask_image {
            Some(mask) => (
                Some(&mask.data),
                mask.width as usize,
                mask.width.saturating_sub(1) as usize,
                mask.height.saturating_sub(1) as usize,
            ),
            None => (None, 0, 0, 0),
        };
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let bg_r = bg_data[idx];
                let bg_g = bg_data[idx + 1];
                let bg_b = bg_data[idx + 2];
                let bg_a = bg_data[idx + 3];
                let x = i % bg_width;
                let y = i / bg_width;
                let fg_x = x.min(fg_max_x);
                let fg_y = y.min(fg_max_y);
                let fg_idx = (fg_y * fg_width + fg_x) * 4;
                let fg_r = fg_data[fg_idx];
                let fg_g = fg_data[fg_idx + 1];
                let fg_b = fg_data[fg_idx + 2];
                let fg_a = fg_data[fg_idx + 3];
                let mut fg_alpha = (fg_a * opacity).clamp(0.0, 1.0);
                if let Some(mask_data) = mask_data {
                    let mask_x = x.min(mask_max_x);
                    let mask_y = y.min(mask_max_y);
                    let mask_idx = (mask_y * mask_width + mask_x) * 4;
                    let mask_r = mask_data[mask_idx];
                    let mask_g = mask_data[mask_idx + 1];
                    let mask_b = mask_data[mask_idx + 2];
                    let mask_luma = 0.2126 * mask_r + 0.7152 * mask_g + 0.0722 * mask_b;
                    fg_alpha = (fg_alpha * mask_luma).clamp(0.0, 1.0);
                }
                let inv_alpha = 1.0 - fg_alpha;
                let out_r = fg_r * fg_alpha + bg_r * inv_alpha;
                let out_g = fg_g * fg_alpha + bg_g * inv_alpha;
                let out_b = fg_b * fg_alpha + bg_b * inv_alpha;
                let out_a = fg_alpha + bg_a * inv_alpha;
                out[0] = out_r.clamp(0.0, 1.0);
                out[1] = out_g.clamp(0.0, 1.0);
                out[2] = out_b.clamp(0.0, 1.0);
                out[3] = out_a.clamp(0.0, 1.0);
            });
        let output = Image::from_f32_data(background.width, background.height, data);
        let mut outputs = HashMap::new();
        outputs.insert("image".to_string(), Value::Image(output));
        Ok(outputs)
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

fn blend_channel(base: f32, blend: f32, mode: i64) -> f32 {
    match mode {
        0 => blend,
        1 => base + blend,
        2 => base * blend,
        3 => 1.0 - (1.0 - base) * (1.0 - blend),
        4 => {
            if base < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        5 => soft_light(base, blend),
        6 => {
            if blend < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        7 => (base - blend).abs(),
        8 => base.min(blend),
        9 => base.max(blend),
        10 => {
            if blend >= 1.0 {
                1.0
            } else {
                base / (1.0 - blend)
            }
        }
        11 => {
            if blend <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - base) / blend).min(1.0)
            }
        }
        12 => (base + blend - 1.0).max(0.0),
        13 => {
            if blend <= 0.5 {
                if blend <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - base) / (2.0 * blend)).min(1.0)
                }
            } else {
                let d = 2.0 * (blend - 0.5);
                if d >= 1.0 {
                    1.0
                } else {
                    base / (1.0 - d)
                }
            }
        }
        14 => (base + 2.0 * blend - 1.0).clamp(0.0, 1.0),
        15 => {
            if blend <= 0.5 {
                base.min(2.0 * blend)
            } else {
                base.max(2.0 * blend - 1.0)
            }
        }
        16 => base + blend - 2.0 * base * blend,
        17 => (base - blend).max(0.0),
        18 => {
            if blend <= 0.0 {
                1.0
            } else {
                (base / blend).min(1.0)
            }
        }
        _ => blend,
    }
}

fn soft_light(base: f32, blend: f32) -> f32 {
    if blend <= 0.5 {
        base - (1.0 - 2.0 * blend) * base * (1.0 - base)
    } else {
        let d = if base <= 0.25 {
            ((16.0 * base - 12.0) * base + 4.0) * base
        } else {
            base.sqrt()
        };
        base + (2.0 * blend - 1.0) * (d - base)
    }
}
