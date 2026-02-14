use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::cmp::Ordering;
use std::collections::HashMap;

pub struct Sharpen;

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
                    key: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(5.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            let image = ctx.get_input_image("image")?;
            let amount = ctx.get_param_float("amount")? as f32;
            let radius = ctx.get_param_float("radius")? as f32;
            let amount = amount.clamp(0.0, 5.0);
            let radius = radius.clamp(0.0, 20.0);

            if amount.abs() < 0.0001 || radius < 0.1 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
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
                    crate::mask_utils::apply_mask(original, &output, mask)
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
            let radii = box_radii_for_gaussian(radius, 3);
            for &r in &radii {
                box_blur_h(&blurred, &mut tmp, w, h, r);
                box_blur_v(&tmp, &mut blurred, w, h, r);
            }

            let mut out = vec![0.0f32; w * h * 4];
            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let idx = i * 4;
                for c in 0..4 {
                    let v = original[idx + c] + amount * (original[idx + c] - blurred[idx + c]);
                    px[c] = clamp01(v);
                }
            });

            let out_data = out;
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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

pub struct EdgeDetect;

impl EdgeDetect {
    pub fn new() -> Self {
        Self
    }
}

impl Node for EdgeDetect {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "edge_detect".to_string(),
            display_name: "Edge Detect".to_string(),
            category: "Filter".to_string(),
            description: "Detect edges".to_string(),
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
                key: "strength".to_string(),
                label: "Strength".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(5.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let strength = ctx.get_param_float("strength")? as f32;
            let strength = strength.clamp(0.0, 5.0);
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let src = image_to_f32(image);
            let row_stride = w * 4;
            let mut out = vec![0.0f32; w * h * 4];
            let gx_kernel: [[f32; 3]; 3] = [[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]];
            let gy_kernel: [[f32; 3]; 3] = [[-1.0, -2.0, -1.0], [0.0, 0.0, 0.0], [1.0, 2.0, 1.0]];
            let w_i32 = w as i32;
            let h_i32 = h as i32;

            out.par_chunks_exact_mut(row_stride)
                .enumerate()
                .for_each(|(y, row)| {
                    let y_i32 = y as i32;
                    row.par_chunks_exact_mut(4).enumerate().for_each(|(x, px)| {
                        let x_i32 = x as i32;
                        let mut gx = 0.0f32;
                        let mut gy = 0.0f32;
                        for ky in -1..=1 {
                            for kx in -1..=1 {
                                let sx = (x_i32 + kx).clamp(0, w_i32 - 1) as usize;
                                let sy = (y_i32 + ky).clamp(0, h_i32 - 1) as usize;
                                let idx = (sy * w + sx) * 4;
                                let lum = 0.2126 * src[idx]
                                    + 0.7152 * src[idx + 1]
                                    + 0.0722 * src[idx + 2];
                                let kx_idx = (kx + 1) as usize;
                                let ky_idx = (ky + 1) as usize;
                                gx += lum * gx_kernel[ky_idx][kx_idx];
                                gy += lum * gy_kernel[ky_idx][kx_idx];
                            }
                        }
                        let mag = (gx * gx + gy * gy).sqrt() * strength;
                        let center = (y * w + x) * 4;
                        let a = src[center + 3];
                        px[0] = mag;
                        px[1] = mag;
                        px[2] = mag;
                        px[3] = a;
                    });
                });

            let out_data = out;
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(50.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 50) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
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
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(50.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 50) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
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
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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
                key: "radius".to_string(),
                label: "Radius".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(1.0),
                max: Some(10.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
            }],
        }
    }

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let radius = ctx.get_param_int("radius")?.clamp(1, 10) as usize;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
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
                for c in 0..4 {
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
                    px[c] = values[values.len() / 2];
                }
            });

            let out_data = out;
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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

pub struct Vignette;

