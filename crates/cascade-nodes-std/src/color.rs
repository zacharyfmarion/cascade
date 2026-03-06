use cascade_core::node::{EvalContext, ImageOrField, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::cmp::Ordering;
use std::collections::HashMap;

pub struct SeparateHsva;

impl Default for SeparateHsva {
    fn default() -> Self {
        Self::new()
    }
}

impl SeparateHsva {
    pub fn new() -> Self {
        Self
    }
}

impl Node for SeparateHsva {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "separate_hsva".to_string(),
            display_name: "Separate HSVA".to_string(),
            category: "Color".to_string(),
            description: "Separate HSV and alpha channels".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![
                PortSpec {
                    name: "hue".to_string(),
                    label: "Hue".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "saturation".to_string(),
                    label: "Saturation".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "value".to_string(),
                    label: "Value".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "alpha".to_string(),
                    label: "Alpha".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
            ],
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let pixel_count = image.pixel_count();
            let mut hue_data = vec![0.0f32; pixel_count * 4];
            let mut saturation_data = vec![0.0f32; pixel_count * 4];
            let mut value_data = vec![0.0f32; pixel_count * 4];
            let mut alpha_data = vec![0.0f32; pixel_count * 4];
            hue_data
                .par_chunks_exact_mut(4)
                .zip(saturation_data.par_chunks_exact_mut(4))
                .zip(value_data.par_chunks_exact_mut(4))
                .zip(alpha_data.par_chunks_exact_mut(4))
                .enumerate()
                .for_each(|(i, (((hue_out, sat_out), val_out), alpha_out))| {
                    let idx = i * 4;
                    let r = image.data[idx];
                    let g = image.data[idx + 1];
                    let b = image.data[idx + 2];
                    let a = image.data[idx + 3];
                    let (h, s, v) = rgb_to_hsv(r, g, b);
                    let hue = h / 360.0;
                    let outputs = [(hue_out, hue), (sat_out, s), (val_out, v), (alpha_out, a)];
                    for (out, value) in outputs {
                        out[0] = value;
                        out[1] = value;
                        out[2] = value;
                        out[3] = 1.0;
                    }
                });
            let hue_image = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                hue_data,
                image.color_space.clone(),
            )?;
            let saturation_image = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                saturation_data,
                image.color_space.clone(),
            )?;
            let value_image = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                value_data,
                image.color_space.clone(),
            )?;
            let alpha_image = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                alpha_data,
                image.color_space.clone(),
            )?;
            let mut outputs = HashMap::new();
            outputs.insert("hue".to_string(), Value::Image(hue_image));
            outputs.insert("saturation".to_string(), Value::Image(saturation_image));
            outputs.insert("value".to_string(), Value::Image(value_image));
            outputs.insert("alpha".to_string(), Value::Image(alpha_image));
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

pub struct CombineHsva;

impl Default for CombineHsva {
    fn default() -> Self {
        Self::new()
    }
}

impl CombineHsva {
    pub fn new() -> Self {
        Self
    }
}

impl Node for CombineHsva {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "combine_hsva".to_string(),
            display_name: "Combine HSVA".to_string(),
            category: "Color".to_string(),
            description: "Combine HSV and alpha channels".to_string(),
            inputs: vec![
                PortSpec {
                    name: "hue".to_string(),
                    label: "Hue".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "saturation".to_string(),
                    label: "Saturation".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "value".to_string(),
                    label: "Value".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "alpha".to_string(),
                    label: "Alpha".to_string(),
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
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let hue_image = ctx.get_input_image("hue")?;
            let saturation_image = ctx.get_input_image("saturation")?;
            let value_image = ctx.get_input_image("value")?;
            let alpha_image = ctx.get_input_image("alpha")?;
            let pixel_count = hue_image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let hue_luma = luminance_at(hue_image, idx);
                    let sat_luma = luminance_at(saturation_image, idx);
                    let val_luma = luminance_at(value_image, idx);
                    let alpha_luma = luminance_at(alpha_image, idx);
                    let h = hue_luma * 360.0;
                    let (r, g, b) = hsv_to_rgb(h, sat_luma, val_luma);
                    out[0] = r;
                    out[1] = g;
                    out[2] = b;
                    out[3] = alpha_luma;
                });
            let output = Image::new_with_domain(
                hue_image.format.clone(),
                hue_image.data_window,
                data,
                hue_image.color_space.clone(),
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

fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let v = max;
    if delta == 0.0 {
        return (0.0, 0.0, v);
    }
    let s = if max.abs() > f32::EPSILON {
        delta / max
    } else {
        0.0
    };
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
    (h, s, v)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (v, v, v);
    }
    let c = v * s;
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
    let m = v - c;
    (r1 + m, g1 + m, b1 + m)
}

