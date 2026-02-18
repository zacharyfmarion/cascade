use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Premultiply;

impl Premultiply {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Premultiply {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "premultiply".to_string(),
            display_name: "Premultiply".to_string(),
            category: "Matte".to_string(),
            description: "Premultiply alpha".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            outputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "matte".to_string(),
                    label: "Matte".to_string(),
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
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let r = image_data[idx];
                    let g = image_data[idx + 1];
                    let b = image_data[idx + 2];
                    let a = image_data[idx + 3];
                    out[0] = r * a;
                    out[1] = g * a;
                    out[2] = b * a;
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

pub struct Unpremultiply;

impl Unpremultiply {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Unpremultiply {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "unpremultiply".to_string(),
            display_name: "Unpremultiply".to_string(),
            category: "Matte".to_string(),
            description: "Unpremultiply alpha".to_string(),
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
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let r = image_data[idx];
                    let g = image_data[idx + 1];
                    let b = image_data[idx + 2];
                    let a = image_data[idx + 3];
                    let (nr, ng, nb) = if a > f32::EPSILON {
                        (r / a, g / a, b / a)
                    } else {
                        (0.0, 0.0, 0.0)
                    };
                    out[0] = nr;
                    out[1] = ng;
                    out[2] = nb;
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

pub struct SetAlpha;

impl SetAlpha {
    pub fn new() -> Self {
        Self
    }
}

impl Node for SetAlpha {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "set_alpha".to_string(),
            display_name: "Set Alpha".to_string(),
            category: "Matte".to_string(),
            description: "Set alpha from luminance".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
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
            let image = ctx.get_input_image("image")?;
            let alpha = ctx.get_input_image("alpha")?;
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_width = image.width as usize;
            let alpha_width = alpha.width as usize;
            let alpha_max_x = alpha.width.saturating_sub(1) as usize;
            let alpha_max_y = alpha.height.saturating_sub(1) as usize;
            let image_data = &image.data;
            let alpha_data = &alpha.data;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let r = image_data[idx];
                    let g = image_data[idx + 1];
                    let b = image_data[idx + 2];
                    let x = i % image_width;
                    let y = i / image_width;
                    let alpha_x = x.min(alpha_max_x);
                    let alpha_y = y.min(alpha_max_y);
                    let alpha_idx = (alpha_y * alpha_width + alpha_x) * 4;
                    let ar = alpha_data[alpha_idx];
                    let ag = alpha_data[alpha_idx + 1];
                    let ab = alpha_data[alpha_idx + 2];
                    let a = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;
                    out[0] = r;
                    out[1] = g;
                    out[2] = b;
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

pub struct ExtractChannel;

impl ExtractChannel {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ExtractChannel {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "extract_channel".to_string(),
            display_name: "Extract Channel".to_string(),
            category: "Matte".to_string(),
            description: "Extract a single channel".to_string(),
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
                key: "channel".to_string(),
                label: "Channel".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(0),
                min: Some(0.0),
                max: Some(3.0),
                step: Some(1.0),
                ui_hint: UiHint::Dropdown(vec![
                    "Red".to_string(),
                    "Green".to_string(),
                    "Blue".to_string(),
                    "Alpha".to_string(),
                ]),
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let channel = clamp_channel(ctx.get_param_int("channel")?);
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let value = image_data[idx + channel];
                    out[0] = value;
                    out[1] = value;
                    out[2] = value;
                    out[3] = 1.0;
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

pub struct ChromaKey;

impl ChromaKey {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ChromaKey {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "chroma_key".to_string(),
            display_name: "Chroma Key".to_string(),
            category: "Matte".to_string(),
            description: "Key out by color".to_string(),
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
                    key: "key_color".to_string(),
                    label: "Key Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.0, 1.0, 0.0, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
                },
                ParamSpec {
                    key: "tolerance".to_string(),
                    label: "Tolerance".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.3),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "softness".to_string(),
                    label: "Softness".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.1),
                    min: Some(0.0),
                    max: Some(0.5),
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
            let key_color = ctx.get_param_color("key_color")?;
            let key_r = key_color[0] as f32;
            let key_g = key_color[1] as f32;
            let key_b = key_color[2] as f32;
            let tolerance = (ctx.get_param_float("tolerance")? as f32).max(0.0);
            let softness = (ctx.get_param_float("softness")? as f32).max(0.0);
            let soft_end = tolerance + softness;
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let r = image_data[idx];
                    let g = image_data[idx + 1];
                    let b = image_data[idx + 2];
                    let a = image_data[idx + 3];
                    let dr = r - key_r;
                    let dg = g - key_g;
                    let db = b - key_b;
                    let dist = (dr * dr + dg * dg + db * db).sqrt();
                    let out_a = if dist < tolerance {
                        0.0
                    } else if softness <= f32::EPSILON || dist > soft_end {
                        a
                    } else {
                        let t = (dist - tolerance) / softness;
                        a * t
                    };
                    out[0] = r;
                    out[1] = g;
                    out[2] = b;
                    out[3] = out_a;
                });
            let mut matte_data = vec![0.0f32; pixel_count * 4];
            matte_data
                .par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let a_val = data[i * 4 + 3];
                    out[0] = a_val;
                    out[1] = a_val;
                    out[2] = a_val;
                    out[3] = 1.0;
                });
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                data,
                image.color_space.clone(),
            );
            let matte_output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                matte_data,
                image.color_space.clone(),
            );
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(output));
            outputs.insert("matte".to_string(), Value::Image(matte_output));
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