impl Vignette {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Vignette {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "vignette".to_string(),
            display_name: "Vignette".to_string(),
            category: "Filter".to_string(),
            description: "Apply vignette effect".to_string(),
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
                    key: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "size".to_string(),
                    label: "Size".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "softness".to_string(),
                    label: "Softness".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.01),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            let image = ctx.get_input_image("image")?;
            let amount = ctx.get_param_float("amount")? as f32;
            let size = ctx.get_param_float("size")? as f32;
            let softness = ctx.get_param_float("softness")? as f32;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }
            let amount = amount.clamp(0.0, 1.0);
            let softness = softness.clamp(0.01, 1.0);
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let w_f = image.width as f32;
            let h_f = image.height as f32;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let x = (i % w) as f32;
                    let y = (i / w) as f32;
                    let dx = (x / w_f - 0.5) * 2.0;
                    let dy = (y / h_f - 0.5) * 2.0;
                    let dist = (dx * dx + dy * dy).sqrt();
                    let falloff = smoothstep(size, size + softness, dist);
                    let factor = 1.0 - amount * falloff;
                    let r = image.data[idx] * factor;
                    let g = image.data[idx + 1] * factor;
                    let b = image.data[idx + 2] * factor;
                    let a = image.data[idx + 3];
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
                    key: "threshold".to_string(),
                    label: "Threshold".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.8),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            let radii = box_radii_for_gaussian(radius, 3);
            for &r in &radii {
                box_blur_h(&blurred, &mut tmp, w, h, r);
                box_blur_v(&tmp, &mut blurred, w, h, r);
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
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn box_radii_for_gaussian(sigma: f32, n: usize) -> Vec<usize> {
    let w_ideal = ((12.0 * sigma * sigma / n as f32) + 1.0).sqrt();
    let mut wl = w_ideal.floor() as usize;
    if wl % 2 == 0 {
        wl = wl.saturating_sub(1);
    }
    let wu = wl + 2;

    let m_ideal =
        (12.0 * sigma * sigma - (n * wl * wl + 4 * n * wl + 3 * n) as f32) / (4 * wl + 4) as f32;
    let m = m_ideal.round() as usize;

    (0..n)
        .map(|i| {
            let size = if i < m { wl } else { wu };
            (size.saturating_sub(1)) / 2
        })
        .collect()
}

fn box_blur_h(src: &[f32], dst: &mut [f32], w: usize, _h: usize, r: usize) {
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
                let span = (end - start + 1) as f32;
                let mut acc = [0.0f32; 4];
                for nx in start..=end {
                    let idx = row_start + nx * 4;
                    acc[0] += src[idx];
                    acc[1] += src[idx + 1];
                    acc[2] += src[idx + 2];
                    acc[3] += src[idx + 3];
                }
                for c in 0..4 {
                    px[c] = acc[c] / span;
                }
            });
        });
}

fn box_blur_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
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
                    let span = (end - start + 1) as f32;
                    let mut acc = [0.0f32; 4];
                    for ny in start..=end {
                        let idx = ny * stride + x * 4;
                        acc[0] += src[idx];
                        acc[1] += src[idx + 1];
                        acc[2] += src[idx + 2];
                        acc[3] += src[idx + 3];
                    }
                    for c in 0..4 {
                        px[c] = acc[c] / span;
                    }
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

pub struct LensDistortion;

impl LensDistortion {
    pub fn new() -> Self {
        Self
    }
}

