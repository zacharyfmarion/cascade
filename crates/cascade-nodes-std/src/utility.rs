use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct MapRange;

impl Default for MapRange {
    fn default() -> Self {
        Self::new()
    }
}

impl MapRange {
    pub fn new() -> Self {
        Self
    }
}

impl Node for MapRange {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "map_range".to_string(),
            display_name: "Map Range".to_string(),
            category: "Utility".to_string(),
            description: "Map values from one range to another".to_string(),
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
                    key: "from_min".to_string(),
                    label: "From Min".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "from_max".to_string(),
                    label: "From Max".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "to_min".to_string(),
                    label: "To Min".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "to_max".to_string(),
                    label: "To Max".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "clamp".to_string(),
                    label: "Clamp".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(true),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let from_min = ctx.get_param_float("from_min")? as f32;
            let from_max = ctx.get_param_float("from_max")? as f32;
            let to_min = ctx.get_param_float("to_min")? as f32;
            let to_max = ctx.get_param_float("to_max")? as f32;
            let clamp = ctx.get_param_bool("clamp")?;
            let denom = from_max - from_min;
            let clamp_min = to_min.min(to_max);
            let clamp_max = to_min.max(to_max);
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let mut rgb = [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                    let a = image.data[idx + 3];
                    for channel in rgb.iter_mut() {
                        let mapped = if denom.abs() > f32::EPSILON {
                            (*channel - from_min) / denom * (to_max - to_min) + to_min
                        } else {
                            to_min
                        };
                        let mut value = mapped;
                        if clamp {
                            value = value.clamp(clamp_min, clamp_max);
                        }
                        *channel = value;
                    }
                    out[0] = rgb[0];
                    out[1] = rgb[1];
                    out[2] = rgb[2];
                    out[3] = a;
                });
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                data,
                image.color_space.clone(),
            )?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output));
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

pub struct MathNode;

impl Default for MathNode {
    fn default() -> Self {
        Self::new()
    }
}

impl MathNode {
    pub fn new() -> Self {
        Self
    }
}

