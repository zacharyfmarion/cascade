use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Resize;

impl Resize {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Resize {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "resize".to_string(),
            display_name: "Resize".to_string(),
            category: "Transform".to_string(),
            description: "Resize image".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
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
                ParamSpec {
                    key: "filter".to_string(),
                    label: "Filter".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Nearest".to_string(),
                        "Bilinear".to_string(),
                        "Bicubic".to_string(),
                    ]),
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
            let width = ctx.get_param_int("width")?.clamp(1, 8192) as u32;
            let height = ctx.get_param_int("height")?.clamp(1, 8192) as u32;
            let filter = ctx.get_param_int("filter")?.clamp(0, 2) as i32;

            let output = match filter {
                0 => resize_nearest(image, width, height),
                1 => resize_bilinear(image, width, height),
                _ => resize_bicubic(image, width, height),
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

pub struct Crop;

impl Crop {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Crop {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "crop".to_string(),
            display_name: "Crop".to_string(),
            category: "Transform".to_string(),
            description: "Crop image".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "x".to_string(),
                    label: "X".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "y".to_string(),
                    label: "Y".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
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
            let x = ctx.get_param_int("x")?;
            let y = ctx.get_param_int("y")?;
            let width = ctx.get_param_int("width")?;
            let height = ctx.get_param_int("height")?;

            let src_w = image.width as i64;
            let src_h = image.height as i64;
            let max_x = (src_w - 1).max(0);
            let max_y = (src_h - 1).max(0);
            let start_x = x.clamp(0, max_x);
            let start_y = y.clamp(0, max_y);
            let max_width = (src_w - start_x).max(1);
            let max_height = (src_h - start_y).max(1);
            let out_w = width.clamp(1, max_width) as u32;
            let out_h = height.clamp(1, max_height) as u32;

            let out_w_usize = out_w as usize;
            let out_h_usize = out_h as usize;
            let src_w_usize = src_w as usize;
            let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let px = i % out_w_usize;
                    let py = i / out_w_usize;
                    let sx = start_x as usize + px;
                    let sy = start_y as usize + py;
                    let idx = (sy * src_w_usize + sx) * 4;
                    out[0] = image.data[idx];
                    out[1] = image.data[idx + 1];
                    out[2] = image.data[idx + 2];
                    out[3] = image.data[idx + 3];
                });

            let output = Image::from_f32_data(out_w, out_h, data);
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

pub struct Flip;

impl Flip {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Flip {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "flip".to_string(),
            display_name: "Flip".to_string(),
            category: "Transform".to_string(),
            description: "Flip image".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "horizontal".to_string(),
                    label: "Horizontal".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                },
                ParamSpec {
                    key: "vertical".to_string(),
                    label: "Vertical".to_string(),
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

    fn evaluate<'a>(
        &'a self,
        ctx: &'a EvalContext<'a>,
    ) -> NodeFuture<'a>
    {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let horizontal = ctx.get_param_bool("horizontal")?;
            let vertical = ctx.get_param_bool("vertical")?;
            let width = image.width as usize;
            let height = image.height as usize;
            let mut data = vec![0.0f32; width * height * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let x = i % width;
                    let y = i / width;
                    let sx = if horizontal { width - 1 - x } else { x };
                    let sy = if vertical { height - 1 - y } else { y };
                    let idx = (sy * width + sx) * 4;
                    out[0] = image.data[idx];
                    out[1] = image.data[idx + 1];
                    out[2] = image.data[idx + 2];
                    out[3] = image.data[idx + 3];
                });

            let output = Image::from_f32_data(image.width, image.height, data);
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

pub struct Rotate;

impl Rotate {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Rotate {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "rotate".to_string(),
            display_name: "Rotate".to_string(),
            category: "Transform".to_string(),
            description: "Rotate image".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "angle".to_string(),
                    label: "Angle".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-180.0),
                    max: Some(180.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "filter".to_string(),
                    label: "Filter".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["Nearest".to_string(), "Bilinear".to_string()]),
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
            let angle = ctx.get_param_float("angle")? as f32;
            let filter = ctx.get_param_int("filter")?.clamp(0, 1) as i32;

            if angle.abs() < 0.0001 {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let rad = angle.to_radians();
            let cos = rad.cos();
            let sin = rad.sin();
            let in_w = image.width as f32;
            let in_h = image.height as f32;
            let cx = (in_w - 1.0) * 0.5;
            let cy = (in_h - 1.0) * 0.5;
            let corners = [
                (0.0, 0.0),
                (in_w - 1.0, 0.0),
                (in_w - 1.0, in_h - 1.0),
                (0.0, in_h - 1.0),
            ];
            let mut min_x = f32::INFINITY;
            let mut max_x = f32::NEG_INFINITY;
            let mut min_y = f32::INFINITY;
            let mut max_y = f32::NEG_INFINITY;
            for (x, y) in corners {
                let dx = x - cx;
                let dy = y - cy;
                let rx = dx * cos - dy * sin;
                let ry = dx * sin + dy * cos;
                min_x = min_x.min(rx);
                max_x = max_x.max(rx);
                min_y = min_y.min(ry);
                max_y = max_y.max(ry);
            }
            let out_w = ((max_x - min_x).ceil() as i32 + 1).max(1) as u32;
            let out_h = ((max_y - min_y).ceil() as i32 + 1).max(1) as u32;

            let out_w_usize = out_w as usize;
            let out_h_usize = out_h as usize;
            let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let x = (i % out_w_usize) as f32;
                    let y = (i / out_w_usize) as f32;
                    let rx = x + min_x;
                    let ry = y + min_y;
                    let src_x = rx * cos + ry * sin + cx;
                    let src_y = -rx * sin + ry * cos + cy;

                    if filter == 0 {
                        let sx = src_x.round() as i32;
                        let sy = src_y.round() as i32;
                        if sx >= 0 && sy >= 0 && sx < image.width as i32 && sy < image.height as i32
                        {
                            let idx = (sy as usize * image.width as usize + sx as usize) * 4;
                            out[0] = image.data[idx];
                            out[1] = image.data[idx + 1];
                            out[2] = image.data[idx + 2];
                            out[3] = image.data[idx + 3];
                        } else {
                            out[0] = 0.0;
                            out[1] = 0.0;
                            out[2] = 0.0;
                            out[3] = 0.0;
                        }
                    } else {
                        let rgba = sample_bilinear_zero(image, src_x, src_y);
                        out[0] = rgba[0];
                        out[1] = rgba[1];
                        out[2] = rgba[2];
                        out[3] = rgba[3];
                    }
                });

            let output = Image::from_f32_data(out_w, out_h, data);
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

pub struct Translate;

impl Translate {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Translate {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "translate".to_string(),
            display_name: "Translate".to_string(),
            category: "Transform".to_string(),
            description: "Translate image".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "x".to_string(),
                    label: "X".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(-8192.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                },
                ParamSpec {
                    key: "y".to_string(),
                    label: "Y".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(-8192.0),
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
            let image = ctx.get_input_image("image")?;
            let shift_x = ctx.get_param_int("x")?.clamp(-8192, 8192) as i32;
            let shift_y = ctx.get_param_int("y")?.clamp(-8192, 8192) as i32;
            let width = image.width as usize;
            let height = image.height as usize;
            let w_i32 = image.width as i32;
            let h_i32 = image.height as i32;
            let mut data = vec![0.0f32; width * height * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let x = (i % width) as i32;
                    let y = (i / width) as i32;
                    let sx = x - shift_x;
                    let sy = y - shift_y;
                    if sx >= 0 && sy >= 0 && sx < w_i32 && sy < h_i32 {
                        let idx = (sy as usize * width + sx as usize) * 4;
                        out[0] = image.data[idx];
                        out[1] = image.data[idx + 1];
                        out[2] = image.data[idx + 2];
                        out[3] = image.data[idx + 3];
                    } else {
                        out[0] = 0.0;
                        out[1] = 0.0;
                        out[2] = 0.0;
                        out[3] = 0.0;
                    }
                });

            let output = Image::from_f32_data(image.width, image.height, data);
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

fn resize_nearest(image: &Image, out_w: u32, out_h: u32) -> Image {
    let in_w = image.width as usize;
    let in_h = image.height as usize;
    let out_w_usize = out_w as usize;
    let out_h_usize = out_h as usize;
    let scale_x = in_w as f32 / out_w_usize as f32;
    let scale_y = in_h as f32 / out_h_usize as f32;
    let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let x = (i % out_w_usize) as f32;
            let y = (i / out_w_usize) as f32;
            let src_x = (x + 0.5) * scale_x - 0.5;
            let src_y = (y + 0.5) * scale_y - 0.5;
            let sx = src_x.round().clamp(0.0, (in_w - 1) as f32) as usize;
            let sy = src_y.round().clamp(0.0, (in_h - 1) as f32) as usize;
            let idx = (sy * in_w + sx) * 4;
            out[0] = image.data[idx];
            out[1] = image.data[idx + 1];
            out[2] = image.data[idx + 2];
            out[3] = image.data[idx + 3];
        });
    Image::from_f32_data(out_w, out_h, data)
}

fn resize_bilinear(image: &Image, out_w: u32, out_h: u32) -> Image {
    let in_w = image.width as usize;
    let in_h = image.height as usize;
    let out_w_usize = out_w as usize;
    let out_h_usize = out_h as usize;
    let scale_x = in_w as f32 / out_w_usize as f32;
    let scale_y = in_h as f32 / out_h_usize as f32;
    let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let x = (i % out_w_usize) as f32;
            let y = (i / out_w_usize) as f32;
            let src_x = (x + 0.5) * scale_x - 0.5;
            let src_y = (y + 0.5) * scale_y - 0.5;
            let rgba = sample_bilinear_clamped(image, src_x, src_y);
            out[0] = rgba[0];
            out[1] = rgba[1];
            out[2] = rgba[2];
            out[3] = rgba[3];
        });
    Image::from_f32_data(out_w, out_h, data)
}

fn resize_bicubic(image: &Image, out_w: u32, out_h: u32) -> Image {
    let in_w = image.width as usize;
    let in_h = image.height as usize;
    let out_w_usize = out_w as usize;
    let out_h_usize = out_h as usize;
    let scale_x = in_w as f32 / out_w_usize as f32;
    let scale_y = in_h as f32 / out_h_usize as f32;
    let (x_indices, x_weights) = precompute_cubic_axis(out_w_usize, in_w, scale_x);
    let (y_indices, y_weights) = precompute_cubic_axis(out_h_usize, in_h, scale_y);

    let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let x = i % out_w_usize;
            let y = i / out_w_usize;
            let ix = &x_indices[x];
            let iw = &x_weights[x];
            let iy = &y_indices[y];
            let yw = &y_weights[y];
            let mut rgba = [0.0f32; 4];
            for m in 0..4 {
                let sy = iy[m] as usize;
                let wy = yw[m];
                for n in 0..4 {
                    let sx = ix[n] as usize;
                    let wx = iw[n];
                    let weight = wx * wy;
                    if weight == 0.0 {
                        continue;
                    }
                    let idx = (sy * in_w + sx) * 4;
                    rgba[0] += image.data[idx] * weight;
                    rgba[1] += image.data[idx + 1] * weight;
                    rgba[2] += image.data[idx + 2] * weight;
                    rgba[3] += image.data[idx + 3] * weight;
                }
            }
            out[0] = rgba[0];
            out[1] = rgba[1];
            out[2] = rgba[2];
            out[3] = rgba[3];
        });
    Image::from_f32_data(out_w, out_h, data)
}

