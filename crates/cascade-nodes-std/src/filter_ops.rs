use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::cmp::Ordering;
use std::collections::HashMap;

pub struct Sharpen;

impl Default for Sharpen {
    fn default() -> Self {
        Self::new()
    }
}

impl Sharpen {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Sharpen {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "sharpen".to_string(),
            display_name: "Sharpen".to_string(),
            category: "Filter".to_string(),
            description: "Sharpen image".to_string(),
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
                    key: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(5.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "radius".to_string(),
                    label: "Radius".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(20.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let amount = ctx.get_param_float("amount")? as f32;
            let radius = ctx.get_param_float("radius")? as f32;
            let amount = amount.clamp(0.0, 5.0);
            let radius = radius.clamp(0.0, 20.0);

            if amount.abs() < 0.0001 || radius < 0.1 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)?
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)?
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let original = image_to_f32(image);
            let mut blurred = original.clone();
            let mut tmp = vec![0.0f32; w * h * 4];
            let radii = crate::filter::box_radii_for_gaussian(radius, 3);
            crate::filter::premultiply_buffer(&mut blurred);
            for &r in &radii {
                crate::filter::box_blur_h(&blurred, &mut tmp, w, h, r);
                crate::filter::box_blur_v(&tmp, &mut blurred, w, h, r);
            }
            crate::filter::unpremultiply_buffer(&mut blurred);

            let mut out = vec![0.0f32; w * h * 4];
            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let idx = i * 4;
                for c in 0..4 {
                    let v = original[idx + c] + amount * (original[idx + c] - blurred[idx + c]);
                    px[c] = clamp01(v);
                }
            });

            let out_data = out;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

pub struct Dilate;

impl Default for Dilate {
    fn default() -> Self {
        Self::new()
    }
}