impl Node for LensDistortion {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "lens_distortion".to_string(),
            display_name: "Lens Distortion".to_string(),
            category: "Filter".to_string(),
            description: "Apply barrel or pincushion lens distortion".to_string(),
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
                    key: "distortion".to_string(),
                    label: "Distortion".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "chromatic_aberration".to_string(),
                    label: "Chromatic Aberration".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale".to_string(),
                    label: "Scale".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.5),
                    max: Some(2.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            let image = ctx.get_input_image("image")?;
            let distortion = ctx.get_param_float("distortion")? as f32;
            let chromatic = ctx.get_param_float("chromatic_aberration")? as f32;
            let scale = ctx.get_param_float("scale")? as f32;
            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0
                || h == 0
                || (distortion.abs() < f32::EPSILON
                    && chromatic < f32::EPSILON
                    && (scale - 1.0).abs() < f32::EPSILON)
            {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let distortion = distortion.clamp(-1.0, 1.0);
            let chromatic = chromatic.clamp(0.0, 1.0);
            let scale = scale.clamp(0.5, 2.0);

            let src = image_to_f32(image);
            let pixel_count = w * h;
            let mut out = vec![0.0f32; pixel_count * 4];

            let cx = (w as f32 - 1.0) * 0.5;
            let cy = (h as f32 - 1.0) * 0.5;
            let max_r = (cx * cx + cy * cy).sqrt();
            let inv_max_r = if max_r > f32::EPSILON {
                1.0 / max_r
            } else {
                1.0
            };
            let inv_scale = 1.0 / scale;

            // chromatic aberration: red shifted outward, blue shifted inward
            let ca_r = 1.0 + chromatic * 0.02;
            let ca_g = 1.0;
            let ca_b = 1.0 - chromatic * 0.02;

            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let x = (i % w) as f32;
                let y = (i / w) as f32;
                let dx = (x - cx) * inv_scale;
                let dy = (y - cy) * inv_scale;
                let r = (dx * dx + dy * dy).sqrt() * inv_max_r;
                let r2 = r * r;

                // Brown-Conrady: r_distorted = r * (1 + k1 * r^2)
                let distort_factor = 1.0 + distortion * r2;

                // Per-channel distortion for chromatic aberration
                let channels = [ca_r, ca_g, ca_b];
                for c in 0..3 {
                    let cf = distort_factor * channels[c];
                    let src_x = cx + dx * cf;
                    let src_y = cy + dy * cf;
                    px[c] = bilinear_sample(&src, w, h, src_x, src_y, c);
                }
                // Alpha: use green channel distortion (no CA)
                let af = distort_factor * ca_g;
                let src_x = cx + dx * af;
                let src_y = cy + dy * af;
                px[3] = bilinear_sample(&src, w, h, src_x, src_y, 3);
            });

            let out_data = out;
            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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

