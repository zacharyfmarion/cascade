use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node};
use compositor_core::types::*;
use rayon::prelude::*;
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
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let width = ctx.get_param_int("width")? as u32;
        let height = ctx.get_param_int("height")? as u32;
        let r = ctx.get_param_float("r")? as f32;
        let g = ctx.get_param_float("g")? as f32;
        let b = ctx.get_param_float("b")? as f32;
        let a = ctx.get_param_float("a")? as f32;
        let pixel_count = (width as usize) * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4).for_each(|out| {
            out[0] = r;
            out[1] = g;
            out[2] = b;
            out[3] = a;
        });
        let output = Image::from_f32_data(width, height, data);
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
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let width = ctx.get_param_int("width")? as u32;
        let height = ctx.get_param_int("height")? as u32;
        let seed = ctx.get_param_int("seed")? as f32;
        let monochrome = ctx.get_param_bool("monochrome")?;
        let intensity = ctx.get_param_float("intensity")? as f32;
        let width_usize = width as usize;
        let pixel_count = width_usize * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let x = (i % width_usize) as f32;
                let y = (i / width_usize) as f32;
                if monochrome {
                    let v = hash_noise(x, y, seed) * intensity;
                    out[0] = v;
                    out[1] = v;
                    out[2] = v;
                } else {
                    let r = hash_noise(x, y, seed) * intensity;
                    let g = hash_noise(x, y, seed + 1.0) * intensity;
                    let b = hash_noise(x, y, seed + 2.0) * intensity;
                    out[0] = r;
                    out[1] = g;
                    out[2] = b;
                }
                out[3] = 1.0;
            });
        let output = Image::from_f32_data(width, height, data);
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
                    min: None,
                    max: None,
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1080),
                    min: None,
                    max: None,
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
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
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let width = ctx.get_param_int("width")? as u32;
        let height = ctx.get_param_int("height")? as u32;
        let direction = ctx.get_param_int("direction")?;
        let start_r = ctx.get_param_float("start_r")? as f32;
        let start_g = ctx.get_param_float("start_g")? as f32;
        let start_b = ctx.get_param_float("start_b")? as f32;
        let end_r = ctx.get_param_float("end_r")? as f32;
        let end_g = ctx.get_param_float("end_g")? as f32;
        let end_b = ctx.get_param_float("end_b")? as f32;
        let width_usize = width as usize;
        let pixel_count = width_usize * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];
        let denom_x = if width > 1 { (width - 1) as f32 } else { 1.0 };
        let denom_y = if height > 1 { (height - 1) as f32 } else { 1.0 };
        let cx = (width as f32 - 1.0) * 0.5;
        let cy = (height as f32 - 1.0) * 0.5;
        let max_dx = cx.max(width as f32 - 1.0 - cx);
        let max_dy = cy.max(height as f32 - 1.0 - cy);
        let max_dist = (max_dx * max_dx + max_dy * max_dy).sqrt();
        let inv_max_dist = if max_dist > 0.0 { 1.0 / max_dist } else { 0.0 };
        let two_pi = 2.0 * PI;
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let x = (i % width_usize) as f32;
                let y = (i / width_usize) as f32;
                let t = match direction {
                    0 => x / denom_x,
                    1 => y / denom_y,
                    2 => {
                        let dx = x - cx;
                        let dy = y - cy;
                        (dx * dx + dy * dy).sqrt() * inv_max_dist
                    }
                    3 => {
                        let angle = (y - cy).atan2(x - cx);
                        (angle + PI) / two_pi
                    }
                    _ => x / denom_x,
                }
                .clamp(0.0, 1.0);
                let r = lerp(start_r, end_r, t).clamp(0.0, 1.0);
                let g = lerp(start_g, end_g, t).clamp(0.0, 1.0);
                let b = lerp(start_b, end_b, t).clamp(0.0, 1.0);
                out[0] = r;
                out[1] = g;
                out[2] = b;
                out[3] = 1.0;
            });
        let output = Image::from_f32_data(width, height, data);
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
                    min: None,
                    max: None,
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "height".to_string(),
                    label: "Height".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1080),
                    min: None,
                    max: None,
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "size".to_string(),
                    label: "Size".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(64),
                    min: Some(1.0),
                    max: Some(512.0),
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
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let width = ctx.get_param_int("width")? as u32;
        let height = ctx.get_param_int("height")? as u32;
        let size = ctx.get_param_int("size")? as u32;
        let color1_r = ctx.get_param_float("color1_r")? as f32;
        let color1_g = ctx.get_param_float("color1_g")? as f32;
        let color1_b = ctx.get_param_float("color1_b")? as f32;
        let color2_r = ctx.get_param_float("color2_r")? as f32;
        let color2_g = ctx.get_param_float("color2_g")? as f32;
        let color2_b = ctx.get_param_float("color2_b")? as f32;
        let width_usize = width as usize;
        let pixel_count = width_usize * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let x = (i % width_usize) as u32;
                let y = (i / width_usize) as u32;
                let tile = ((x / size) + (y / size)) % 2;
                let (r, g, b) = if tile == 0 {
                    (color1_r, color1_g, color1_b)
                } else {
                    (color2_r, color2_g, color2_b)
                };
                out[0] = r;
                out[1] = g;
                out[2] = b;
                out[3] = 1.0;
            });
        let output = Image::from_f32_data(width, height, data);
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
            ],
        }
    }

    fn evaluate(&self, ctx: &EvalContext) -> Result<HashMap<String, Value>, CompositorError> {
        let width = ctx.get_param_int("width")? as u32;
        let height = ctx.get_param_int("height")? as u32;
        let shape = ctx.get_param_int("shape")?.clamp(0, 2);
        let center_x = ctx.get_param_float("center_x")? as f32;
        let center_y = ctx.get_param_float("center_y")? as f32;
        let size_x = ctx.get_param_float("size_x")? as f32;
        let size_y = ctx.get_param_float("size_y")? as f32;
        let corner_radius = ctx.get_param_float("corner_radius")? as f32;
        let feather = ctx.get_param_float("feather")? as f32;
        let invert = ctx.get_param_bool("invert")?;
        let width_usize = width as usize;
        let pixel_count = width_usize * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];
        let w = width as f32;
        let h = height as f32;
        let cx = center_x * (w - 1.0);
        let cy = center_y * (h - 1.0);
        let rx = (size_x * w * 0.5).max(0.5);
        let ry = (size_y * h * 0.5).max(0.5);
        let min_dim = w.min(h).max(1.0);
        let feather_px = feather * min_dim;
        let mut corner_px = corner_radius * min_dim;
        corner_px = corner_px.min(rx.min(ry));
        data.par_chunks_exact_mut(4)
            .enumerate()
            .for_each(|(i, out)| {
                let x = (i % width_usize) as f32;
                let y = (i / width_usize) as f32;
                let dx = x - cx;
                let dy = y - cy;
                let sdf = match shape {
                    0 => {
                        let nx = dx / rx;
                        let ny = dy / ry;
                        (nx * nx + ny * ny).sqrt() - 1.0
                    }
                    1 => {
                        let bx = dx.abs() - rx;
                        let by = dy.abs() - ry;
                        let ax = bx.max(0.0);
                        let ay = by.max(0.0);
                        (ax * ax + ay * ay).sqrt() + bx.max(by).min(0.0)
                    }
                    _ => {
                        let bx = dx.abs() - (rx - corner_px);
                        let by = dy.abs() - (ry - corner_px);
                        let ax = bx.max(0.0);
                        let ay = by.max(0.0);
                        (ax * ax + ay * ay).sqrt() + bx.max(by).min(0.0) - corner_px
                    }
                };
                let mut value = if feather_px > f32::EPSILON {
                    1.0 - (sdf / feather_px).clamp(0.0, 1.0)
                } else if sdf <= 0.0 {
                    1.0
                } else {
                    0.0
                };
                if invert {
                    value = 1.0 - value;
                }
                out[0] = value;
                out[1] = value;
                out[2] = value;
                out[3] = 1.0;
            });
        let output = Image::from_f32_data(width, height, data);
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

fn hash_noise(x: f32, y: f32, seed: f32) -> f32 {
    let v = (x * 12.9898 + y * 78.233 + seed * 43758.5453).sin() * 43758.5453;
    v - v.floor()
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
