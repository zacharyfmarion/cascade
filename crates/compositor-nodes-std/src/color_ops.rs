use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

const CURVE_LUT_SIZE: usize = 4096;
const CURVE_LUT_SCALE: f32 = (CURVE_LUT_SIZE - 1) as f32;

pub struct Levels;

impl Levels {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Levels {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "levels".to_string(),
            display_name: "Levels".to_string(),
            category: "Color".to_string(),
            description: "Adjust levels".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "in_black".to_string(),
                    label: "In Black".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "in_white".to_string(),
                    label: "In White".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "gamma".to_string(),
                    label: "Gamma".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.1),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "out_black".to_string(),
                    label: "Out Black".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "out_white".to_string(),
                    label: "Out White".to_string(),
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
        let image = ctx.get_input_image("image")?;
        let in_black = ctx.get_param_float("in_black")? as f32;
        let in_white = ctx.get_param_float("in_white")? as f32;
        let gamma = ctx.get_param_float("gamma")? as f32;
        let out_black = ctx.get_param_float("out_black")? as f32;
        let out_white = ctx.get_param_float("out_white")? as f32;
        let input_range = in_white - in_black;
        let inv_input_range = if input_range.abs() > f32::EPSILON {
            1.0 / input_range
        } else {
            0.0
        };
        let inv_gamma = if gamma.abs() > f32::EPSILON {
            1.0 / gamma
        } else {
            1.0
        };
        let output_range = out_white - out_black;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut rgb = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                let a = image.data[idx + 3];
                for c in 0..3 {
                    let mut v = (rgb[c] - in_black) * inv_input_range;
                    v = v.clamp(0.0, 1.0);
                    v = v.powf(inv_gamma);
                    v = out_black + v * output_range;
                    rgb[c] = v;
                }
                out[0] = rgb[0];
                out[1] = rgb[1];
                out[2] = rgb[2];
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct Curves;

impl Curves {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Curves {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "curves".to_string(),
            display_name: "Curves".to_string(),
            category: "Color".to_string(),
            description: "Adjust curves".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "black_point".to_string(),
                    label: "Black Point".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "shadows".to_string(),
                    label: "Shadows".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.25),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "midtones".to_string(),
                    label: "Midtones".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "highlights".to_string(),
                    label: "Highlights".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.75),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "white_point".to_string(),
                    label: "White Point".to_string(),
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
        let image = ctx.get_input_image("image")?;
        let black_point = ctx.get_param_float("black_point")? as f32;
        let shadows = ctx.get_param_float("shadows")? as f32;
        let midtones = ctx.get_param_float("midtones")? as f32;
        let highlights = ctx.get_param_float("highlights")? as f32;
        let white_point = ctx.get_param_float("white_point")? as f32;
        let lut = build_curves_lut(black_point, shadows, midtones, highlights, white_point);
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut rgb = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                let a = image.data[idx + 3];
                for c in 0..3 {
                    let lut_idx = (rgb[c].clamp(0.0, 1.0) * CURVE_LUT_SCALE) as usize;
                    rgb[c] = lut[lut_idx];
                }
                out[0] = rgb[0];
                out[1] = rgb[1];
                out[2] = rgb[2];
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct ColorBalance;

impl ColorBalance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ColorBalance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_balance".to_string(),
            display_name: "Color Balance".to_string(),
            category: "Color".to_string(),
            description: "Adjust color balance".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "shadow_r".to_string(),
                    label: "Shadow R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "shadow_g".to_string(),
                    label: "Shadow G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "shadow_b".to_string(),
                    label: "Shadow B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "mid_r".to_string(),
                    label: "Mid R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "mid_g".to_string(),
                    label: "Mid G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "mid_b".to_string(),
                    label: "Mid B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "highlight_r".to_string(),
                    label: "Highlight R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "highlight_g".to_string(),
                    label: "Highlight G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "highlight_b".to_string(),
                    label: "Highlight B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let shadow_r = ctx.get_param_float("shadow_r")? as f32;
        let shadow_g = ctx.get_param_float("shadow_g")? as f32;
        let shadow_b = ctx.get_param_float("shadow_b")? as f32;
        let mid_r = ctx.get_param_float("mid_r")? as f32;
        let mid_g = ctx.get_param_float("mid_g")? as f32;
        let mid_b = ctx.get_param_float("mid_b")? as f32;
        let highlight_r = ctx.get_param_float("highlight_r")? as f32;
        let highlight_g = ctx.get_param_float("highlight_g")? as f32;
        let highlight_b = ctx.get_param_float("highlight_b")? as f32;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut r = image.data[idx];
                let mut g = image.data[idx + 1];
                let mut b = image.data[idx + 2];
                let a = image.data[idx + 3];
                let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let shadow_weight = (1.0 - luminance * 2.0).clamp(0.0, 1.0);
                let highlight_weight = (luminance * 2.0 - 1.0).clamp(0.0, 1.0);
                let mid_weight = (1.0 - shadow_weight - highlight_weight).clamp(0.0, 1.0);
                r += shadow_r * shadow_weight + mid_r * mid_weight + highlight_r * highlight_weight;
                g += shadow_g * shadow_weight + mid_g * mid_weight + highlight_g * highlight_weight;
                b += shadow_b * shadow_weight + mid_b * mid_weight + highlight_b * highlight_weight;
                r = r.clamp(0.0, 1.0);
                g = g.clamp(0.0, 1.0);
                b = b.clamp(0.0, 1.0);
                out[0] = r;
                out[1] = g;
                out[2] = b;
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct ChannelShuffle;

impl ChannelShuffle {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ChannelShuffle {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "channel_shuffle".to_string(),
            display_name: "Channel Shuffle".to_string(),
            category: "Color".to_string(),
            description: "Shuffle channels".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "r_source".to_string(),
                    label: "R Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Red".to_string(),
                        "Green".to_string(),
                        "Blue".to_string(),
                        "Alpha".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "g_source".to_string(),
                    label: "G Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Red".to_string(),
                        "Green".to_string(),
                        "Blue".to_string(),
                        "Alpha".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "b_source".to_string(),
                    label: "B Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(2),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Red".to_string(),
                        "Green".to_string(),
                        "Blue".to_string(),
                        "Alpha".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "a_source".to_string(),
                    label: "A Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(3),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Red".to_string(),
                        "Green".to_string(),
                        "Blue".to_string(),
                        "Alpha".to_string(),
                    ]),
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let r_source = clamp_channel_source(ctx.get_param_int("r_source")?);
        let g_source = clamp_channel_source(ctx.get_param_int("g_source")?);
        let b_source = clamp_channel_source(ctx.get_param_int("b_source")?);
        let a_source = clamp_channel_source(ctx.get_param_int("a_source")?);
        let sources = [r_source, g_source, b_source, a_source];
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let channels = [
                    image.data[idx],
                    image.data[idx + 1],
                    image.data[idx + 2],
                    image.data[idx + 3],
                ];
                out[0] = channels[sources[0]];
                out[1] = channels[sources[1]];
                out[2] = channels[sources[2]];
                out[3] = channels[sources[3]];
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct Threshold;

impl Threshold {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Threshold {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "threshold".to_string(),
            display_name: "Threshold".to_string(),
            category: "Color".to_string(),
            description: "Threshold image".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                key: "threshold".to_string(),
                label: "Threshold".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
            }],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let threshold = ctx.get_param_float("threshold")? as f32;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let r = image.data[idx];
                let g = image.data[idx + 1];
                let b = image.data[idx + 2];
                let a = image.data[idx + 3];
                let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let value = if luminance >= threshold { 1.0 } else { 0.0 };
                out[0] = value;
                out[1] = value;
                out[2] = value;
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct Posterize;

impl Posterize {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Posterize {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "posterize".to_string(),
            display_name: "Posterize".to_string(),
            category: "Color".to_string(),
            description: "Posterize image".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                key: "levels".to_string(),
                label: "Levels".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(8),
                min: Some(2.0),
                max: Some(256.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let levels = ctx.get_param_int("levels")?.clamp(2, 256) as i32;
        let max_level = (levels - 1) as f32;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut rgb = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                let a = image.data[idx + 3];
                for c in 0..3 {
                    let v = rgb[c].clamp(0.0, 1.0);
                    rgb[c] = ((v * max_level) + 0.5).floor() / max_level;
                }
                out[0] = rgb[0];
                out[1] = rgb[1];
                out[2] = rgb[2];
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct Gamma;

impl Gamma {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Gamma {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gamma".to_string(),
            display_name: "Gamma".to_string(),
            category: "Color".to_string(),
            description: "Adjust gamma".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                key: "gamma".to_string(),
                label: "Gamma".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.1),
                max: Some(10.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
            }],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let gamma = ctx.get_param_float("gamma")? as f32;
        let passthrough = (gamma - 1.0).abs() <= f32::EPSILON;
        let inv_gamma = if gamma.abs() > f32::EPSILON {
            1.0 / gamma
        } else {
            1.0
        };
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        if passthrough {
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    out[0] = image.data[idx];
                    out[1] = image.data[idx + 1];
                    out[2] = image.data[idx + 2];
                    out[3] = image.data[idx + 3];
                });
        } else {
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let mut rgb = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                    let a = image.data[idx + 3];
                    for c in 0..3 {
                        rgb[c] = rgb[c].powf(inv_gamma);
                    }
                    out[0] = rgb[0];
                    out[1] = rgb[1];
                    out[2] = rgb[2];
                    out[3] = a;
                });
        }
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct WhiteBalance;