fn bilinear_sample(src: &[f32], w: usize, h: usize, x: f32, y: f32, channel: usize) -> f32 {
    if x < 0.0 || y < 0.0 || x >= w as f32 || y >= h as f32 {
        return 0.0;
    }
    let x0 = x.floor() as usize;
    let y0 = y.floor() as usize;
    let x1 = (x0 + 1).min(w - 1);
    let y1 = (y0 + 1).min(h - 1);
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let c00 = src[(y0 * w + x0) * 4 + channel];
    let c10 = src[(y0 * w + x1) * 4 + channel];
    let c01 = src[(y1 * w + x0) * 4 + channel];
    let c11 = src[(y1 * w + x1) * 4 + channel];
    let top = c00 + (c10 - c00) * fx;
    let bottom = c01 + (c11 - c01) * fx;
    top + (bottom - top) * fy
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

// ---------------------------------------------------------------------------
// Kuwahara filter — matches Blender compositor's Classic + Anisotropic modes
// ---------------------------------------------------------------------------

pub struct Kuwahara;

impl Kuwahara {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Kuwahara {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "kuwahara".to_string(),
            display_name: "Kuwahara".to_string(),
            category: "Filter".to_string(),
            description: "Smoothing filter that preserves edges, for painterly effects".to_string(),
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
                    key: "variation".to_string(),
                    label: "Variation".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "Classic".to_string(),
                        "Anisotropic".to_string(),
                    ]),
                },
                ParamSpec {
                    key: "size".to_string(),
                    label: "Size".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(6),
                    min: Some(1.0),
                    max: Some(100.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "uniformity".to_string(),
                    label: "Uniformity".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(4),
                    min: Some(0.0),
                    max: Some(50.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "sharpness".to_string(),
                    label: "Sharpness".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "eccentricity".to_string(),
                    label: "Eccentricity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
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
            let image = ctx.get_input_image("image")?;
            let variation = ctx.get_param_int("variation")?.clamp(0, 1) as usize;
            let size = ctx.get_param_int("size")?.clamp(1, 100) as usize;

            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 || size == 0 {
                let output = image.clone();
                let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                    let original = ctx.get_input_image("image")?;
                    crate::mask_utils::apply_mask(original, &output, mask)
                } else {
                    output
                };
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

            let src = image_to_f32(image);

            let out_data = if variation == 0 {
                kuwahara_classic(&src, w, h, size)
            } else {
                let uniformity = ctx.get_param_int("uniformity")?.max(0) as usize;
                let sharpness_raw = ctx.get_param_float("sharpness")? as f32;
                let eccentricity_raw = ctx.get_param_float("eccentricity")? as f32;
                let sharpness_raw = sharpness_raw.clamp(0.0, 1.0);
                let eccentricity_raw = eccentricity_raw.clamp(0.0, 2.0);
                // Map sharpness: square then multiply by 16 (same as Blender)
                let sharpness = sharpness_raw * sharpness_raw * 16.0;
                // Map eccentricity: reciprocal (same as Blender)
                let eccentricity = 1.0 / eccentricity_raw.max(0.01);
                kuwahara_anisotropic(&src, w, h, size, uniformity, sharpness, eccentricity)
            };

            let output = Image::from_f32_data(image.width, image.height, out_data);
            let output = if let Some(mask) = ctx.get_optional_input_image("mask") {
                let original = ctx.get_input_image("image")?;
                crate::mask_utils::apply_mask(original, &output, mask)
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

/// Classic Kuwahara: 4-quadrant mean/variance selection.
fn kuwahara_classic(src: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h * 4];
    let w_i = w as i32;
    let h_i = h as i32;
    let r = radius as i32;

    out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
        let x = (i % w) as i32;
        let y = (i / w) as i32;

        // Signs for each quadrant: (dx_sign, dy_sign)
        let quadrant_signs: [(i32, i32); 4] = [(1, 1), (-1, 1), (1, -1), (-1, -1)];

        let mut min_variance = f32::MAX;
        let mut best_mean = [0.0f32; 4];

        for &(sx, sy) in &quadrant_signs {
            let mut sum = [0.0f32; 4];
            let mut sum_sq = [0.0f32; 4];
            let mut count = 0.0f32;

            let x_start = if sx > 0 { x } else { x - r };
            let x_end = if sx < 0 { x } else { x + r };
            let y_start = if sy > 0 { y } else { y - r };
            let y_end = if sy < 0 { y } else { y + r };

            for ny in y_start..=y_end {
                let cy = ny.clamp(0, h_i - 1) as usize;
                for nx in x_start..=x_end {
                    let cx = nx.clamp(0, w_i - 1) as usize;
                    let idx = (cy * w + cx) * 4;
                    for c in 0..4 {
                        let v = src[idx + c];
                        sum[c] += v;
                        sum_sq[c] += v * v;
                    }
                    count += 1.0;
                }
            }

            if count < 1.0 {
                continue;
            }
            let inv = 1.0 / count;
            let mut mean = [0.0f32; 4];
            let mut variance = 0.0f32;
            for c in 0..4 {
                mean[c] = sum[c] * inv;
                let var_c = sum_sq[c] * inv - mean[c] * mean[c];
                // Only accumulate RGB variance for quadrant selection (matches Blender)
                if c < 3 {
                    variance += var_c.max(0.0);
                }
            }

            if variance < min_variance {
                min_variance = variance;
                best_mean = mean;
            }
        }

        px.copy_from_slice(&best_mean);
    });

    out
}

/// Compute the structure tensor of the image.
/// Returns a flat buffer of (dxdx, dxdy, dxdy, dydy) per pixel.
fn compute_structure_tensor(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut tensor = vec![0.0f32; w * h * 4];
    let w_i = w as i32;
    let h_i = h as i32;

    // Optimized gradient kernels (rotationally symmetric, from Blender)
    let corner_weight: f32 = 0.182;
    let center_weight: f32 = 1.0 - 2.0 * corner_weight;

    tensor
        .par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, px)| {
            let x = (i % w) as i32;
            let y = (i / w) as i32;

            let sample = |dx: i32, dy: i32| -> [f32; 3] {
                let sx = (x + dx).clamp(0, w_i - 1) as usize;
                let sy = (y + dy).clamp(0, h_i - 1) as usize;
                let idx = (sy * w + sx) * 4;
                [src[idx], src[idx + 1], src[idx + 2]]
            };

            let tl = sample(-1, 1);
            let ml = sample(-1, 0);
            let bl = sample(-1, -1);
            let tr = sample(1, 1);
            let mr = sample(1, 0);
            let br = sample(1, -1);
            let tc = sample(0, 1);
            let bc = sample(0, -1);

            let mut dx = [0.0f32; 3];
            for c in 0..3 {
                dx[c] = tl[c] * (-corner_weight)
                    + ml[c] * (-center_weight)
                    + bl[c] * (-corner_weight)
                    + tr[c] * corner_weight
                    + mr[c] * center_weight
                    + br[c] * corner_weight;
            }

            let mut dy = [0.0f32; 3];
            for c in 0..3 {
                dy[c] = tl[c] * corner_weight
                    + tc[c] * center_weight
                    + tr[c] * corner_weight
                    + bl[c] * (-corner_weight)
                    + bc[c] * (-center_weight)
                    + br[c] * (-corner_weight);
            }

            let dxdx = dx[0] * dx[0] + dx[1] * dx[1] + dx[2] * dx[2];
            let dxdy = dx[0] * dy[0] + dx[1] * dy[1] + dx[2] * dy[2];
            let dydy = dy[0] * dy[0] + dy[1] * dy[1] + dy[2] * dy[2];

            // Column-major encoding matching Blender
            px[0] = dxdx;
            px[1] = dxdy;
            px[2] = dxdy;
            px[3] = dydy;
        });

    tensor
}

