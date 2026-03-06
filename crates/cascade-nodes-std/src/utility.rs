use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use std::any::Any;
use std::collections::HashMap;

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