impl Dilate {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Dilate {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "dilate".to_string(),
            display_name: "Dilate".to_string(),
            category: "Filter".to_string(),
            description: "Dilate image".to_string(),
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
            params: vec![ParamSpec {
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(50.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 50) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)?
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let src = image_to_f32(image);
            let mut tmp = vec![0.0f32; w * h * 4];
            let mut out = vec![0.0f32; w * h * 4];
            max_filter_h(&src, &mut tmp, w, h, radius);
            max_filter_v(&tmp, &mut out, w, h, radius);

            let out_data = out;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

pub struct Erode;

impl Default for Erode {
    fn default() -> Self {
        Self::new()
    }
}

impl Erode {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Erode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "erode".to_string(),
            display_name: "Erode".to_string(),
            category: "Filter".to_string(),
            description: "Erode image".to_string(),
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
            params: vec![ParamSpec {
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(50.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 50) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)?
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let src = image_to_f32(image);
            let mut tmp = vec![0.0f32; w * h * 4];
            let mut out = vec![0.0f32; w * h * 4];
            min_filter_h(&src, &mut tmp, w, h, radius);
            min_filter_v(&tmp, &mut out, w, h, radius);

            let out_data = out;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

pub struct Median;

impl Default for Median {
    fn default() -> Self {
        Self::new()
    }
}

impl Median {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Median {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "median".to_string(),
            display_name: "Median".to_string(),
            category: "Filter".to_string(),
            description: "Median filter".to_string(),
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
            params: vec![ParamSpec {
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(10.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 10) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)?
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let src = image_to_f32(image);
            let mut out = vec![0.0f32; w * h * 4];
            let area = (2 * radius + 1) * (2 * radius + 1);

            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let x = i % w;
                let y = i / w;
                let mut values = Vec::with_capacity(area);
                for (c, channel) in px.iter_mut().enumerate().take(4) {
                    values.clear();
                    let start_y = y.saturating_sub(radius);
                    let end_y = (y + radius).min(h - 1);
                    let start_x = x.saturating_sub(radius);
                    let end_x = (x + radius).min(w - 1);
                    for ny in start_y..=end_y {
                        for nx in start_x..=end_x {
                            let idx = (ny * w + nx) * 4 + c;
                            values.push(src[idx]);
                        }
                    }
                    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
                    *channel = values[values.len() / 2];
                }
            });

            let out_data = out;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

pub struct Glow;

impl Default for Glow {
    fn default() -> Self {
        Self::new()
    }
}

impl Glow {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Glow {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "glow".to_string(),
            display_name: "Glow".to_string(),
            category: "Filter".to_string(),
            description: "Add glow/bloom effect".to_string(),
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
                    key: "threshold".to_string(),
                    label: "Threshold".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "radius".to_string(),
                    label: "Radius".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(20.0),
                    min: Some(0.1),
                    max: Some(100.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "intensity".to_string(),
                    label: "Intensity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let threshold = ctx.get_param_float("threshold")? as f32;
            let radius = ctx.get_param_float("radius")? as f32;
            let intensity = ctx.get_param_float("intensity")? as f32;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }
            let threshold = threshold.clamp(0.0, 1.0);
            let radius = radius.clamp(0.1, 100.0);
            let intensity = intensity.clamp(0.0, 2.0);
            if intensity <= f32::EPSILON {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let original = image_to_f32(image);
            let mut bright = vec![0.0f32; original.len()];
            bright
                .par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let r = original[idx];
                    let g = original[idx + 1];
                    let b = original[idx + 2];
                    let a = original[idx + 3];
                    let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    if luminance > threshold {
                        out[0] = r;
                        out[1] = g;
                        out[2] = b;
                        out[3] = a;
                    }
                });

            let mut blurred = bright.clone();
            let mut tmp = vec![0.0f32; w * h * 4];
            let radii = crate::filter::box_radii_for_gaussian(radius, 3);
            for &r in &radii {
                crate::filter::box_blur_h(&blurred, &mut tmp, w, h, r);
                crate::filter::box_blur_v(&tmp, &mut blurred, w, h, r);
            }

            let mut out = vec![0.0f32; w * h * 4];
            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let idx = i * 4;
                let a = original[idx + 3];
                for c in 0..3 {
                    let base = original[idx + c];
                    let glow = blurred[idx + c] * intensity;
                    let v = base + glow - base * glow;
                    px[c] = clamp01(v);
                }
                px[3] = a;
            });

            let out_data = out;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

fn image_to_f32(image: &Image) -> Vec<f32> {
    let mut out = vec![0.0f32; image.data.len()];
    out.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, chunk)| {
            let idx = i * 4;
            chunk[0] = image.data[idx];
            chunk[1] = image.data[idx + 1];
            chunk[2] = image.data[idx + 2];
            chunk[3] = image.data[idx + 3];
        });
    out
}

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

fn max_filter_h(src: &[f32], dst: &mut [f32], w: usize, _h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let row_stride = w * 4;
    dst.par_chunks_exact_mut(row_stride)
        .enumerate()
        .for_each(|(y, row)| {
            let row_start = y * row_stride;
            row.par_chunks_exact_mut(4).enumerate().for_each(|(x, px)| {
                let start = x.saturating_sub(r);
                let end = (x + r).min(w - 1);
                let mut acc = [f32::NEG_INFINITY; 4];
                for nx in start..=end {
                    let idx = row_start + nx * 4;
                    for c in 0..4 {
                        acc[c] = acc[c].max(src[idx + c]);
                    }
                }
                px.copy_from_slice(&acc);
            });
        });
}

fn max_filter_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let stride = w * 4;
    let mut columns = vec![0.0f32; w * h * 4];
    columns
        .par_chunks_exact_mut(h * 4)
        .enumerate()
        .for_each(|(x, col_buf)| {
            col_buf
                .par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(y, px)| {
                    let start = y.saturating_sub(r);
                    let end = (y + r).min(h - 1);
                    let mut acc = [f32::NEG_INFINITY; 4];
                    for ny in start..=end {
                        let idx = ny * stride + x * 4;
                        for c in 0..4 {
                            acc[c] = acc[c].max(src[idx + c]);
                        }
                    }
                    px.copy_from_slice(&acc);
                });
        });