/// Gaussian-smooth the structure tensor using box blur approximation.
fn smooth_structure_tensor(tensor: &[f32], w: usize, h: usize, uniformity: usize) -> Vec<f32> {
    if uniformity == 0 {
        return tensor.to_vec();
    }
    let sigma = uniformity as f32;
    let mut buf = tensor.to_vec();
    let mut tmp = vec![0.0f32; w * h * 4];
    let radii = box_radii_for_gaussian(sigma, 3);
    for &r in &radii {
        box_blur_h(&buf, &mut tmp, w, h, r);
        box_blur_v(&tmp, &mut buf, w, h, r);
    }
    buf
}

/// Anisotropic Kuwahara filter.
///
/// Based on:
///   Kyprianidis et al. "Image and video abstraction by anisotropic Kuwahara filtering." 2009.
///   Kyprianidis et al. "Anisotropic Kuwahara Filtering with Polynomial Weighting Functions." 2010.
///   Kyprianidis. "Image and video abstraction by multi-scale anisotropic Kuwahara filtering." 2011.
fn kuwahara_anisotropic(
    src: &[f32],
    w: usize,
    h: usize,
    radius: usize,
    uniformity: usize,
    sharpness: f32,
    eccentricity: f32,
) -> Vec<f32> {
    let tensor = compute_structure_tensor(src, w, h);
    let smooth_tensor = smooth_structure_tensor(&tensor, w, h, uniformity);

    let mut out = vec![0.0f32; w * h * 4];
    let w_i = w as i32;
    let h_i = h as i32;
    let radius_f = radius as f32;

    const NUM_SECTORS: usize = 8;
    let pi = std::f32::consts::PI;
    let sqrt2_inv = std::f32::consts::FRAC_1_SQRT_2;

    out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
        let x = (i % w) as i32;
        let y = (i / w) as i32;

        // Read smoothed structure tensor
        let t_idx = i * 4;
        let dxdx = smooth_tensor[t_idx];
        let dxdy = smooth_tensor[t_idx + 1];
        let dydy = smooth_tensor[t_idx + 3];

        // Eigenvalues (section 3.1)
        let half_sum = (dxdx + dydy) * 0.5;
        let discriminant = ((dxdx - dydy) * (dxdx - dydy) + 4.0 * dxdy * dxdy).sqrt() * 0.5;
        let eigenvalue1 = half_sum + discriminant;
        let eigenvalue2 = half_sum - discriminant;

        // Eigenvector for minimum rate of change
        let ev_x = eigenvalue1 - dxdx;
        let ev_y = -dxdy;
        let ev_len = (ev_x * ev_x + ev_y * ev_y).sqrt();
        let (unit_x, unit_y) = if ev_len > 1e-10 {
            (ev_x / ev_len, ev_y / ev_len)
        } else {
            (1.0, 0.0)
        };

        // Anisotropy [0, 1]
        let eigen_sum = eigenvalue1 + eigenvalue2;
        let eigen_diff = eigenvalue1 - eigenvalue2;
        let anisotropy = if eigen_sum > 0.0 {
            eigen_diff / eigen_sum
        } else {
            0.0
        };

        // Ellipse dimensions
        let width_factor = (eccentricity + anisotropy) / eccentricity;
        let ellipse_w = width_factor * radius_f;
        let ellipse_h = radius_f / width_factor;

        let cosine = unit_x;
        let sine = unit_y;

        // Inverse ellipse matrix (transforms ellipse to unit disk)
        let inv_00 = cosine / ellipse_w;
        let inv_01 = sine / ellipse_w;
        let inv_10 = -sine / ellipse_h;
        let inv_11 = cosine / ellipse_h;

        // Bounding box of the ellipse
        let major_x = ellipse_w * unit_x;
        let major_y = ellipse_w * unit_y;
        let minor_x = ellipse_h * (-unit_y);
        let minor_y = ellipse_h * unit_x;
        let bound_x = (major_x * major_x + minor_x * minor_x).sqrt().ceil() as i32;
        let bound_y = (major_y * major_y + minor_y * minor_y).sqrt().ceil() as i32;

        // Overlap polynomial parameters
        let sector_center_overlap = 2.0 / radius_f;
        let sector_envelope_angle = (3.0 / 2.0) * pi / NUM_SECTORS as f32;
        let cross_sector_overlap = (sector_center_overlap + sector_envelope_angle.cos())
            / (sector_envelope_angle.sin() * sector_envelope_angle.sin());

        // Accumulators for 8 sectors
        let mut w_mean_color = [[0.0f32; 4]; NUM_SECTORS];
        let mut w_mean_sq_color = [[0.0f32; 4]; NUM_SECTORS];
        let mut w_sum = [0.0f32; NUM_SECTORS];

        // Center pixel: weight = 1/N in all sectors
        let center_idx = (y as usize * w + x as usize) * 4;
        let center_color = [
            src[center_idx],
            src[center_idx + 1],
            src[center_idx + 2],
            src[center_idx + 3],
        ];
        let cw = 1.0 / NUM_SECTORS as f32;
        for s in 0..NUM_SECTORS {
            for c in 0..4 {
                w_mean_color[s][c] = center_color[c] * cw;
                w_mean_sq_color[s][c] = center_color[c] * center_color[c] * cw;
            }
            w_sum[s] = cw;
        }

        // Iterate upper half of ellipse (mirror symmetry optimization)
        for j in 0..=bound_y {
            for ii in -bound_x..=bound_x {
                // Skip center and negative-x at j==0 (mirror duplicates)
                if j == 0 && ii <= 0 {
                    continue;
                }

                // Map to unit disk
                let dp_x = inv_00 * ii as f32 + inv_01 * j as f32;
                let dp_y = inv_10 * ii as f32 + inv_11 * j as f32;
                let dp_len_sq = dp_x * dp_x + dp_y * dp_y;
                if dp_len_sq > 1.0 {
                    continue;
                }

                // Sector weights using polynomial weighting
                let poly_x = sector_center_overlap - cross_sector_overlap * dp_x * dp_x;
                let poly_y = sector_center_overlap - cross_sector_overlap * dp_y * dp_y;

                let mut sector_weights = [0.0f32; NUM_SECTORS];
                let v0 = dp_y + poly_x;
                sector_weights[0] = if v0 > 0.0 { v0 * v0 } else { 0.0 };
                let v2 = -dp_x + poly_y;
                sector_weights[2] = if v2 > 0.0 { v2 * v2 } else { 0.0 };
                let v4 = -dp_y + poly_x;
                sector_weights[4] = if v4 > 0.0 { v4 * v4 } else { 0.0 };
                let v6 = dp_x + poly_y;
                sector_weights[6] = if v6 > 0.0 { v6 * v6 } else { 0.0 };

                // Rotate disk point by 45 degrees for odd-indexed sectors
                let rdp_x = sqrt2_inv * (dp_x - dp_y);
                let rdp_y = sqrt2_inv * (dp_x + dp_y);
                let rpoly_x = sector_center_overlap - cross_sector_overlap * rdp_x * rdp_x;
                let rpoly_y = sector_center_overlap - cross_sector_overlap * rdp_y * rdp_y;

                let v1 = rdp_y + rpoly_x;
                sector_weights[1] = if v1 > 0.0 { v1 * v1 } else { 0.0 };
                let v3 = -rdp_x + rpoly_y;
                sector_weights[3] = if v3 > 0.0 { v3 * v3 } else { 0.0 };
                let v5 = -rdp_y + rpoly_x;
                sector_weights[5] = if v5 > 0.0 { v5 * v5 } else { 0.0 };
                let v7 = rdp_x + rpoly_y;
                sector_weights[7] = if v7 > 0.0 { v7 * v7 } else { 0.0 };

                let sw_sum: f32 = sector_weights.iter().sum();
                if sw_sum < 1e-10 {
                    continue;
                }
                let radial_gauss = (-pi * dp_len_sq).exp() / sw_sum;

                // Load upper and lower (mirrored) pixel colors
                let ux = (x + ii).clamp(0, w_i - 1) as usize;
                let uy = (y + j).clamp(0, h_i - 1) as usize;
                let lx = (x - ii).clamp(0, w_i - 1) as usize;
                let ly = (y - j).clamp(0, h_i - 1) as usize;

                let u_idx = (uy * w + ux) * 4;
                let l_idx = (ly * w + lx) * 4;

                let upper = [src[u_idx], src[u_idx + 1], src[u_idx + 2], src[u_idx + 3]];
                let lower = [src[l_idx], src[l_idx + 1], src[l_idx + 2], src[l_idx + 3]];

                for k in 0..NUM_SECTORS {
                    let weight = sector_weights[k] * radial_gauss;

                    // Upper pixel -> sector k
                    w_sum[k] += weight;
                    for c in 0..4 {
                        w_mean_color[k][c] += upper[c] * weight;
                        w_mean_sq_color[k][c] += upper[c] * upper[c] * weight;
                    }

                    // Lower (mirrored) pixel -> sector (k + 4) % 8
                    let lower_k = (k + NUM_SECTORS / 2) % NUM_SECTORS;
                    w_sum[lower_k] += weight;
                    for c in 0..4 {
                        w_mean_color[lower_k][c] += lower[c] * weight;
                        w_mean_sq_color[lower_k][c] += lower[c] * lower[c] * weight;
                    }
                }
            }
        }

        // Weighted combination: sectors with lower std dev get higher weight
        let mut total_weight = 0.0f32;
        let mut weighted_color = [0.0f32; 4];

        for s in 0..NUM_SECTORS {
            if w_sum[s] < 1e-10 {
                continue;
            }
            let inv_w = 1.0 / w_sum[s];
            let mut color_mean = [0.0f32; 4];
            let mut std_dev = 0.0f32;
            for c in 0..4 {
                color_mean[c] = w_mean_color[s][c] * inv_w;
                let sq_mean = w_mean_sq_color[s][c] * inv_w;
                let var = (sq_mean - color_mean[c] * color_mean[c]).abs();
                if c < 3 {
                    std_dev += var.sqrt();
                }
            }

            // Weight = 1 / pow(max(0.02, std_dev), sharpness)
            let w_sector = 1.0 / std_dev.max(0.02).powf(sharpness);
            total_weight += w_sector;
            for c in 0..4 {
                weighted_color[c] += color_mean[c] * w_sector;
            }
        }

        if total_weight > 0.0 {
            for c in 0..4 {
                px[c] = weighted_color[c] / total_weight;
            }
        } else {
            px.copy_from_slice(&center_color);
        }
    });

    out
}
