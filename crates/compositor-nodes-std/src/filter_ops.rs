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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
                key: "strength".to_string(),
                label: "Strength".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(5.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                    promotable: true,
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, data, image.color_space.clone());
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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
                    key: "distortion".to_string(),
                    label: "Distortion".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
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
                    promotable: true,
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
                    promotable: true,
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
            let output = Image::new_with_domain(image.format.clone(), image.data_window, out_data, image.color_space.clone());
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