    dst.par_chunks_exact_mut(stride)
        .enumerate()
        .for_each(|(y, row)| {
            row.par_chunks_exact_mut(4).enumerate().for_each(|(x, px)| {
                let col_buf = &columns[x * h * 4..(x + 1) * h * 4];
                let idx = y * 4;
                px[0] = col_buf[idx];
                px[1] = col_buf[idx + 1];
                px[2] = col_buf[idx + 2];
                px[3] = col_buf[idx + 3];
            });
        });
}

fn min_filter_h(src: &[f32], dst: &mut [f32], w: usize, _h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let row_stride = w * 4;
    dst.par_chunks_exact_mut(row_stride)
        .enumerate()
        .for_each(|(y, row)| {
            let row_start = y * row_stride;
            row.par_chunks_exact_mut(4).enumerate().for_each(|(x, px)| {
                let start = x.saturating_sub(r);
                let end = (x + r).min(w - 1);
                let mut acc = [f32::INFINITY; 4];
                for nx in start..=end {
                    let idx = row_start + nx * 4;
                    for c in 0..4 {
                        acc[c] = acc[c].min(src[idx + c]);
                    }
                }
                px.copy_from_slice(&acc);
            });
        });
}

fn min_filter_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let stride = w * 4;
    let mut columns = vec![0.0f32; w * h * 4];
    columns
        .par_chunks_exact_mut(h * 4)
        .enumerate()
        .for_each(|(x, col_buf)| {
            col_buf
                .par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(y, px)| {
                    let start = y.saturating_sub(r);
                    let end = (y + r).min(h - 1);
                    let mut acc = [f32::INFINITY; 4];
                    for ny in start..=end {
                        let idx = ny * stride + x * 4;
                        for c in 0..4 {
                            acc[c] = acc[c].min(src[idx + c]);
                        }
                    }
                    px.copy_from_slice(&acc);
                });
        });

    dst.par_chunks_exact_mut(stride)
        .enumerate()
        .for_each(|(y, row)| {
            row.par_chunks_exact_mut(4).enumerate().for_each(|(x, px)| {
                let col_buf = &columns[x * h * 4..(x + 1) * h * 4];
                let idx = y * 4;
                px[0] = col_buf[idx];
                px[1] = col_buf[idx + 1];
                px[2] = col_buf[idx + 2];
                px[3] = col_buf[idx + 3];
            });
        });
}

// ── Directional Blur ─────────────────────────────────────────────────

pub struct DirectionalBlur;

impl Default for DirectionalBlur {
    fn default() -> Self {
        Self::new()
    }
}

impl DirectionalBlur {
    pub fn new() -> Self {
        Self
    }
}