impl WhiteBalance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for WhiteBalance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "white_balance".to_string(),
            display_name: "White Balance".to_string(),
            category: "Color".to_string(),
            description: "Adjust white balance".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "temperature".to_string(),
                    label: "Temperature".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "tint".to_string(),
                    label: "Tint".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let temperature = ctx.get_param_float("temperature")? as f32;
        let tint = ctx.get_param_float("tint")? as f32;
        let temp_factor = temperature * 0.5;
        let tint_factor = tint * 0.5;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut r = image.data[idx];
                let mut g = image.data[idx + 1];
                let mut b = image.data[idx + 2];
                let a = image.data[idx + 3];
                r *= 1.0 + temp_factor;
                g *= 1.0 - tint_factor;
                b *= 1.0 - temp_factor;
                r = r.clamp(0.0, 1.0);
                g = g.clamp(0.0, 1.0);
                b = b.clamp(0.0, 1.0);
                out[0] = r;
                out[1] = g;
                out[2] = b;
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct Vibrance;

impl Vibrance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Vibrance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "vibrance".to_string(),
            display_name: "Vibrance".to_string(),
            category: "Color".to_string(),
            description: "Selectively boost saturation".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                key: "vibrance".to_string(),
                label: "Vibrance".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
            }],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let vibrance = ctx.get_param_float("vibrance")? as f32;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let r = image.data[idx];
                let g = image.data[idx + 1];
                let b = image.data[idx + 2];
                let a = image.data[idx + 3];
                let (h, s, l) = rgb_to_hsl(r, g, b);
                let sat_boost = vibrance * (1.0 - s);
                let new_s = (s * (1.0 + sat_boost)).clamp(0.0, 1.0);
                let (nr, ng, nb) = hsl_to_rgb(h, new_s, l);
                out[0] = nr;
                out[1] = ng;
                out[2] = nb;
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct GradientMap;

