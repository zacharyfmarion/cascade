use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use std::any::Any;
use std::collections::HashMap;
use std::f32::consts::PI;

pub struct SolidColor;

impl SolidColor {
    pub fn new() -> Self {
        Self
    }
}

impl Node for SolidColor {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "solid_color".to_string(),
            display_name: "Solid Color".to_string(),
            category: "Generator".to_string(),
            description: "Generate a solid color image".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            params: vec![
                ParamSpec {
                    key: "r".to_string(),
                    label: "Red".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "g".to_string(),
                    label: "Green".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "b".to_string(),
                    label: "Blue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "a".to_string(),
                    label: "Alpha".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_x".to_string(),
                    label: "Offset X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_y".to_string(),
                    label: "Offset Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "rotation".to_string(),
                    label: "Rotation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(360.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let r = ctx.get_param_float("r")? as f32;
            let g = ctx.get_param_float("g")? as f32;
            let b = ctx.get_param_float("b")? as f32;
            let a = ctx.get_param_float("a")? as f32;
            let field = Field::with_transform(move |_, _| [r, g, b, a], transform);
            let mut outputs = HashMap::new();
            outputs.insert("field".to_string(), Value::Field(field));
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

pub struct Noise;

impl Noise {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Noise {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "noise".to_string(),
            display_name: "Noise".to_string(),
            category: "Generator".to_string(),
            description: "Generate procedural noise".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            params: vec![
                ParamSpec {
                    key: "seed".to_string(),
                    label: "Seed".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(42),
                    min: Some(0.0),
                    max: Some(99999.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "monochrome".to_string(),
                    label: "Monochrome".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(true),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                },
                ParamSpec {
                    key: "intensity".to_string(),
                    label: "Intensity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_x".to_string(),
                    label: "Offset X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_y".to_string(),
                    label: "Offset Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "rotation".to_string(),
                    label: "Rotation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(360.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let seed = ctx.get_param_int("seed")? as f32;
            let monochrome = ctx.get_param_bool("monochrome")?;
            let intensity = ctx.get_param_float("intensity")? as f32;
            let field = Field::with_transform(
                move |u, v| {
                    let noise_u = u * 1000.0;
                    let noise_v = v * 1000.0;
                    if monochrome {
                        let value = hash_noise(noise_u, noise_v, seed) * intensity;
                        [value, value, value, 1.0]
                    } else {
                        let r = hash_noise(noise_u, noise_v, seed) * intensity;
                        let g = hash_noise(noise_u, noise_v, seed + 1.0) * intensity;
                        let b = hash_noise(noise_u, noise_v, seed + 2.0) * intensity;
                        [r, g, b, 1.0]
                    }
                },
                transform,
            );
            let mut outputs = HashMap::new();
            outputs.insert("field".to_string(), Value::Field(field));
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

pub struct Gradient;

impl Gradient {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Gradient {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gradient".to_string(),
            display_name: "Gradient".to_string(),
            category: "Generator".to_string(),
            description: "Generate a gradient image".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            params: vec![
                ParamSpec {
                    key: "direction".to_string(),
                    label: "Direction".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Horizontal".to_string(),
                        "Vertical".to_string(),
                        "Radial".to_string(),
                        "Angular".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "start_r".to_string(),
                    label: "Start Red".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "start_g".to_string(),
                    label: "Start Green".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "start_b".to_string(),
                    label: "Start Blue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "end_r".to_string(),
                    label: "End Red".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "end_g".to_string(),
                    label: "End Green".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "end_b".to_string(),
                    label: "End Blue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_x".to_string(),
                    label: "Offset X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_y".to_string(),
                    label: "Offset Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "rotation".to_string(),
                    label: "Rotation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(360.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let direction = ctx.get_param_int("direction")?;
            let start_r = ctx.get_param_float("start_r")? as f32;
            let start_g = ctx.get_param_float("start_g")? as f32;
            let start_b = ctx.get_param_float("start_b")? as f32;
            let end_r = ctx.get_param_float("end_r")? as f32;
            let end_g = ctx.get_param_float("end_g")? as f32;
            let end_b = ctx.get_param_float("end_b")? as f32;
            let max_dist = (0.5f32 * 0.5f32 * 2.0).sqrt();
            let inv_max_dist = if max_dist > 0.0 { 1.0 / max_dist } else { 0.0 };
            let two_pi = 2.0 * PI;
            let field = Field::with_transform(
                move |u, v| {
                    let t = match direction {
                        0 => u,
                        1 => v,
                        2 => {
                            let dx = u - 0.5;
                            let dy = v - 0.5;
                            (dx * dx + dy * dy).sqrt() * inv_max_dist
                        }
                        3 => {
                            let angle = (v - 0.5).atan2(u - 0.5);
                            (angle + PI) / two_pi
                        }
                        _ => u,
                    }
                    .clamp(0.0, 1.0);
                    let r = lerp(start_r, end_r, t).clamp(0.0, 1.0);
                    let g = lerp(start_g, end_g, t).clamp(0.0, 1.0);
                    let b = lerp(start_b, end_b, t).clamp(0.0, 1.0);
                    [r, g, b, 1.0]
                },
                transform,
            );
            let mut outputs = HashMap::new();
            outputs.insert("field".to_string(), Value::Field(field));
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

pub struct Checkerboard;

impl Checkerboard {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Checkerboard {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "checkerboard".to_string(),
            display_name: "Checkerboard".to_string(),
            category: "Generator".to_string(),
            description: "Generate a checkerboard pattern".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            params: vec![
                ParamSpec {
                    key: "size".to_string(),
                    label: "Size".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(8),
                    min: Some(1.0),
                    max: Some(128.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "color1_r".to_string(),
                    label: "Color 1 Red".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color1_g".to_string(),
                    label: "Color 1 Green".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color1_b".to_string(),
                    label: "Color 1 Blue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color2_r".to_string(),
                    label: "Color 2 Red".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.2),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color2_g".to_string(),
                    label: "Color 2 Green".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.2),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "color2_b".to_string(),
                    label: "Color 2 Blue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.2),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_x".to_string(),
                    label: "Offset X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_y".to_string(),
                    label: "Offset Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "rotation".to_string(),
                    label: "Rotation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(360.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let size = ctx.get_param_int("size")? as u32;
            let color1_r = ctx.get_param_float("color1_r")? as f32;
            let color1_g = ctx.get_param_float("color1_g")? as f32;
            let color1_b = ctx.get_param_float("color1_b")? as f32;
            let color2_r = ctx.get_param_float("color2_r")? as f32;
            let color2_g = ctx.get_param_float("color2_g")? as f32;
            let color2_b = ctx.get_param_float("color2_b")? as f32;
            let field = Field::with_transform(
                move |u, v| {
                    let tile_x = (u * size as f32).floor() as u32;
                    let tile_y = (v * size as f32).floor() as u32;
                    let tile = (tile_x + tile_y) % 2;
                    let (r, g, b) = if tile == 0 {
                        (color1_r, color1_g, color1_b)
                    } else {
                        (color2_r, color2_g, color2_b)
                    };
                    [r, g, b, 1.0]
                },
                transform,
            );
            let mut outputs = HashMap::new();
            outputs.insert("field".to_string(), Value::Field(field));
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

pub struct Shape;

impl Shape {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Shape {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "shape".to_string(),
            display_name: "Shape".to_string(),
            category: "Generator".to_string(),
            description: "Generate a shape mask".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            params: vec![
                ParamSpec {
                    key: "shape".to_string(),
                    label: "Shape".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Ellipse".to_string(),
                        "Rectangle".to_string(),
                        "Rounded Rectangle".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "center_x".to_string(),
                    label: "Center X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "center_y".to_string(),
                    label: "Center Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "size_x".to_string(),
                    label: "Size X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.01),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "size_y".to_string(),
                    label: "Size Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.01),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "corner_radius".to_string(),
                    label: "Corner Radius".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.1),
                    min: Some(0.0),
                    max: Some(0.5),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "feather".to_string(),
                    label: "Feather".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(0.5),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "invert".to_string(),
                    label: "Invert".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_x".to_string(),
                    label: "Offset X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "offset_y".to_string(),
                    label: "Offset Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-10.0),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "rotation".to_string(),
                    label: "Rotation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(360.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let shape = ctx.get_param_int("shape")?.clamp(0, 2);
            let center_x = ctx.get_param_float("center_x")? as f32;
            let center_y = ctx.get_param_float("center_y")? as f32;
            let size_x = ctx.get_param_float("size_x")? as f32;
            let size_y = ctx.get_param_float("size_y")? as f32;
            let corner_radius = ctx.get_param_float("corner_radius")? as f32;
            let feather = ctx.get_param_float("feather")? as f32;
            let invert = ctx.get_param_bool("invert")?;
            let half_size_x = (size_x * 0.5).max(f32::EPSILON);
            let half_size_y = (size_y * 0.5).max(f32::EPSILON);
            let corner_radius = corner_radius.min(half_size_x.min(half_size_y));
            let feather = feather.max(0.0);
            let field = Field::with_transform(
                move |u, v| {
                    let dx = u - center_x;
                    let dy = v - center_y;
                    let sdf = match shape {
                        0 => {
                            let nx = dx / half_size_x;
                            let ny = dy / half_size_y;
                            (nx * nx + ny * ny).sqrt() - 1.0
                        }
                        1 => {
                            let bx = dx.abs() - half_size_x;
                            let by = dy.abs() - half_size_y;
                            let ax = bx.max(0.0);
                            let ay = by.max(0.0);
                            (ax * ax + ay * ay).sqrt() + bx.max(by).min(0.0)
                        }
                        _ => {
                            let bx = dx.abs() - (half_size_x - corner_radius);
                            let by = dy.abs() - (half_size_y - corner_radius);
                            let ax = bx.max(0.0);
                            let ay = by.max(0.0);
                            (ax * ax + ay * ay).sqrt() + bx.max(by).min(0.0) - corner_radius
                        }
                    };
                    let mut value = if feather > f32::EPSILON {
                        1.0 - (sdf / feather).clamp(0.0, 1.0)
                    } else if sdf <= 0.0 {
                        1.0
                    } else {
                        0.0
                    };
                    if invert {
                        value = 1.0 - value;
                    }
                    [value, value, value, 1.0]
                },
                transform,
            );
            let mut outputs = HashMap::new();
            outputs.insert("field".to_string(), Value::Field(field));
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

pub struct RasterizeField;

impl RasterizeField {
    pub fn new() -> Self {
        Self
    }
}

impl Node for RasterizeField {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "rasterize_field".to_string(),
            display_name: "Rasterize Field".to_string(),
            category: "Generator".to_string(),
            description: "Convert a field to an image at a specific resolution".to_string(),
            inputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "width".to_string(),
                    label: "Width".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1920),
                    min: Some(1.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1080),
                    min: Some(1.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
            ],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let field = ctx.get_input_field("field")?;
            let width = ctx.get_param_int("width")? as u32;
            let height = ctx.get_param_int("height")? as u32;
            let image = field.rasterize(width, height);
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(image));
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

pub struct FloatConstant;

impl FloatConstant {
    pub fn new() -> Self {
        Self
    }
}

impl Node for FloatConstant {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "float_constant".to_string(),
            display_name: "Float".to_string(),
            category: "Generator".to_string(),
            description: "Output a constant float value".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Float,
            }],
            params: vec![ParamSpec {
                key: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.0),
                min: None,
                max: None,
                step: Some(0.01),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a> {
        Box::pin(async move {
            let value = ctx.get_param_float("value")? as f32;
            let mut outputs = HashMap::new();
            outputs.insert("value".to_string(), Value::Float(value));
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

pub struct IntegerConstant;

impl IntegerConstant {
    pub fn new() -> Self {
        Self
    }
}

impl Node for IntegerConstant {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "integer_constant".to_string(),
            display_name: "Integer".to_string(),
            category: "Generator".to_string(),
            description: "Output a constant integer value".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Int,
            }],
            params: vec![ParamSpec {
                key: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: None,
                max: None,
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a> {
        Box::pin(async move {
            let value = ctx.get_param_int("value")? as i32;
            let mut outputs = HashMap::new();
            outputs.insert("value".to_string(), Value::Int(value));
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

fn build_field_transform(ctx: &EvalContext) -> Result<FieldTransform, CompositorError> {
    let scale_x = ctx.get_param_float("scale_x")? as f32;
    let scale_y = ctx.get_param_float("scale_y")? as f32;
    let offset_x = ctx.get_param_float("offset_x")? as f32;
    let offset_y = ctx.get_param_float("offset_y")? as f32;
    let rotation = ctx.get_param_float("rotation")? as f32;
    Ok(FieldTransform {
        scale: [scale_x, scale_y],
        offset: [offset_x, offset_y],
        rotation: rotation.to_radians(),
    })
}

fn hash_noise(x: f32, y: f32, seed: f32) -> f32 {
    let v = (x * 12.9898 + y * 78.233 + seed * 43758.5453).sin() * 43758.5453;
    v - v.floor()
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