pub struct Despill;

impl Despill {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Despill {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "despill".to_string(),
            display_name: "Despill".to_string(),
            category: "Matte".to_string(),
            description: "Remove color spill from keyed footage".to_string(),
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
                    key: "method".to_string(),
                    label: "Method".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Green Screen".to_string(),
                        "Blue Screen".to_string(),
                        "Custom".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "strength".to_string(),
                    label: "Strength".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "key_color".to_string(),
                    label: "Key Color".to_string(),
                    ty: ValueType::Color,
                    default: ParamDefault::Color([0.0, 1.0, 0.0, 1.0]),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::ColorPicker,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let method = ctx.get_param_int("method")?.clamp(0, 2);
            let strength = (ctx.get_param_float("strength")? as f32).clamp(0.0, 2.0);
            let key_color = ctx.get_param_color("key_color")?;
            let key_r = key_color[0] as f32;
            let key_g = key_color[1] as f32;
            let key_b = key_color[2] as f32;
            let pixel_count = image.pixel_count();
            let mut data = vec![0.0f32; pixel_count * 4];
            let image_data = &image.data;
            let max_dist = 3.0_f32.sqrt();
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    let mut r = image_data[idx];
                    let mut g = image_data[idx + 1];
                    let mut b = image_data[idx + 2];
                    let a = image_data[idx + 3];
                    match method {
                        0 => {
                            let max_rb = r.max(b);
                            let reduced = g.min(max_rb);
                            g = reduced * strength + g * (1.0 - strength);
                        }
                        1 => {
                            let max_rg = r.max(g);
                            let reduced = b.min(max_rg);
                            b = reduced * strength + b * (1.0 - strength);
                        }
                        _ => {
                            let key_len = (key_r * key_r + key_g * key_g + key_b * key_b).sqrt();
                            if key_len > f32::EPSILON {
                                let nr = key_r / key_len;
                                let ng = key_g / key_len;
                                let nb = key_b / key_len;
                                let dr = r - key_r;
                                let dg = g - key_g;
                                let db = b - key_b;
                                let dist = (dr * dr + dg * dg + db * db).sqrt();
                                let influence = (1.0 - dist / max_dist).clamp(0.0, 1.0) * strength;
                                let dot = r * nr + g * ng + b * nb;
                                let reduce = dot * influence;
                                r -= nr * reduce;
                                g -= ng * reduce;
                                b -= nb * reduce;
                            }
                        }
                    }
                    r = r.clamp(0.0, 1.0);
                    g = g.clamp(0.0, 1.0);
                    b = b.clamp(0.0, 1.0);
                    out[0] = r;
                    out[1] = g;
                    out[2] = b;
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

fn clamp_channel(value: i64) -> usize {
    if value < 0 {
        0
    } else if value > 3 {
        3
    } else {
        value as usize
    }
}

pub struct SeparateRgba;

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
            let make_image = |data: Vec<f32>| {
                Image::new_with_domain(
                    image.format.clone(),
                    image.data_window,
                    data,
                    image.color_space.clone(),
                )
            };
            let mut outputs = HashMap::new();
            outputs.insert("red".to_string(), Value::Image(make_image(r_data)));
            outputs.insert("green".to_string(), Value::Image(make_image(g_data)));
            outputs.insert("blue".to_string(), Value::Image(make_image(b_data)));
            outputs.insert("alpha".to_string(), Value::Image(make_image(a_data)));
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

pub struct CopyChannels;

impl CopyChannels {
    pub fn new() -> Self {
        Self
    }
}

impl Node for CopyChannels {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "copy_channels".to_string(),
            display_name: "Copy Channels".to_string(),
            category: "Channel".to_string(),
            description: "Copy channels between two images (like Nuke's Shuffle2)".to_string(),
            inputs: vec![
                PortSpec {
                    name: "A".to_string(),
                    label: "A".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "B".to_string(),
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
                    key: "red".to_string(),
                    label: "Red".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(7.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "A.Red".to_string(),
                        "A.Green".to_string(),
                        "A.Blue".to_string(),
                        "A.Alpha".to_string(),
                        "B.Red".to_string(),
                        "B.Green".to_string(),
                        "B.Blue".to_string(),
                        "B.Alpha".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "green".to_string(),
                    label: "Green".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(0.0),
                    max: Some(7.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "A.Red".to_string(),
                        "A.Green".to_string(),
                        "A.Blue".to_string(),
                        "A.Alpha".to_string(),
                        "B.Red".to_string(),
                        "B.Green".to_string(),
                        "B.Blue".to_string(),
                        "B.Alpha".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "blue".to_string(),
                    label: "Blue".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(2),
                    min: Some(0.0),
                    max: Some(7.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "A.Red".to_string(),
                        "A.Green".to_string(),
                        "A.Blue".to_string(),
                        "A.Alpha".to_string(),
                        "B.Red".to_string(),
                        "B.Green".to_string(),
                        "B.Blue".to_string(),
                        "B.Alpha".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "alpha".to_string(),
                    label: "Alpha".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(3),
                    min: Some(0.0),
                    max: Some(7.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "A.Red".to_string(),
                        "A.Green".to_string(),
                        "A.Blue".to_string(),
                        "A.Alpha".to_string(),
                        "B.Red".to_string(),
                        "B.Green".to_string(),
                        "B.Blue".to_string(),
                        "B.Alpha".to_string(),
                    ]),
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let a = ctx.get_input_image("A")?;
            let b = ctx.get_input_image("B")?;
            let r_src = ctx.get_param_int("red")?.clamp(0, 7) as usize;
            let g_src = ctx.get_param_int("green")?.clamp(0, 7) as usize;
            let b_src = ctx.get_param_int("blue")?.clamp(0, 7) as usize;
            let a_src = ctx.get_param_int("alpha")?.clamp(0, 7) as usize;

            let out_dw = a.data_window;
            let out_w = out_dw.width_u32() as usize;
            let out_h = out_dw.height_u32() as usize;
            let pixel_count = out_w * out_h;
            let mut data = vec![0.0f32; pixel_count * 4];

            let min_x = out_dw.min.x;
            let min_y = out_dw.min.y;

            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out_px)| {
                    let lx = (i % out_w) as i32;
                    let ly = (i / out_w) as i32;
                    let gx = min_x + lx;
                    let gy = min_y + ly;

                    let a_px = a.get_rgba(gx, gy);
                    let b_px = b.get_rgba(gx, gy);

                    // Sources 0-3 = A.R/G/B/A, 4-7 = B.R/G/B/A
                    let pick = |src: usize| -> f32 {
                        if src < 4 {
                            a_px[src]
                        } else {
                            b_px[src - 4]
                        }
                    };

                    out_px[0] = pick(r_src);
                    out_px[1] = pick(g_src);
                    out_px[2] = pick(b_src);
                    out_px[3] = pick(a_src);
                });

            let output = Image::new_with_domain(
                a.format.clone(),
                out_dw,
                data,
                a.color_space.clone(),
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