fn read_pixel(image: &Image, x: usize, y: usize) -> [f32; 4] {
    let idx = (y * image.width as usize + x) * 4;
    [
        image.data[idx],
        image.data[idx + 1],
        image.data[idx + 2],
        image.data[idx + 3],
    ]
}

fn get_pixel_clamped(image: &Image, x: i32, y: i32) -> [f32; 4] {
    let w = image.width as i32;
    let h = image.height as i32;
    let cx = x.clamp(0, w - 1) as usize;
    let cy = y.clamp(0, h - 1) as usize;
    read_pixel(image, cx, cy)
}

fn get_pixel_or_zero(image: &Image, x: i32, y: i32) -> [f32; 4] {
    let w = image.width as i32;
    let h = image.height as i32;
    if x < 0 || y < 0 || x >= w || y >= h {
        [0.0, 0.0, 0.0, 0.0]
    } else {
        read_pixel(image, x as usize, y as usize)
    }
}

fn sample_bilinear_clamped(image: &Image, x: f32, y: f32) -> [f32; 4] {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let c00 = get_pixel_clamped(image, x0, y0);
    let c10 = get_pixel_clamped(image, x1, y0);
    let c01 = get_pixel_clamped(image, x0, y1);
    let c11 = get_pixel_clamped(image, x1, y1);
    let mut out = [0.0f32; 4];
    for c in 0..4 {
        let v0 = c00[c] * (1.0 - fx) + c10[c] * fx;
        let v1 = c01[c] * (1.0 - fx) + c11[c] * fx;
        out[c] = v0 * (1.0 - fy) + v1 * fy;
    }
    out
}