fn luminance_at(image: &Image, idx: usize) -> f32 {
    let r = image.data[idx];
    let g = image.data[idx + 1];
    let b = image.data[idx + 2];
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

pub struct ColorRampNode;

impl Default for ColorRampNode {
    fn default() -> Self {
        Self::new()
    }
}

impl ColorRampNode {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ColorRampNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_ramp".to_string(),
            display_name: "Color Ramp".to_string(),
            category: "Color".to_string(),
            description: "Map luminance through a color ramp".to_string(),
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
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "stops".to_string(),
                    label: "Color Ramp".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::ColorRamp(vec![
                        ColorStop {
                            position: 0.0,
                            color: [0.0, 0.0, 0.0, 1.0],
                        },
                        ColorStop {
                            position: 1.0,
                            color: [1.0, 1.0, 1.0, 1.0],
                        },
                    ]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorRamp,
                    promotable: true,
                },
                ParamSpec {
                    key: "interpolation".to_string(),
                    label: "Interpolation".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["Linear".to_string(), "Constant".to_string()]),
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let stops = ctx.get_param_color_ramp("stops")?;
                    let interpolation = ctx.get_param_int("interpolation")?.clamp(0, 1);
                    let mut sorted_stops = stops.clone();
                    sorted_stops.sort_by(|a, b| {
                        a.position
                            .partial_cmp(&b.position)
                            .unwrap_or(Ordering::Equal)
                    });
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let stops = sorted_stops.clone();
                    let mapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, _] = (source)(u, v);
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            evaluate_color_ramp(&stops, luminance, interpolation)
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(mapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let stops = ctx.get_param_color_ramp("stops")?;
                    let interpolation = ctx.get_param_int("interpolation")?.clamp(0, 1);
                    let mut sorted_stops = stops.clone();
                    sorted_stops.sort_by(|a, b| {
                        a.position
                            .partial_cmp(&b.position)
                            .unwrap_or(Ordering::Equal)
                    });
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let r = image.data[idx];
                            let g = image.data[idx + 1];
                            let b = image.data[idx + 2];
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let rgba = evaluate_color_ramp(&sorted_stops, luminance, interpolation);
                            out[0] = rgba[0];
                            out[1] = rgba[1];
                            out[2] = rgba[2];
                            out[3] = rgba[3];
                        });
                    let output = Image::new_with_domain(
                        image.format.clone(),
                        image.data_window,
                        data,
                        image.color_space.clone(),
                    )?;
                    let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                        crate::mask_utils::apply_mask(image, &output, mask)?
                    } else {
                        output
                    };
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Image(output));
                    Ok(outputs)
                }
            }
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Evaluate the color ramp at t using linear or constant interpolation.
fn evaluate_color_ramp(stops: &[ColorStop], t: f32, interpolation: i64) -> [f32; 4] {
    if stops.is_empty() {
        return [0.0, 0.0, 0.0, 1.0];
    }
    if stops.len() == 1 {
        return [
            stops[0].color[0] as f32,
            stops[0].color[1] as f32,
            stops[0].color[2] as f32,
            stops[0].color[3] as f32,
        ];
    }
    let first = &stops[0];
    let last = &stops[stops.len() - 1];
    if t <= first.position as f32 {
        return [
            first.color[0] as f32,
            first.color[1] as f32,
            first.color[2] as f32,
            first.color[3] as f32,
        ];
    }
    if t >= last.position as f32 {
        return [
            last.color[0] as f32,
            last.color[1] as f32,
            last.color[2] as f32,
            last.color[3] as f32,
        ];
    }
    for window in stops.windows(2) {
        let left = &window[0];
        let right = &window[1];
        let left_pos = left.position as f32;
        let right_pos = right.position as f32;
        if t >= left_pos && t <= right_pos {
            if interpolation == 1 {
                return [
                    left.color[0] as f32,
                    left.color[1] as f32,
                    left.color[2] as f32,
                    left.color[3] as f32,
                ];
            }
            let denom = right_pos - left_pos;
            let t_norm = if denom.abs() > f32::EPSILON {
                (t - left_pos) / denom
            } else {
                0.0
            };
            let mut out = [0.0f32; 4];
            for (c, value) in out.iter_mut().enumerate() {
                let left_val = left.color[c] as f32;
                let right_val = right.color[c] as f32;
                *value = left_val * (1.0 - t_norm) + right_val * t_norm;
            }
            return out;
        }
    }
    [0.0, 0.0, 0.0, 1.0]
}