impl Node for DirectionalBlur {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "directional_blur".to_string(),
            display_name: "Directional Blur".to_string(),
            category: "Filter".to_string(),
            description: "Blur along a specific direction/angle".to_string(),
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
                    key: "length".to_string(),
                    label: "Length".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(10.0),
                    min: Some(0.0),
                    max: Some(200.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "angle".to_string(),
                    label: "Angle".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-180.0),
                    max: Some(180.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let length = (ctx.get_param_float("length")? as f32).clamp(0.0, 200.0);
            let angle_deg = (ctx.get_param_float("angle")? as f32).clamp(-180.0, 180.0);

            if length < 0.5 {
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, image, mask)?
                } else {
                    image.clone()
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let mut src = image_to_f32(image);
            crate::filter::premultiply_buffer(&mut src);

            let angle_rad = angle_deg.to_radians();
            let dir_x = angle_rad.cos();
            let dir_y = angle_rad.sin();
            let half_len = length / 2.0;
            let pixel_count = w * h * 4;

            // Same iterative doubling as RadialBlur: 5 passes = 32
            // equivalent samples, each pass offsets along the blur
            // direction and averages with the current pixel.
            let passes = 5;
            let mut buf_a = src;
            let mut buf_b = vec![0.0f32; pixel_count];

            for pass in 0..passes {
                let offset = half_len / (1 << (passes - 1 - pass)) as f32;
                let ox = dir_x * offset;
                let oy = dir_y * offset;
                let (src_buf, dst_buf) = if pass % 2 == 0 {
                    (&buf_a, &mut buf_b)
                } else {
                    (&buf_b, &mut buf_a)
                };
                dst_buf
                    .par_chunks_exact_mut(4)
                    .enumerate()
                    .for_each(|(i, px)| {
                        let x = (i % w) as f32;
                        let y = (i / w) as f32;
                        let idx = i * 4;
                        let mut sum = [0.0f32; 4];
                        let mut count = 1.0f32;
                        sum.copy_from_slice(&src_buf[idx..(idx + 4)]);
                        for sign in &[1.0f32, -1.0f32] {
                            let sx = x + ox * sign;
                            let sy = y + oy * sign;
                            if sx >= 0.0 && sy >= 0.0 && sx < w as f32 && sy < h as f32 {
                                let x0 = sx.floor() as usize;
                                let y0 = sy.floor() as usize;
                                let x1 = (x0 + 1).min(w - 1);
                                let y1 = (y0 + 1).min(h - 1);
                                let fx = sx - x0 as f32;
                                let fy = sy - y0 as f32;
                                let fx_inv = 1.0 - fx;
                                let fy_inv = 1.0 - fy;
                                let w00 = fx_inv * fy_inv;
                                let w10 = fx * fy_inv;
                                let w01 = fx_inv * fy;
                                let w11 = fx * fy;
                                let i00 = (y0 * w + x0) * 4;
                                let i10 = (y0 * w + x1) * 4;
                                let i01 = (y1 * w + x0) * 4;
                                let i11 = (y1 * w + x1) * 4;
                                for c in 0..4 {
                                    sum[c] += src_buf[i00 + c] * w00
                                        + src_buf[i10 + c] * w10
                                        + src_buf[i01 + c] * w01
                                        + src_buf[i11 + c] * w11;
                                }
                                count += 1.0;
                            }
                        }
                        let inv = 1.0 / count;
                        for c in 0..4 {
                            px[c] = sum[c] * inv;
                        }
                    });
            }

            let mut out = if passes % 2 == 0 { buf_a } else { buf_b };
            crate::filter::unpremultiply_buffer(&mut out);

            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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

// ── Radial Blur ──────────────────────────────────────────────────────

pub struct RadialBlur;

impl Default for RadialBlur {
    fn default() -> Self {
        Self::new()
    }
}

impl RadialBlur {
    pub fn new() -> Self {
        Self
    }
}

impl Node for RadialBlur {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "radial_blur".to_string(),
            display_name: "Radial Blur".to_string(),
            category: "Filter".to_string(),
            description: "Zoom-style blur emanating from a center point".to_string(),
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
                    key: "strength".to_string(),
                    label: "Strength".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let strength = (ctx.get_param_float("strength")? as f32).clamp(0.0, 1.0);
            let center_x = (ctx.get_param_float("center_x")? as f32).clamp(0.0, 1.0);
            let center_y = (ctx.get_param_float("center_y")? as f32).clamp(0.0, 1.0);

            if strength < 0.001 {
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, image, mask)?
                } else {
                    image.clone()
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let mut src = image_to_f32(image);
            crate::filter::premultiply_buffer(&mut src);

            let cx = center_x * (w as f32 - 1.0);
            let cy = center_y * (h as f32 - 1.0);
            let pixel_count = w * h * 4;

            // Iterative ping-pong: each pass averages each pixel with a
            // sample offset toward center. The offset doubles each pass,
            // so N passes cover 2^N effective samples. 5 passes = 32
            // equivalent samples but only 5 reads per pixel total.
            let passes = 5;
            let mut buf_a = src;
            let mut buf_b = vec![0.0f32; pixel_count];

            for pass in 0..passes {
                let t = strength * (1.0 / (1 << (passes - pass)) as f32);
                let (src_buf, dst_buf) = if pass % 2 == 0 {
                    (&buf_a, &mut buf_b)
                } else {
                    (&buf_b, &mut buf_a)
                };
                dst_buf
                    .par_chunks_exact_mut(4)
                    .enumerate()
                    .for_each(|(i, px)| {
                        let x = (i % w) as f32;
                        let y = (i / w) as f32;
                        let sx = cx + (x - cx) * (1.0 - t);
                        let sy = cy + (y - cy) * (1.0 - t);
                        let idx = i * 4;
                        if sx >= 0.0 && sy >= 0.0 && sx < w as f32 && sy < h as f32 {
                            let x0 = sx.floor() as usize;
                            let y0 = sy.floor() as usize;
                            let x1 = (x0 + 1).min(w - 1);
                            let y1 = (y0 + 1).min(h - 1);
                            let fx = sx - x0 as f32;
                            let fy = sy - y0 as f32;
                            let fx_inv = 1.0 - fx;
                            let fy_inv = 1.0 - fy;
                            let w00 = fx_inv * fy_inv;
                            let w10 = fx * fy_inv;
                            let w01 = fx_inv * fy;
                            let w11 = fx * fy;
                            let i00 = (y0 * w + x0) * 4;
                            let i10 = (y0 * w + x1) * 4;
                            let i01 = (y1 * w + x0) * 4;
                            let i11 = (y1 * w + x1) * 4;
                            for c in 0..4 {
                                let sampled = src_buf[i00 + c] * w00
                                    + src_buf[i10 + c] * w10
                                    + src_buf[i01 + c] * w01
                                    + src_buf[i11 + c] * w11;
                                px[c] = (src_buf[idx + c] + sampled) * 0.5;
                            }
                        } else {
                            px[0] = src_buf[idx];
                            px[1] = src_buf[idx + 1];
                            px[2] = src_buf[idx + 2];
                            px[3] = src_buf[idx + 3];
                        }
                    });
            }

            let mut out = if passes % 2 == 0 { buf_a } else { buf_b };
            crate::filter::unpremultiply_buffer(&mut out);

            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out,
                image.color_space.clone(),
            )?;
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)?
            } else {
                output
            };
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