fn sample_bilinear_zero(image: &Image, x: f32, y: f32) -> [f32; 4] {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let fx = x - x0 as f32;
    let fy = y - y0 as f32;
    let c00 = get_pixel_or_zero(image, x0, y0);
    let c10 = get_pixel_or_zero(image, x1, y0);
    let c01 = get_pixel_or_zero(image, x0, y1);
    let c11 = get_pixel_or_zero(image, x1, y1);
    let mut out = [0.0f32; 4];
    for c in 0..4 {
        let v0 = c00[c] * (1.0 - fx) + c10[c] * fx;
        let v1 = c01[c] * (1.0 - fx) + c11[c] * fx;
        out[c] = v0 * (1.0 - fy) + v1 * fy;
    }
    out
}

fn mitchell_netravali_weight(x: f32) -> f32 {
    let b = 1.0 / 3.0;
    let c = 1.0 / 3.0;
    let ax = x.abs();
    let ax2 = ax * ax;
    let ax3 = ax2 * ax;
    if ax < 1.0 {
        ((12.0 - 9.0 * b - 6.0 * c) * ax3 + (-18.0 + 12.0 * b + 6.0 * c) * ax2 + (6.0 - 2.0 * b))
            / 6.0
    } else if ax < 2.0 {
        ((-b - 6.0 * c) * ax3
            + (6.0 * b + 30.0 * c) * ax2
            + (-12.0 * b - 48.0 * c) * ax
            + (8.0 * b + 24.0 * c))
            / 6.0
    } else {
        0.0
    }
}