impl GradientMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for GradientMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gradient_map".to_string(),
            display_name: "Gradient Map".to_string(),
            category: "Color".to_string(),
            description: "Map luminance to a color gradient".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "color_low_r".to_string(),
                    label: "Color Low R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_low_g".to_string(),
                    label: "Color Low G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_low_b".to_string(),
                    label: "Color Low B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_mid_r".to_string(),
                    label: "Color Mid R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_mid_g".to_string(),
                    label: "Color Mid G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_mid_b".to_string(),
                    label: "Color Mid B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_high_r".to_string(),
                    label: "Color High R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_high_g".to_string(),
                    label: "Color High G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color_high_b".to_string(),
                    label: "Color High B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "strength".to_string(),
                    label: "Strength".to_string(),
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
        let image = ctx.get_input_image("image")?;
        let color_low_r = ctx.get_param_float("color_low_r")? as f32;
        let color_low_g = ctx.get_param_float("color_low_g")? as f32;
        let color_low_b = ctx.get_param_float("color_low_b")? as f32;
        let color_mid_r = ctx.get_param_float("color_mid_r")? as f32;
        let color_mid_g = ctx.get_param_float("color_mid_g")? as f32;
        let color_mid_b = ctx.get_param_float("color_mid_b")? as f32;
        let color_high_r = ctx.get_param_float("color_high_r")? as f32;
        let color_high_g = ctx.get_param_float("color_high_g")? as f32;
        let color_high_b = ctx.get_param_float("color_high_b")? as f32;
        let strength = ctx.get_param_float("strength")? as f32;
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let r = image.data[idx];
                let g = image.data[idx + 1];
                let b = image.data[idx + 2];
                let a = image.data[idx + 3];
                let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let (mr, mg, mb) = if luminance < 0.5 {
                    let t = luminance * 2.0;
                    (
                        lerp(color_low_r, color_mid_r, t),
                        lerp(color_low_g, color_mid_g, t),
                        lerp(color_low_b, color_mid_b, t),
                    )
                } else {
                    let t = (luminance - 0.5) * 2.0;
                    (
                        lerp(color_mid_r, color_high_r, t),
                        lerp(color_mid_g, color_high_g, t),
                        lerp(color_mid_b, color_high_b, t),
                    )
                };
                let out_r = lerp(r, mr, strength).clamp(0.0, 1.0);
                let out_g = lerp(g, mg, strength).clamp(0.0, 1.0);
                let out_b = lerp(b, mb, strength).clamp(0.0, 1.0);
                out[0] = out_r;
                out[1] = out_g;
                out[2] = out_b;
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