impl Node for MathNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "math".to_string(),
            display_name: "Math".to_string(),
            category: "Utility".to_string(),
            description: "Apply math operations on float values".to_string(),
            inputs: vec![
                PortSpec {
                    name: "a".to_string(),
                    label: "A".to_string(),
                    ty: ValueType::Float,
                    default: Some(ParamDefault::Float(0.0)),
                    min: None,
                    max: None,
                    step: Some(0.01),
                    ui_hint: Some(UiHint::NumberInput),
                },
                PortSpec {
                    name: "b".to_string(),
                    label: "B".to_string(),
                    ty: ValueType::Float,
                    default: Some(ParamDefault::Float(0.0)),
                    min: None,
                    max: None,
                    step: Some(0.01),
                    ui_hint: Some(UiHint::NumberInput),
                },
            ],
            outputs: vec![PortSpec {
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Float,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "operation".to_string(),
                    label: "Operation".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(13.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Add".to_string(),
                        "Subtract".to_string(),
                        "Multiply".to_string(),
                        "Divide".to_string(),
                        "Power".to_string(),
                        "Min".to_string(),
                        "Max".to_string(),
                        "Abs".to_string(),
                        "Greater Than".to_string(),
                        "Less Than".to_string(),
                        "Clamp".to_string(),
                        "Step".to_string(),
                        "Smooth Step".to_string(),
                        "Lerp".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "clamp_result".to_string(),
                    label: "Clamp Result".to_string(),
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
            let a_val = ctx.get_input_float("a")?;
            let b_val = ctx.get_input_float("b")?;
            let operation = ctx.get_param_int("operation")?.clamp(0, 13);
            let clamp_result = ctx.get_param_bool("clamp_result")?;
            let mut result = match operation {
                0 => a_val + b_val,
                1 => a_val - b_val,
                2 => a_val * b_val,
                3 => {
                    if b_val.abs() > f32::EPSILON {
                        a_val / b_val
                    } else {
                        0.0
                    }
                }
                4 => a_val.powf(b_val),
                5 => a_val.min(b_val),
                6 => a_val.max(b_val),
                7 => a_val.abs(),
                8 => {
                    if a_val > b_val {
                        1.0
                    } else {
                        0.0
                    }
                }
                9 => {
                    if a_val < b_val {
                        1.0
                    } else {
                        0.0
                    }
                }
                10 => a_val.clamp(0.0, b_val.max(0.0)),
                11 => {
                    if a_val >= b_val {
                        1.0
                    } else {
                        0.0
                    }
                }
                12 => smoothstep(0.0, b_val, a_val),
                13 => (a_val + b_val) * 0.5,
                _ => a_val,
            };
            if clamp_result {
                result = result.clamp(0.0, 1.0);
            }
            let mut outputs = HashMap::new();
            outputs.insert("value".to_string(), Value::Float(result));
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

/// Per-pixel luminance helper for ImageMath.
fn luminance_at(image: &Image, idx: usize) -> f32 {
    let r = image.data[idx];
    let g = image.data[idx + 1];
    let b = image.data[idx + 2];
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// Image-based math node: applies math operations per-pixel on images.
/// Used internally by builtin groups like Color Range.
pub struct ImageMath;

impl Default for ImageMath {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageMath {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ImageMath {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "image_math".to_string(),
            display_name: "Image Math".to_string(),
            category: "Utility".to_string(),
            description: "Apply math operations per-pixel on images".to_string(),
            inputs: vec![
                PortSpec {
                    name: "a".to_string(),
                    label: "A".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "b".to_string(),
                    label: "B".to_string(),
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
                    key: "operation".to_string(),
                    label: "Operation".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(13.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Add".to_string(),
                        "Subtract".to_string(),
                        "Multiply".to_string(),
                        "Divide".to_string(),
                        "Power".to_string(),
                        "Min".to_string(),
                        "Max".to_string(),
                        "Abs".to_string(),
                        "Greater Than".to_string(),
                        "Less Than".to_string(),
                        "Clamp".to_string(),
                        "Step".to_string(),
                        "Smooth Step".to_string(),
                        "Lerp".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "value".to_string(),
                    label: "Value".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "clamp_result".to_string(),
                    label: "Clamp Result".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let a_image = ctx.get_input_image("a")?;
            let b_image = ctx.get_optional_input_image("b");
            let operation = ctx.get_param_int("operation")?.clamp(0, 13);
            let value_param = ctx.get_param_float("value")? as f32;
            let clamp_result = ctx.get_param_bool("clamp_result")?;
            let pixel_count = a_image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let a_channels = [
                        a_image.data[idx],
                        a_image.data[idx + 1],
                        a_image.data[idx + 2],
                    ];
                    let a_alpha = a_image.data[idx + 3];
                    let b_val = b_image
                        .map(|image| luminance_at(image, idx))
                        .unwrap_or(value_param);
                    let mut out_rgb = [0.0f32; 3];
                    for c in 0..3 {
                        let a_val = a_channels[c];
                        let mut result = match operation {
                            0 => a_val + b_val,
                            1 => a_val - b_val,
                            2 => a_val * b_val,
                            3 => {
                                if b_val > 0.0001 {
                                    a_val / b_val
                                } else {
                                    0.0
                                }
                            }
                            4 => a_val.powf(b_val),
                            5 => a_val.min(b_val),
                            6 => a_val.max(b_val),
                            7 => a_val.abs(),
                            8 => {
                                if a_val > b_val {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            9 => {
                                if a_val < b_val {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            10 => a_val.clamp(0.0, 1.0),
                            11 => {
                                if a_val >= b_val {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            12 => smoothstep(0.0, b_val, a_val),
                            13 => {
                                let t = value_param;
                                let b_channel = b_val;
                                a_val * (1.0 - t) + b_channel * t
                            }
                            _ => a_val,
                        };
                        if clamp_result {
                            result = result.clamp(0.0, 1.0);
                        }
                        out_rgb[c] = result;
                    }
                    out[0] = out_rgb[0];
                    out[1] = out_rgb[1];
                    out[2] = out_rgb[2];
                    out[3] = a_alpha;
                });
            let output = Image::new_with_domain(
                a_image.format.clone(),
                a_image.data_window,
                data,
                a_image.color_space.clone(),
            )?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output));
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

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let denom = edge1 - edge0;
    if denom.abs() <= f32::EPSILON {
        return if x < edge0 { 0.0 } else { 1.0 };
    }
    let t = ((x - edge0) / denom).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub struct Dot;

impl Default for Dot {
    fn default() -> Self {
        Self::new()
    }
}

impl Dot {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Dot {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "dot".to_string(),
            display_name: "Dot".to_string(),
            category: "Utility".to_string(),
            description: "Pass-through node for graph organization".to_string(),
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
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(image.clone()));
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

pub struct ProjectInfo;

impl Default for ProjectInfo {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectInfo {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ProjectInfo {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "project_info".to_string(),
            display_name: "Project Info".to_string(),
            category: "Utility".to_string(),
            description: "Output project metadata (resolution, frame, pixel aspect ratio)"
                .to_string(),
            inputs: vec![],
            outputs: vec![
                PortSpec {
                    name: "width".to_string(),
                    label: "Width".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "pixel_aspect".to_string(),
                    label: "Pixel Aspect".to_string(),
                    ty: ValueType::Float,
                    ..Default::default()
                },
                PortSpec {
                    name: "frame".to_string(),
                    label: "Frame".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
            ],
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let fmt = ctx.project_format;
            let mut outputs = HashMap::new();
            outputs.insert("width".to_string(), Value::Int(fmt.width() as i32));
            outputs.insert("height".to_string(), Value::Int(fmt.height() as i32));
            outputs.insert(
                "pixel_aspect".to_string(),
                Value::Float(fmt.pixel_aspect.as_f32()),
            );
            outputs.insert("frame".to_string(), Value::Int(ctx.frame_time.frame as i32));
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

pub struct ImageInfo;

impl Default for ImageInfo {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageInfo {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ImageInfo {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "image_info".to_string(),
            display_name: "Image Info".to_string(),
            category: "Utility".to_string(),
            description: "Output image metadata (dimensions, data window, pixel count)".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![
                PortSpec {
                    name: "width".to_string(),
                    label: "Width".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "aspect_ratio".to_string(),
                    label: "Aspect Ratio".to_string(),
                    ty: ValueType::Float,
                    ..Default::default()
                },
                PortSpec {
                    name: "pixel_count".to_string(),
                    label: "Pixel Count".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "dw_x".to_string(),
                    label: "DW X".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
                PortSpec {
                    name: "dw_y".to_string(),
                    label: "DW Y".to_string(),
                    ty: ValueType::Int,
                    ..Default::default()
                },
            ],
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let w = image.width as i32;
            let h = image.height as i32;
            let aspect = if h > 0 { w as f32 / h as f32 } else { 0.0 };

            let mut outputs = HashMap::new();
            outputs.insert("width".to_string(), Value::Int(w));
            outputs.insert("height".to_string(), Value::Int(h));
            outputs.insert("aspect_ratio".to_string(), Value::Float(aspect));
            outputs.insert("pixel_count".to_string(), Value::Int(w * h));
            outputs.insert("dw_x".to_string(), Value::Int(image.data_window.min.x));
            outputs.insert("dw_y".to_string(), Value::Int(image.data_window.min.y));
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