fn precompute_cubic_axis(
    out_len: usize,
    in_len: usize,
    scale: f32,
) -> (Vec<[i32; 4]>, Vec<[f32; 4]>) {
    let mut indices = Vec::with_capacity(out_len);
    let mut weights = Vec::with_capacity(out_len);
    let max_index = in_len as i32 - 1;
    for i in 0..out_len {
        let src = (i as f32 + 0.5) * scale - 0.5;
        let base = src.floor() as i32;
        let frac = src - base as f32;
        let mut idxs = [0i32; 4];
        let mut ws = [0.0f32; 4];
        for k in 0..4 {
            let offset = k as i32 - 1;
            idxs[k] = (base + offset).clamp(0, max_index);
            ws[k] = mitchell_netravali_weight(offset as f32 - frac);
        }
        indices.push(idxs);
        weights.push(ws);
    }
    (indices, weights)
}

pub struct Transform2D;

impl Transform2D {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Transform2D {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "transform_2d".to_string(),
            display_name: "Transform 2D".to_string(),
            category: "Transform".to_string(),
            description: "Unified translate, rotate, and scale in a single pass".to_string(),
            inputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
            }],
            params: vec![
                ParamSpec {
                    key: "translate_x".to_string(),
                    label: "Translate X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-4096.0),
                    max: Some(4096.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "translate_y".to_string(),
                    label: "Translate Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-4096.0),
                    max: Some(4096.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "rotate".to_string(),
                    label: "Rotate".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-180.0),
                    max: Some(180.0),
                    step: Some(0.1),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_x".to_string(),
                    label: "Scale X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "scale_y".to_string(),
                    label: "Scale Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.01),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "pivot_x".to_string(),
                    label: "Pivot X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "pivot_y".to_string(),
                    label: "Pivot Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                },
                ParamSpec {
                    key: "filter".to_string(),
                    label: "Filter".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec!["Nearest".to_string(), "Bilinear".to_string()]),
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
            let tx = ctx.get_param_float("translate_x")? as f32;
            let ty_val = ctx.get_param_float("translate_y")? as f32;
            let rotate_deg = ctx.get_param_float("rotate")? as f32;
            let sx = ctx.get_param_float("scale_x")? as f32;
            let sy = ctx.get_param_float("scale_y")? as f32;
            let pivot_x = ctx.get_param_float("pivot_x")? as f32;
            let pivot_y = ctx.get_param_float("pivot_y")? as f32;
            let filter = ctx.get_param_int("filter")?.clamp(0, 1) as i32;

            let is_identity = tx.abs() < 0.0001
                && ty_val.abs() < 0.0001
                && rotate_deg.abs() < 0.0001
                && (sx - 1.0).abs() < 0.0001
                && (sy - 1.0).abs() < 0.0001;

            if is_identity {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let in_w = image.width as f32;
            let in_h = image.height as f32;
            let px = pivot_x * (in_w - 1.0);
            let py = pivot_y * (in_h - 1.0);

            let rad = rotate_deg.to_radians();
            let cos_a = rad.cos();
            let sin_a = rad.sin();

            let inv_sx = if sx.abs() > 0.0001 { 1.0 / sx } else { 1.0 };
            let inv_sy = if sy.abs() > 0.0001 { 1.0 / sy } else { 1.0 };

            let out_w = image.width;
            let out_h = image.height;
            let out_w_usize = out_w as usize;
            let out_h_usize = out_h as usize;

            let mut data = vec![0.0f32; out_w_usize * out_h_usize * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let ox = (i % out_w_usize) as f32;
                    let oy = (i / out_w_usize) as f32;

                    let dx = ox - px - tx;
                    let dy = oy - py - ty_val;

                    let rx = (dx * cos_a + dy * sin_a) * inv_sx;
                    let ry = (-dx * sin_a + dy * cos_a) * inv_sy;

                    let src_x = rx + px;
                    let src_y = ry + py;

                    if filter == 0 {
                        let sx_i = src_x.round() as i32;
                        let sy_i = src_y.round() as i32;
                        if sx_i >= 0
                            && sy_i >= 0
                            && sx_i < image.width as i32
                            && sy_i < image.height as i32
                        {
                            let idx = (sy_i as usize * image.width as usize + sx_i as usize) * 4;
                            out[0] = image.data[idx];
                            out[1] = image.data[idx + 1];
                            out[2] = image.data[idx + 2];
                            out[3] = image.data[idx + 3];
                        }
                    } else {
                        let rgba = sample_bilinear_zero(image, src_x, src_y);
                        out[0] = rgba[0];
                        out[1] = rgba[1];
                        out[2] = rgba[2];
                        out[3] = rgba[3];
                    }
                });

            let output = Image::from_f32_data(out_w, out_h, data);
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
