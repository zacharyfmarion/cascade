use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;
use std::f32::consts::PI;

pub struct SolidColor;

impl Default for SolidColor {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "color".to_string(),
                    label: "Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.5, 0.5, 0.5, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let color = ctx.get_param_color("color")?;
            let r = color[0] as f32;
            let g = color[1] as f32;
            let b = color[2] as f32;
            let a = color[3] as f32;
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

impl Default for Noise {
    fn default() -> Self {
        Self::new()
    }
}

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
            description: "Generate procedural Perlin noise with fractal layering".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "field".to_string(),
                label: "Field".to_string(),
                ty: ValueType::Field,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "noise_type".to_string(),
                    label: "Type".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "fBM".to_string(),
                        "Multifractal".to_string(),
                        "Ridged Multifractal".to_string(),
                    ]),
                    promotable: false,
                },
                ParamSpec {
                    key: "dimensions".to_string(),
                    label: "Dimensions".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["2D".to_string(), "3D".to_string()]),
                    promotable: false,
                },
                ParamSpec {
                    key: "seed".to_string(),
                    label: "Seed".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(99999.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "w".to_string(),
                    label: "W".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1000.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "noise_scale".to_string(),
                    label: "Scale".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(5.0),
                    min: Some(-1000.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "detail".to_string(),
                    label: "Detail".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(2.0),
                    min: Some(0.0),
                    max: Some(15.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "roughness".to_string(),
                    label: "Roughness".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "lacunarity".to_string(),
                    label: "Lacunarity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(2.0),
                    min: Some(0.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "distortion".to_string(),
                    label: "Distortion".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1000.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "offset_noise".to_string(),
                    label: "Offset".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1000.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "gain".to_string(),
                    label: "Gain".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1000.0),
                    step: Some(0.1),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "normalize".to_string(),
                    label: "Normalize".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(true),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let noise_type = ctx.get_param_int("noise_type")? as i32;
            let dimensions = ctx.get_param_int("dimensions")? as i32;
            let seed = ctx.get_param_int("seed")? as f32;
            let w = ctx.get_param_float("w")? as f32;
            let noise_scale = ctx.get_param_float("noise_scale")? as f32;
            let detail = (ctx.get_param_float("detail")? as f32).clamp(0.0, 15.0);
            let roughness = (ctx.get_param_float("roughness")? as f32).max(0.0);
            let lacunarity = ctx.get_param_float("lacunarity")? as f32;
            let distortion = ctx.get_param_float("distortion")? as f32;
            let offset_noise = ctx.get_param_float("offset_noise")? as f32;
            let gain = ctx.get_param_float("gain")? as f32;
            let normalize = ctx.get_param_bool("normalize")?;
            let monochrome = ctx.get_param_bool("monochrome")?;

            let np = NoiseParams {
                noise_type,
                detail,
                roughness,
                lacunarity,
                distortion,
                offset_n: offset_noise,
                gain,
                do_normalize: normalize,
            };

            let field = Field::with_transform(
                move |u, v| {
                    let x = u * noise_scale + seed * 100.0;
                    let y = v * noise_scale + seed * 71.0;

                    let val = if dimensions == 1 {
                        noise_eval_3d(x, y, w, &np)
                    } else {
                        noise_eval_2d(x, y, &np)
                    };

                    if monochrome {
                        [val, val, val, 1.0]
                    } else {
                        let r = val;
                        let g = if dimensions == 1 {
                            noise_eval_3d(x + 139.52, y + 186.41, w + 107.32, &np)
                        } else {
                            noise_eval_2d(x + 139.52, y + 186.41, &np)
                        };
                        let b = if dimensions == 1 {
                            noise_eval_3d(x + 273.84, y + 317.59, w + 251.68, &np)
                        } else {
                            noise_eval_2d(x + 273.84, y + 317.59, &np)
                        };
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

impl Default for Gradient {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
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
                    promotable: true,
                },
                ParamSpec {
                    key: "start_color".to_string(),
                    label: "Start Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.0, 0.0, 0.0, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
                },
                ParamSpec {
                    key: "end_color".to_string(),
                    label: "End Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([1.0, 1.0, 1.0, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let direction = ctx.get_param_int("direction")?;
            let start_color = ctx.get_param_color("start_color")?;
            let start_r = start_color[0] as f32;
            let start_g = start_color[1] as f32;
            let start_b = start_color[2] as f32;
            let end_color = ctx.get_param_color("end_color")?;
            let end_r = end_color[0] as f32;
            let end_g = end_color[1] as f32;
            let end_b = end_color[2] as f32;
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

impl Default for Checkerboard {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
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
                    promotable: true,
                },
                ParamSpec {
                    key: "color1".to_string(),
                    label: "Color 1".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.8, 0.8, 0.8, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
                },
                ParamSpec {
                    key: "color2".to_string(),
                    label: "Color 2".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.2, 0.2, 0.2, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let transform = build_field_transform(ctx)?;
            let size = ctx.get_param_int("size")? as u32;
            let c1 = ctx.get_param_color("color1")?;
            let color1_r = c1[0] as f32;
            let color1_g = c1[1] as f32;
            let color1_b = c1[2] as f32;
            let c2 = ctx.get_param_color("color2")?;
            let color2_r = c2[0] as f32;
            let color2_g = c2[1] as f32;
            let color2_b = c2[2] as f32;
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

impl Default for Shape {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
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

impl Default for RasterizeField {
    fn default() -> Self {
        Self::new()
    }
}

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
                    key: "width".to_string(),
                    label: "Width".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1920),
                    min: Some(1.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let field = ctx.get_input_field("field")?;
            let width = ctx.get_param_int("width")? as u32;
            let height = ctx.get_param_int("height")? as u32;
            let image = field.rasterize(width, height)?;
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

impl Default for FloatConstant {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
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
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
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

impl Default for IntegerConstant {
    fn default() -> Self {
        Self::new()
    }
}

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
                ..Default::default()
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
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
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

pub struct ColorConstant;

impl Default for ColorConstant {
    fn default() -> Self {
        Self::new()
    }
}

impl ColorConstant {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ColorConstant {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_constant".to_string(),
            display_name: "Color".to_string(),
            category: "Generator".to_string(),
            description: "Output a constant color value".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "color".to_string(),
                label: "Color".to_string(),
                ty: ValueType::Color,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "color".to_string(),
                label: "Color".to_string(),
                ty: ValueType::Color,
                default: ParamDefault::Color([1.0, 1.0, 1.0, 1.0]),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::ColorPicker,
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let color = ctx.get_param_color("color")?;
            let mut outputs = HashMap::new();
            outputs.insert(
                "color".to_string(),
                Value::Color([
                    color[0] as f32,
                    color[1] as f32,
                    color[2] as f32,
                    color[3] as f32,
                ]),
            );
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

pub struct BooleanConstant;

impl Default for BooleanConstant {
    fn default() -> Self {
        Self::new()
    }
}

impl BooleanConstant {
    pub fn new() -> Self {
        Self
    }
}

impl Node for BooleanConstant {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "boolean_constant".to_string(),
            display_name: "Boolean".to_string(),
            category: "Generator".to_string(),
            description: "Output a constant boolean value".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Bool,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "value".to_string(),
                label: "Value".to_string(),
                ty: ValueType::Bool,
                default: ParamDefault::Bool(false),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Checkbox,
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let value = ctx.get_param_bool("value")?;
            let mut outputs = HashMap::new();
            outputs.insert("value".to_string(), Value::Bool(value));
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

pub struct TextArea;

impl Default for TextArea {
    fn default() -> Self {
        Self::new()
    }
}

impl TextArea {
    pub fn new() -> Self {
        Self
    }
}

impl Node for TextArea {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "text_area".to_string(),
            display_name: "Text".to_string(),
            category: "Generator".to_string(),
            description: "Output a text string value".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "text".to_string(),
                label: "Text".to_string(),
                ty: ValueType::String,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "text".to_string(),
                label: String::new(),
                ty: ValueType::String,
                default: ParamDefault::String(String::new()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::TextArea,
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let text = ctx.get_param_string("text").unwrap_or("").to_string();
            let mut outputs = HashMap::new();
            outputs.insert("text".to_string(), Value::String(text));
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

#[derive(Clone, Copy)]
struct NoiseParams {
    noise_type: i32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
    distortion: f32,
    offset_n: f32,
    gain: f32,
    do_normalize: bool,
}

// ── Perlin noise primitives (matching Blender's noise.cc) ───────────

fn floor_fraction(x: f32) -> (i32, f32) {
    let xi = x.floor() as i32;
    let xf = x - x.floor();
    (xi, xf)
}

fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn noise_hash(x: u32, y: u32, z: u32) -> u32 {
    let mut a: u32 = 0xdeadbeef_u32.wrapping_add(3 << 2).wrapping_add(13);
    let mut b = a;
    let mut c = a;

    c = c.wrapping_add(z);
    b = b.wrapping_add(y);
    a = a.wrapping_add(x);

    c ^= b;
    c = c.wrapping_sub(b.rotate_left(14));
    a ^= c;
    a = a.wrapping_sub(c.rotate_left(11));
    b ^= a;
    b = b.wrapping_sub(a.rotate_left(25));
    c ^= b;
    c = c.wrapping_sub(b.rotate_left(16));
    a ^= c;
    a = a.wrapping_sub(c.rotate_left(4));
    b ^= a;
    b = b.wrapping_sub(a.rotate_left(14));
    c ^= b;
    c = c.wrapping_sub(b.rotate_left(24));

    c
}

fn noise_hash_2d(x: u32, y: u32) -> u32 {
    noise_hash(x, y, 0)
}

fn negate_if(val: f32, condition: bool) -> f32 {
    if condition {
        -val
    } else {
        val
    }
}

fn noise_grad_2d(hash: u32, x: f32, y: f32) -> f32 {
    let h = hash & 3;
    let u = if h & 1 == 0 { x } else { y };
    let v = if h & 1 == 0 { y } else { x };
    negate_if(u, h & 2 != 0) + negate_if(v, (h >> 1) ^ (h & 1) != 0)
}

fn noise_grad_3d(hash: u32, x: f32, y: f32, z: f32) -> f32 {
    let h = hash & 15;
    let u = if h < 8 { x } else { y };
    let vt = if h == 12 || h == 14 { x } else { z };
    let v = if h < 4 { y } else { vt };
    negate_if(u, h & 1 != 0) + negate_if(v, h & 2 != 0)
}

fn perlin_2d(x: f32, y: f32) -> f32 {
    let (xi, fx) = floor_fraction(x);
    let (yi, fy) = floor_fraction(y);

    let u = fade(fx);
    let v = fade(fy);

    let x0 = xi as u32;
    let x1 = x0.wrapping_add(1);
    let y0 = yi as u32;
    let y1 = y0.wrapping_add(1);

    let n00 = noise_grad_2d(noise_hash_2d(x0, y0), fx, fy);
    let n10 = noise_grad_2d(noise_hash_2d(x1, y0), fx - 1.0, fy);
    let n01 = noise_grad_2d(noise_hash_2d(x0, y1), fx, fy - 1.0);
    let n11 = noise_grad_2d(noise_hash_2d(x1, y1), fx - 1.0, fy - 1.0);

    let nx0 = lerp(n00, n10, u);
    let nx1 = lerp(n01, n11, u);
    lerp(nx0, nx1, v)
}

fn perlin_3d(x: f32, y: f32, z: f32) -> f32 {
    let (xi, fx) = floor_fraction(x);
    let (yi, fy) = floor_fraction(y);
    let (zi, fz) = floor_fraction(z);

    let u = fade(fx);
    let v = fade(fy);
    let w = fade(fz);

    let x0 = xi as u32;
    let x1 = x0.wrapping_add(1);
    let y0 = yi as u32;
    let y1 = y0.wrapping_add(1);
    let z0 = zi as u32;
    let z1 = z0.wrapping_add(1);

    let n000 = noise_grad_3d(noise_hash(x0, y0, z0), fx, fy, fz);
    let n100 = noise_grad_3d(noise_hash(x1, y0, z0), fx - 1.0, fy, fz);
    let n010 = noise_grad_3d(noise_hash(x0, y1, z0), fx, fy - 1.0, fz);
    let n110 = noise_grad_3d(noise_hash(x1, y1, z0), fx - 1.0, fy - 1.0, fz);
    let n001 = noise_grad_3d(noise_hash(x0, y0, z1), fx, fy, fz - 1.0);
    let n101 = noise_grad_3d(noise_hash(x1, y0, z1), fx - 1.0, fy, fz - 1.0);
    let n011 = noise_grad_3d(noise_hash(x0, y1, z1), fx, fy - 1.0, fz - 1.0);
    let n111 = noise_grad_3d(noise_hash(x1, y1, z1), fx - 1.0, fy - 1.0, fz - 1.0);

    let nx00 = lerp(n000, n100, u);
    let nx10 = lerp(n010, n110, u);
    let nx01 = lerp(n001, n101, u);
    let nx11 = lerp(n011, n111, u);

    let nxy0 = lerp(nx00, nx10, v);
    let nxy1 = lerp(nx01, nx11, v);

    lerp(nxy0, nxy1, w)
}

const PERLIN_SCALE_2D: f32 = 0.6616;
const PERLIN_SCALE_3D: f32 = 0.9820;
const PERLIN_WRAP: f32 = 100000.0;

fn perlin_signed_2d(x: f32, y: f32) -> f32 {
    let x = x % PERLIN_WRAP;
    let y = y % PERLIN_WRAP;
    perlin_2d(x, y) * PERLIN_SCALE_2D
}

fn perlin_signed_3d(x: f32, y: f32, z: f32) -> f32 {
    let x = x % PERLIN_WRAP;
    let y = y % PERLIN_WRAP;
    let z = z % PERLIN_WRAP;
    perlin_3d(x, y, z) * PERLIN_SCALE_3D
}

// ── Fractal noise types ─────────────────────────────────────────────

fn perlin_fbm_2d(
    x: f32,
    y: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
    do_normalize: bool,
) -> f32 {
    let mut fscale = 1.0_f32;
    let mut amp = 1.0_f32;
    let mut maxamp = 0.0_f32;
    let mut sum = 0.0_f32;

    let octaves = detail as i32;
    for _ in 0..=octaves {
        let t = perlin_signed_2d(x * fscale, y * fscale);
        sum += t * amp;
        maxamp += amp;
        amp *= roughness;
        fscale *= lacunarity;
    }

    let rmd = detail - detail.floor();
    if rmd != 0.0 {
        let t = perlin_signed_2d(x * fscale, y * fscale);
        let sum2 = sum + t * amp;
        if do_normalize {
            return lerp(
                0.5 * sum / maxamp + 0.5,
                0.5 * sum2 / (maxamp + amp) + 0.5,
                rmd,
            );
        } else {
            return lerp(sum, sum2, rmd);
        }
    }

    if do_normalize {
        0.5 * sum / maxamp + 0.5
    } else {
        sum
    }
}

fn perlin_fbm_3d(
    x: f32,
    y: f32,
    z: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
    do_normalize: bool,
) -> f32 {
    let mut fscale = 1.0_f32;
    let mut amp = 1.0_f32;
    let mut maxamp = 0.0_f32;
    let mut sum = 0.0_f32;

    let octaves = detail as i32;
    for _ in 0..=octaves {
        let t = perlin_signed_3d(x * fscale, y * fscale, z * fscale);
        sum += t * amp;
        maxamp += amp;
        amp *= roughness;
        fscale *= lacunarity;
    }

    let rmd = detail - detail.floor();
    if rmd != 0.0 {
        let t = perlin_signed_3d(x * fscale, y * fscale, z * fscale);
        let sum2 = sum + t * amp;
        if do_normalize {
            return lerp(
                0.5 * sum / maxamp + 0.5,
                0.5 * sum2 / (maxamp + amp) + 0.5,
                rmd,
            );
        } else {
            return lerp(sum, sum2, rmd);
        }
    }

    if do_normalize {
        0.5 * sum / maxamp + 0.5
    } else {
        sum
    }
}

fn perlin_multi_fractal_2d(
    mut x: f32,
    mut y: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
) -> f32 {
    let mut value = 1.0_f32;
    let mut pwr = 1.0_f32;

    let octaves = detail as i32;
    for _ in 0..=octaves {
        value *= pwr * perlin_signed_2d(x, y) + 1.0;
        pwr *= roughness;
        x *= lacunarity;
        y *= lacunarity;
    }

    let rmd = detail - detail.floor();
    if rmd != 0.0 {
        value *= rmd * pwr * perlin_signed_2d(x, y) + 1.0;
    }

    value
}

fn perlin_multi_fractal_3d(
    mut x: f32,
    mut y: f32,
    mut z: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
) -> f32 {
    let mut value = 1.0_f32;
    let mut pwr = 1.0_f32;

    let octaves = detail as i32;
    for _ in 0..=octaves {
        value *= pwr * perlin_signed_3d(x, y, z) + 1.0;
        pwr *= roughness;
        x *= lacunarity;
        y *= lacunarity;
        z *= lacunarity;
    }

    let rmd = detail - detail.floor();
    if rmd != 0.0 {
        value *= rmd * pwr * perlin_signed_3d(x, y, z) + 1.0;
    }

    value
}

fn perlin_ridged_2d(
    mut x: f32,
    mut y: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
    offset_n: f32,
    gain: f32,
) -> f32 {
    let mut pwr = roughness;

    let mut signal = offset_n - perlin_signed_2d(x, y).abs();
    signal *= signal;
    let mut value = signal;
    let mut weight: f32;

    let octaves = detail as i32;
    for _ in 1..=octaves {
        x *= lacunarity;
        y *= lacunarity;
        weight = (signal * gain).clamp(0.0, 1.0);
        signal = offset_n - perlin_signed_2d(x, y).abs();
        signal *= signal;
        signal *= weight;
        value += signal * pwr;
        pwr *= roughness;
    }

    value
}

#[allow(clippy::too_many_arguments)]
fn perlin_ridged_3d(
    mut x: f32,
    mut y: f32,
    mut z: f32,
    detail: f32,
    roughness: f32,
    lacunarity: f32,
    offset_n: f32,
    gain: f32,
) -> f32 {
    let mut pwr = roughness;

    let mut signal = offset_n - perlin_signed_3d(x, y, z).abs();
    signal *= signal;
    let mut value = signal;
    let mut weight: f32;

    let octaves = detail as i32;
    for _ in 1..=octaves {
        x *= lacunarity;
        y *= lacunarity;
        z *= lacunarity;
        weight = (signal * gain).clamp(0.0, 1.0);
        signal = offset_n - perlin_signed_3d(x, y, z).abs();
        signal *= signal;
        signal *= weight;
        value += signal * pwr;
        pwr *= roughness;
    }

    value
}

// ── Distortion (domain warping) ─────────────────────────────────────

fn distort_2d(x: f32, y: f32, strength: f32) -> (f32, f32) {
    if strength.abs() < f32::EPSILON {
        return (x, y);
    }
    let dx = perlin_signed_2d(x + 132.54, y + 164.28) * strength;
    let dy = perlin_signed_2d(x + 197.36, y + 241.71) * strength;
    (x + dx, y + dy)
}

fn distort_3d(x: f32, y: f32, z: f32, strength: f32) -> (f32, f32, f32) {
    if strength.abs() < f32::EPSILON {
        return (x, y, z);
    }
    let dx = perlin_signed_3d(x + 132.54, y + 164.28, z + 107.32) * strength;
    let dy = perlin_signed_3d(x + 197.36, y + 241.71, z + 153.49) * strength;
    let dz = perlin_signed_3d(x + 263.18, y + 318.94, z + 201.67) * strength;
    (x + dx, y + dy, z + dz)
}

// ── Top-level noise evaluation dispatch ─────────────────────────────

fn noise_eval_2d(x: f32, y: f32, p: &NoiseParams) -> f32 {
    let (x, y) = distort_2d(x, y, p.distortion);
    match p.noise_type {
        0 => perlin_fbm_2d(x, y, p.detail, p.roughness, p.lacunarity, p.do_normalize),
        1 => perlin_multi_fractal_2d(x, y, p.detail, p.roughness, p.lacunarity),
        2 => perlin_ridged_2d(
            x,
            y,
            p.detail,
            p.roughness,
            p.lacunarity,
            p.offset_n,
            p.gain,
        ),
        _ => perlin_fbm_2d(x, y, p.detail, p.roughness, p.lacunarity, p.do_normalize),
    }
}

fn noise_eval_3d(x: f32, y: f32, z: f32, p: &NoiseParams) -> f32 {
    let (x, y, z) = distort_3d(x, y, z, p.distortion);
    match p.noise_type {
        0 => perlin_fbm_3d(x, y, z, p.detail, p.roughness, p.lacunarity, p.do_normalize),
        1 => perlin_multi_fractal_3d(x, y, z, p.detail, p.roughness, p.lacunarity),
        2 => perlin_ridged_3d(
            x,
            y,
            z,
            p.detail,
            p.roughness,
            p.lacunarity,
            p.offset_n,
            p.gain,
        ),
        _ => perlin_fbm_3d(x, y, z, p.detail, p.roughness, p.lacunarity, p.do_normalize),
    }
}

pub struct Text;

impl Default for Text {
    fn default() -> Self {
        Self::new()
    }
}

impl Text {
    pub fn new() -> Self {
        Self
    }
}

static DEFAULT_FONT_DATA: &[u8] = include_bytes!("../assets/LiberationSans-Regular.ttf");

impl Node for Text {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "text".to_string(),
            display_name: "Rasterize Text".to_string(),
            category: "Generator".to_string(),
            description: "Render text to image".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "text".to_string(),
                    label: "Text".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::String("Text".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::TextArea,
                    promotable: false,
                },
                ParamSpec {
                    key: "font_size".to_string(),
                    label: "Font Size".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(72.0),
                    min: Some(1.0),
                    max: Some(500.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color".to_string(),
                    label: "Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([1.0, 1.0, 1.0, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
                },
                ParamSpec {
                    key: "width".to_string(),
                    label: "Width".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(512),
                    min: Some(1.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(512),
                    min: Some(1.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "align".to_string(),
                    label: "Align".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Left".to_string(),
                        "Center".to_string(),
                        "Right".to_string(),
                    ]),
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let text = ctx.get_param_string("text").unwrap_or("Text");
            let font_size = ctx.get_param_float("font_size")? as f32;
            let color = ctx.get_param_color("color")?;
            let w = ctx.get_param_int("width")?.max(1) as u32;
            let h = ctx.get_param_int("height")?.max(1) as u32;
            let align = ctx.get_param_int("align")?.clamp(0, 2);

            let color_r = color[0] as f32;
            let color_g = color[1] as f32;
            let color_b = color[2] as f32;
            let color_a = color[3] as f32;

            let font = ab_glyph::FontRef::try_from_slice(DEFAULT_FONT_DATA)
                .map_err(|e| CompositorError::Other(format!("Font error: {e}")))?;

            use ab_glyph::{Font, ScaleFont};
            let scaled = font.as_scaled(ab_glyph::PxScale::from(font_size));
            let ascent = scaled.ascent();
            let descent = scaled.descent();
            let line_gap = scaled.line_gap();
            let line_height = ascent - descent + line_gap;

            let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];

            let lines: Vec<&str> = text.split('\n').collect();
            let total_text_height = line_height * lines.len() as f32;
            let start_y = ((h as f32 - total_text_height) / 2.0) + ascent;

            for (line_idx, line) in lines.iter().enumerate() {
                let y_offset = start_y + line_idx as f32 * line_height;

                let mut line_width = 0.0f32;
                let mut prev_glyph: Option<ab_glyph::GlyphId> = None;
                for ch in line.chars() {
                    let glyph_id = scaled.glyph_id(ch);
                    if let Some(prev) = prev_glyph {
                        line_width += scaled.kern(prev, glyph_id);
                    }
                    line_width += scaled.h_advance(glyph_id);
                    prev_glyph = Some(glyph_id);
                }

                let x_offset = match align {
                    0 => 0.0,
                    2 => w as f32 - line_width,
                    _ => (w as f32 - line_width) / 2.0,
                };

                let mut cursor_x = x_offset;
                let mut prev_glyph: Option<ab_glyph::GlyphId> = None;
                for ch in line.chars() {
                    let glyph_id = scaled.glyph_id(ch);
                    if let Some(prev) = prev_glyph {
                        cursor_x += scaled.kern(prev, glyph_id);
                    }

                    let glyph = glyph_id.with_scale_and_position(
                        ab_glyph::PxScale::from(font_size),
                        ab_glyph::point(cursor_x, y_offset),
                    );

                    if let Some(outlined) = scaled.outline_glyph(glyph) {
                        let bounds = outlined.px_bounds();
                        outlined.draw(|gx, gy, coverage| {
                            let px = gx as i32 + bounds.min.x as i32;
                            let py = gy as i32 + bounds.min.y as i32;
                            if px >= 0 && px < w as i32 && py >= 0 && py < h as i32 {
                                let idx = (py as usize * w as usize + px as usize) * 4;
                                let src_a = coverage * color_a;
                                let dst_a = data[idx + 3];
                                let out_a = src_a + dst_a * (1.0 - src_a);
                                if out_a > 0.0 {
                                    let inv_out_a = 1.0 / out_a;
                                    data[idx] = (color_r * src_a
                                        + data[idx] * dst_a * (1.0 - src_a))
                                        * inv_out_a;
                                    data[idx + 1] = (color_g * src_a
                                        + data[idx + 1] * dst_a * (1.0 - src_a))
                                        * inv_out_a;
                                    data[idx + 2] = (color_b * src_a
                                        + data[idx + 2] * dst_a * (1.0 - src_a))
                                        * inv_out_a;
                                    data[idx + 3] = out_a;
                                }
                            }
                        });
                    }

                    cursor_x += scaled.h_advance(glyph_id);
                    prev_glyph = Some(glyph_id);
                }
            }

            let output = Image::from_f32_data(w, h, data)?;
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

pub struct UVMap;

impl Default for UVMap {
    fn default() -> Self {
        Self::new()
    }
}

impl UVMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for UVMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "uv_map".to_string(),
            display_name: "UV Map".to_string(),
            category: "Generator".to_string(),
            description: "Generate an identity UV map (R=U, G=V)".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
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
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let w = ctx.get_param_int("width")? as u32;
            let h = ctx.get_param_int("height")? as u32;

            let inv_w = if w > 1 { 1.0 / (w - 1) as f32 } else { 0.0 };
            let inv_h = if h > 1 { 1.0 / (h - 1) as f32 } else { 0.0 };

            let mut data = vec![0.0f32; (w * h) as usize * 4];

            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let x = (i % w as usize) as f32;
                    let y = (i / w as usize) as f32;
                    out[0] = x * inv_w;
                    out[1] = y * inv_h;
                    out[2] = 0.0;
                    out[3] = 1.0;
                });

            let output = Image::from_f32_data(w, h, data)?;
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

#[cfg(test)]
mod noise_tests {
    use super::*;

    #[test]
    fn test_perlin_noise_deterministic() {
        let a = perlin_signed_2d(1.5, 2.7);
        let b = perlin_signed_2d(1.5, 2.7);
        assert_eq!(a, b, "Perlin noise must be deterministic");

        let c = perlin_signed_3d(1.5, 2.7, 3.1);
        let d = perlin_signed_3d(1.5, 2.7, 3.1);
        assert_eq!(c, d, "3D Perlin noise must be deterministic");
    }

    #[test]
    fn test_perlin_fbm_normalized_range() {
        let mut min_val = f32::MAX;
        let mut max_val = f32::MIN;
        for i in 0..1000 {
            let x = (i as f32) * 0.13;
            let y = (i as f32) * 0.17 + 5.0;
            let val = perlin_fbm_2d(x, y, 4.0, 0.5, 2.0, true);
            min_val = min_val.min(val);
            max_val = max_val.max(val);
        }
        assert!(
            min_val >= -0.1 && max_val <= 1.1,
            "Normalized fBM should be approximately in [0,1], got [{min_val}, {max_val}]"
        );
    }

    #[test]
    fn test_noise_types_differ() {
        let x = 3.7;
        let y = 8.2;
        let detail = 3.0;
        let roughness = 0.5;
        let lacunarity = 2.0;

        let fbm = perlin_fbm_2d(x, y, detail, roughness, lacunarity, false);
        let multi = perlin_multi_fractal_2d(x, y, detail, roughness, lacunarity);
        let ridged = perlin_ridged_2d(x, y, detail, roughness, lacunarity, 1.0, 2.0);

        assert!(
            (fbm - multi).abs() > 0.001 || (fbm - ridged).abs() > 0.001,
            "Different noise types should produce different values: fbm={fbm}, multi={multi}, ridged={ridged}"
        );
    }

    #[test]
    fn test_distortion_modifies_output() {
        let x = 5.0;
        let y = 5.0;
        let np_no = NoiseParams {
            noise_type: 0,
            detail: 2.0,
            roughness: 0.5,
            lacunarity: 2.0,
            distortion: 0.0,
            offset_n: 0.0,
            gain: 1.0,
            do_normalize: true,
        };
        let np_with = NoiseParams {
            noise_type: 0,
            detail: 2.0,
            roughness: 0.5,
            lacunarity: 2.0,
            distortion: 2.0,
            offset_n: 0.0,
            gain: 1.0,
            do_normalize: true,
        };
        let no_distort = noise_eval_2d(x, y, &np_no);
        let with_distort = noise_eval_2d(x, y, &np_with);
        assert!(
            (no_distort - with_distort).abs() > 0.001,
            "Distortion should change the output: {no_distort} vs {with_distort}"
        );
    }

    #[test]
    fn test_perlin_spatial_coherence() {
        let a = perlin_signed_2d(1.0, 1.0);
        let b = perlin_signed_2d(1.001, 1.0);
        assert!(
            (a - b).abs() < 0.01,
            "Nearby points should have similar values: {a} vs {b}"
        );

        let c = perlin_signed_2d(50.0, 50.0);
        assert!(
            (a - c).abs() > 0.0001 || a == 0.0,
            "Distant points should generally differ"
        );
    }
}
