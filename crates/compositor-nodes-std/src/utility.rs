use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct MapRange;

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
                    for c in 0..3 {
                        let mapped = if denom.abs() > f32::EPSILON {
                            (rgb[c] - from_min) / denom * (to_max - to_min) + to_min
                        } else {
                            to_min
                        };
                        let mut value = mapped;
                        if clamp {
                            value = value.clamp(clamp_min, clamp_max);
                        }
                        rgb[c] = value;
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
            );
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
            description: "Apply math operations".to_string(),
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
            );
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

fn luminance_at(image: &Image, idx: usize) -> f32 {
    let r = image.data[idx];
    let g = image.data[idx + 1];
    let b = image.data[idx + 2];
    0.2126 * r + 0.7152 * g + 0.0722 * b
}
