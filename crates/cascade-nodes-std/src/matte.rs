use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct SeparateRgba;

impl Default for SeparateRgba {
    fn default() -> Self {
        Self::new()
    }
}

impl SeparateRgba {
    pub fn new() -> Self {
        Self
    }
}

impl Node for SeparateRgba {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "separate_rgba".to_string(),
            display_name: "Separate RGBA".to_string(),
            category: "Channel".to_string(),
            description: "Separate an image into individual R, G, B, A channels".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![
                PortSpec {
                    name: "red".to_string(),
                    label: "Red".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "green".to_string(),
                    label: "Green".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "blue".to_string(),
                    label: "Blue".to_string(),
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
            let mut r_data = vec![0.0f32; pixel_count * 4];
            let mut g_data = vec![0.0f32; pixel_count * 4];
            let mut b_data = vec![0.0f32; pixel_count * 4];
            let mut a_data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            r_data
                .par_chunks_exact_mut(4)
                .zip(g_data.par_chunks_exact_mut(4))
                .zip(b_data.par_chunks_exact_mut(4))
                .zip(a_data.par_chunks_exact_mut(4))
                .enumerate()
                .for_each(|(i, (((r_out, g_out), b_out), a_out))| {
                    let idx = i * 4;
                    let channels = [
                        (r_out, image_data[idx]),
                        (g_out, image_data[idx + 1]),
                        (b_out, image_data[idx + 2]),
                        (a_out, image_data[idx + 3]),
                    ];
                    for (out, value) in channels {
                        out[0] = value;
                        out[1] = value;
                        out[2] = value;
                        out[3] = 1.0;
                    }
                });
            let make_image = |data: Vec<f32>| -> Result<Image, CascadeError> {
                Image::new_with_domain(
                    image.format.clone(),
                    image.data_window,
                    data,
                    image.color_space.clone(),
                )
            };
            let mut outputs = HashMap::new();
            outputs.insert("red".to_string(), Value::Image(make_image(r_data)?));
            outputs.insert("green".to_string(), Value::Image(make_image(g_data)?));
            outputs.insert("blue".to_string(), Value::Image(make_image(b_data)?));
            outputs.insert("alpha".to_string(), Value::Image(make_image(a_data)?));
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

pub struct CombineRgba;

impl Default for CombineRgba {
    fn default() -> Self {
        Self::new()
    }
}

impl CombineRgba {
    pub fn new() -> Self {
        Self
    }
}

impl Node for CombineRgba {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "combine_rgba".to_string(),
            display_name: "Combine RGBA".to_string(),
            category: "Channel".to_string(),
            description: "Combine individual R, G, B, A channels into an image".to_string(),
            inputs: vec![
                PortSpec {
                    name: "red".to_string(),
                    label: "Red".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "green".to_string(),
                    label: "Green".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "blue".to_string(),
                    label: "Blue".to_string(),
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
            let red_image = ctx.get_input_image("red")?;
            let green_image = ctx.get_input_image("green")?;
            let blue_image = ctx.get_input_image("blue")?;
            let alpha_image = ctx.get_input_image("alpha")?;

            // Use red image as reference for format/data_window
            let out_dw = red_image.data_window;
            let out_w = out_dw.width_u32() as usize;
            let out_h = out_dw.height_u32() as usize;
            let pixel_count = out_w * out_h;
            let mut data = vec![0.0f32; pixel_count * 4];

            let min_x = out_dw.min.x;
            let min_y = out_dw.min.y;

            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let lx = (i % out_w) as i32;
                    let ly = (i / out_w) as i32;
                    let gx = min_x + lx;
                    let gy = min_y + ly;

                    // Extract luminance from each channel input
                    let r_px = red_image.get_rgba(gx, gy);
                    let g_px = green_image.get_rgba(gx, gy);
                    let b_px = blue_image.get_rgba(gx, gy);
                    let a_px = alpha_image.get_rgba(gx, gy);

                    let r_luma = 0.2126 * r_px[0] + 0.7152 * r_px[1] + 0.0722 * r_px[2];
                    let g_luma = 0.2126 * g_px[0] + 0.7152 * g_px[1] + 0.0722 * g_px[2];
                    let b_luma = 0.2126 * b_px[0] + 0.7152 * b_px[1] + 0.0722 * b_px[2];
                    let a_luma = 0.2126 * a_px[0] + 0.7152 * a_px[1] + 0.0722 * a_px[2];

                    out[0] = r_luma;
                    out[1] = g_luma;
                    out[2] = b_luma;
                    out[3] = a_luma;
                });

            let output = Image::new_with_domain(
                red_image.format.clone(),
                out_dw,
                data,
                red_image.color_space.clone(),
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

pub struct EdgeBlur;

impl Default for EdgeBlur {
    fn default() -> Self {
        Self::new()
    }
}

impl EdgeBlur {
    pub fn new() -> Self {
        Self
    }
}

impl Node for EdgeBlur {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "edge_blur".to_string(),
            display_name: "Edge Blur".to_string(),
            category: "Matte".to_string(),
            description: "Blur edges of a matte for smoother composites".to_string(),
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
                    key: "radius".to_string(),
                    label: "Radius".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(3.0),
                    min: Some(0.1),
                    max: Some(50.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "edge_threshold".to_string(),
                    label: "Edge Threshold".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.01),
                    min: Some(0.001),
                    max: Some(0.5),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let sigma = ctx.get_param_float("radius")? as f32;
            let edge_threshold = ctx.get_param_float("edge_threshold")? as f32;

            let w = image.width as usize;
            let h = image.height as usize;
            if w == 0 || h == 0 || sigma < 0.1 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let src: Vec<f32> = image.data.to_vec();

            let mut edge_mask = vec![0.0f32; w * h];
            for y in 0..h {
                for x in 0..w {
                    let idx = (y * w + x) * 4;
                    let a = src[idx + 3];

                    let mut max_diff = 0.0f32;
                    for &(dx, dy) in &[(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                        let nx = x as i32 + dx;
                        let ny = y as i32 + dy;
                        if nx >= 0 && nx < w as i32 && ny >= 0 && ny < h as i32 {
                            let ni = (ny as usize * w + nx as usize) * 4;
                            let na = src[ni + 3];
                            let diff = (a - na).abs();
                            if diff > max_diff {
                                max_diff = diff;
                            }
                        }
                    }
                    edge_mask[y * w + x] = if max_diff > edge_threshold { 1.0 } else { 0.0 };
                }
            }

            let blur_radius = (sigma * 2.0).ceil() as usize;
            for _ in 0..2 {
                let prev = edge_mask.clone();
                for y in 0..h {
                    for x in 0..w {
                        let x0 = x.saturating_sub(blur_radius);
                        let x1 = (x + blur_radius).min(w - 1);
                        let y0 = y.saturating_sub(blur_radius);
                        let y1 = (y + blur_radius).min(h - 1);
                        let mut sum = 0.0f32;
                        let mut count = 0.0f32;
                        for ny in y0..=y1 {
                            for nx in x0..=x1 {
                                sum += prev[ny * w + nx];
                                count += 1.0;
                            }
                        }
                        edge_mask[y * w + x] = (sum / count).min(1.0);
                    }
                }
            }

            let mut blurred = src.clone();
            let radii = crate::filter::box_radii_for_gaussian(sigma, 3);
            let mut tmp = vec![0.0f32; w * h * 4];
            for &r in &radii {
                crate::filter::box_blur_h(&blurred, &mut tmp, w, h, r);
                crate::filter::box_blur_v(&tmp, &mut blurred, w, h, r);
            }

            let mut out = vec![0.0f32; w * h * 4];
            out.par_chunks_exact_mut(4).enumerate().for_each(|(i, px)| {
                let idx = i * 4;
                let mix = edge_mask[i];
                for c in 0..4 {
                    px[c] = src[idx + c] * (1.0 - mix) + blurred[idx + c] * mix;
                }
            });

            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out,
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

pub struct MatteExpand;

impl Default for MatteExpand {
    fn default() -> Self {
        Self::new()
    }
}

impl MatteExpand {
    pub fn new() -> Self {
        Self
    }
}

impl Node for MatteExpand {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "matte_expand".to_string(),
            display_name: "Matte Expand".to_string(),
            category: "Matte".to_string(),
            description: "Expand matte edges outward (dilate alpha only)".to_string(),
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
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let src = &image.data;
            let mut alpha: Vec<f32> = (0..w * h).map(|i| src[i * 4 + 3]).collect();
            let mut tmp = vec![0.0f32; w * h];

            for _ in 0..radius {
                for y in 0..h {
                    for x in 0..w {
                        let mut max_a = alpha[y * w + x];
                        if x > 0 {
                            max_a = max_a.max(alpha[y * w + x - 1]);
                        }
                        if x + 1 < w {
                            max_a = max_a.max(alpha[y * w + x + 1]);
                        }
                        tmp[y * w + x] = max_a;
                    }
                }
                for y in 0..h {
                    for x in 0..w {
                        let mut max_a = tmp[y * w + x];
                        if y > 0 {
                            max_a = max_a.max(tmp[(y - 1) * w + x]);
                        }
                        if y + 1 < h {
                            max_a = max_a.max(tmp[(y + 1) * w + x]);
                        }
                        alpha[y * w + x] = max_a;
                    }
                }
            }

            let mut data = vec![0.0f32; w * h * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, px)| {
                    let idx = i * 4;
                    px[0] = src[idx];
                    px[1] = src[idx + 1];
                    px[2] = src[idx + 2];
                    px[3] = alpha[i];
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

pub struct MatteShrink;

impl Default for MatteShrink {
    fn default() -> Self {
        Self::new()
    }
}

impl MatteShrink {
    pub fn new() -> Self {
        Self
    }
}

impl Node for MatteShrink {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "matte_shrink".to_string(),
            display_name: "Matte Shrink".to_string(),
            category: "Matte".to_string(),
            description: "Shrink matte edges inward (erode alpha only)".to_string(),
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
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let src = &image.data;
            let mut alpha: Vec<f32> = (0..w * h).map(|i| src[i * 4 + 3]).collect();
            let mut tmp = vec![0.0f32; w * h];

            for _ in 0..radius {
                for y in 0..h {
                    for x in 0..w {
                        let mut min_a = alpha[y * w + x];
                        if x > 0 {
                            min_a = min_a.min(alpha[y * w + x - 1]);
                        }
                        if x + 1 < w {
                            min_a = min_a.min(alpha[y * w + x + 1]);
                        }
                        tmp[y * w + x] = min_a;
                    }
                }
                for y in 0..h {
                    for x in 0..w {
                        let mut min_a = tmp[y * w + x];
                        if y > 0 {
                            min_a = min_a.min(tmp[(y - 1) * w + x]);
                        }
                        if y + 1 < h {
                            min_a = min_a.min(tmp[(y + 1) * w + x]);
                        }
                        alpha[y * w + x] = min_a;
                    }
                }
            }

            let mut data = vec![0.0f32; w * h * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, px)| {
                    let idx = i * 4;
                    px[0] = src[idx];
                    px[1] = src[idx + 1];
                    px[2] = src[idx + 2];
                    px[3] = alpha[i];
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