pub struct ToneMap;

impl ToneMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ToneMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "tone_map".to_string(),
            display_name: "Tone Map".to_string(),
            category: "Color".to_string(),
            description: "Apply tone mapping".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
                    key: "method".to_string(),
                    label: "Method".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Reinhard".to_string(),
                        "ACES Filmic".to_string(),
                        "Uncharted 2".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "exposure".to_string(),
                    label: "Exposure".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-5.0),
                    max: Some(5.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let image = ctx.get_input_image("image")?;
        let method = ctx.get_param_int("method")?.clamp(0, 2);
        let exposure = ctx.get_param_float("exposure")? as f32;
        let exposure_scale = 2.0_f32.powf(exposure);
        let pixel_count = image.pixel_count();
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let idx = i * 4;
                let mut r = image.data[idx] * exposure_scale;
                let mut g = image.data[idx + 1] * exposure_scale;
                let mut b = image.data[idx + 2] * exposure_scale;
                let a = image.data[idx + 3];
                match method {
                    0 => {
                        r = r / (1.0 + r);
                        g = g / (1.0 + g);
                        b = b / (1.0 + b);
                    }
                    1 => {
                        r = (r * (2.51 * r + 0.03)) / (r * (2.43 * r + 0.59) + 0.14);
                        g = (g * (2.51 * g + 0.03)) / (g * (2.43 * g + 0.59) + 0.14);
                        b = (b * (2.51 * b + 0.03)) / (b * (2.43 * b + 0.59) + 0.14);
                    }
                    _ => {
                        r = tone_map_hable(r);
                        g = tone_map_hable(g);
                        b = tone_map_hable(b);
                    }
                }
                out[0] = r.clamp(0.0, 1.0);
                out[1] = g.clamp(0.0, 1.0);
                out[2] = b.clamp(0.0, 1.0);
                out[3] = a;
            });
        let output = Image::from_f32_data(image.width, image.height, data);
        let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
            let original = ctx.get_input_image("image")?;
            crate::mask_utils::apply_mask(original, &output, mask)
        } else {
            output
        };
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

fn build_curves_lut(
    black_point: f32,
    shadows: f32,
    midtones: f32,
    highlights: f32,
    white_point: f32,
) -> Vec<f32> {
    let mut lut = vec![0.0f32; CURVE_LUT_SIZE];
    for i in 0..CURVE_LUT_SIZE {
        let x = i as f32 / CURVE_LUT_SCALE;
        lut[i] = eval_curve(x, black_point, shadows, midtones, highlights, white_point);
    }
    lut
}

fn eval_curve(
    x: f32,
    black_point: f32,
    shadows: f32,
    midtones: f32,
    highlights: f32,
    white_point: f32,
) -> f32 {
    if x <= 0.25 {
        lerp(black_point, shadows, x / 0.25)
    } else if x <= 0.5 {
        lerp(shadows, midtones, (x - 0.25) / 0.25)
    } else if x <= 0.75 {
        lerp(midtones, highlights, (x - 0.5) / 0.25)
    } else {
        lerp(highlights, white_point, (x - 0.75) / 0.25)
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) * 0.5;
    let delta = max - min;
    if delta == 0.0 {
        return (0.0, 0.0, l);
    }
    let s = delta / (1.0 - (2.0 * l - 1.0).abs());
    let mut h = if max == r {
        ((g - b) / delta) % 6.0
    } else if max == g {
        ((b - r) / delta) + 2.0
    } else {
        ((r - g) / delta) + 4.0
    };
    h *= 60.0;
    if h < 0.0 {
        h += 360.0;
    }
    (h, s, l)
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h / 60.0;
    let x = c * (1.0 - ((h_prime % 2.0) - 1.0).abs());
    let (r1, g1, b1) = if (0.0..1.0).contains(&h_prime) {
        (c, x, 0.0)
    } else if (1.0..2.0).contains(&h_prime) {
        (x, c, 0.0)
    } else if (2.0..3.0).contains(&h_prime) {
        (0.0, c, x)
    } else if (3.0..4.0).contains(&h_prime) {
        (0.0, x, c)
    } else if (4.0..5.0).contains(&h_prime) {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    let m = l - c * 0.5;
    (r1 + m, g1 + m, b1 + m)
}

fn tone_map_hable(v: f32) -> f32 {
    let a = 0.15;
    let b = 0.50;
    let c = 0.10;
    let d = 0.20;
    let e = 0.02;
    let f = 0.30;
    (v * (a * v + c * b) + d * e) / (v * (a * v + b) + d * f) - e / f
}

fn clamp_channel_source(value: i64) -> usize {
    if value < 0 {
        0
    } else if value > 3 {
        3
    } else {
        value as usize
    }
}
