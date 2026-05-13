use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Resize;

impl Default for Resize {
    fn default() -> Self {
        Self::new()
    }
}

impl Resize {
    pub fn new() -> Self {
        Self
    }
}

fn fit_within_dimensions(
    in_w: u32,
    in_h: u32,
    max_w: u32,
    max_h: u32,
    allow_upscale: bool,
) -> (u32, u32) {
    let scale_x = max_w as f64 / in_w as f64;
    let scale_y = max_h as f64 / in_h as f64;
    let mut scale = scale_x.min(scale_y);
    if !allow_upscale {
        scale = scale.min(1.0);
    }

    let out_w = ((in_w as f64 * scale).round() as u32).clamp(1, max_w.max(1));
    let out_h = ((in_h as f64 * scale).round() as u32).clamp(1, max_h.max(1));
    (out_w, out_h)
}

fn cover_crop_rect(in_w: u32, in_h: u32, out_w: u32, out_h: u32) -> (u32, u32, u32, u32) {
    let source_ratio = in_w as f64 / in_h as f64;
    let target_ratio = out_w as f64 / out_h as f64;
    if source_ratio > target_ratio {
        let crop_h = in_h;
        let crop_w = ((crop_h as f64 * target_ratio).round() as u32).clamp(1, in_w);
        let crop_x = (in_w - crop_w) / 2;
        (crop_x, 0, crop_w, crop_h)
    } else {
        let crop_w = in_w;
        let crop_h = ((crop_w as f64 / target_ratio).round() as u32).clamp(1, in_h);
        let crop_y = (in_h - crop_h) / 2;
        (0, crop_y, crop_w, crop_h)
    }
}

fn crop_image_pixels(
    image: &Image,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<Image, CascadeError> {
    let image_w = image.width as usize;
    let x = x as usize;
    let y = y as usize;
    let out_w = width as usize;
    let mut data = vec![0.0f32; out_w * height as usize * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let px = i % out_w;
            let py = i / out_w;
            let idx = ((y + py) * image_w + x + px) * 4;
            out[0] = image.data[idx];
            out[1] = image.data[idx + 1];
            out[2] = image.data[idx + 2];
            out[3] = image.data[idx + 3];
        });

    Image::new_with_domain(
        Format::from_dimensions(width, height),
        RectI::from_dimensions(width, height),
        data,
        image.color_space.clone(),
    )
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
                    key: "mode".to_string(),
                    label: "Mode".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Exact".to_string(),
                        "Fit Within".to_string(),
                        "Cover".to_string(),
                    ]),
                    promotable: true,
                },
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
                ParamSpec {
                    key: "allow_upscale".to_string(),
                    label: "Allow Upscale".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let width = ctx.get_param_int("width")?.clamp(1, 8192) as u32;
            let height = ctx.get_param_int("height")?.clamp(1, 8192) as u32;
            let mode = ctx.get_param_int("mode").unwrap_or(0).clamp(0, 2);
            let allow_upscale = ctx.get_param_bool("allow_upscale").unwrap_or(false);
            let filter = ctx.get_param_int("filter")?.clamp(0, 2) as i32;

            let mut cover_source = None;
            let (width, height) = match mode {
                1 => {
                    let (width, height) = fit_within_dimensions(
                        image.width,
                        image.height,
                        width,
                        height,
                        allow_upscale,
                    );
                    (width, height)
                }
                2 => {
                    let (x, y, crop_w, crop_h) =
                        cover_crop_rect(image.width, image.height, width, height);
                    let (width, height) = if allow_upscale {
                        (width, height)
                    } else {
                        fit_within_dimensions(crop_w, crop_h, width, height, false)
                    };
                    cover_source = Some(crop_image_pixels(image, x, y, crop_w, crop_h)?);
                    (width, height)
                }
                _ => (width, height),
            };
            let source = cover_source.as_ref().unwrap_or(image);

            let output = match filter {
                0 => resize_nearest(source, width, height)?,
                1 => resize_bilinear(source, width, height)?,
                _ => resize_bicubic(source, width, height)?,
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

impl Default for Crop {
    fn default() -> Self {
        Self::new()
    }
}

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
                    key: "x".to_string(),
                    label: "X".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
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
                    key: "clip_to_source".to_string(),
                    label: "Clip to Source".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let x = ctx.get_param_int("x")? as i32;
            let y = ctx.get_param_int("y")? as i32;
            let width = ctx.get_param_int("width")?.max(1) as u32;
            let height = ctx.get_param_int("height")?.max(1) as u32;
            let clip_to_source = ctx.get_param_bool("clip_to_source").unwrap_or(false);

            // Crop rect in global coordinates
            let crop_rect = RectI {
                min: IVec2 { x, y },
                max: IVec2 {
                    x: x + width as i32,
                    y: y + height as i32,
                },
            };

            if clip_to_source {
                // Clip mode: output is the intersection of crop rect with source data_window
                let out_dw = image.data_window.intersect(crop_rect);

                if out_dw.width_u32() == 0 || out_dw.height_u32() == 0 {
                    let data = vec![0.0f32; 4];
                    let empty_dw = RectI {
                        min: IVec2 {
                            x: crop_rect.min.x,
                            y: crop_rect.min.y,
                        },
                        max: IVec2 {
                            x: crop_rect.min.x + 1,
                            y: crop_rect.min.y + 1,
                        },
                    };
                    let output = Image::new_with_domain(
                        image.format.clone(),
                        empty_dw,
                        data,
                        image.color_space.clone(),
                    )?;
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Image(output));
                    return Ok(outputs);
                }

                let out_w = out_dw.width_u32() as usize;
                let out_h = out_dw.height_u32() as usize;
                let mut data = vec![0.0f32; out_w * out_h * 4];
                data.par_chunks_exact_mut(4)
                    .enumerate()
                    .for_each(|(i, out)| {
                        let px = (i % out_w) as i32;
                        let py = (i / out_w) as i32;
                        let gx = out_dw.min.x + px;
                        let gy = out_dw.min.y + py;
                        let rgba = image.get_rgba(gx, gy);
                        out[0] = rgba[0];
                        out[1] = rgba[1];
                        out[2] = rgba[2];
                        out[3] = rgba[3];
                    });

                let output = Image::new_with_domain(
                    image.format.clone(),
                    out_dw,
                    data,
                    image.color_space.clone(),
                )?;
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                Ok(outputs)
            } else {
                // Default: output is always exactly width×height.
                // X and Y pan the sample origin. Out-of-bounds pixels are transparent black.
                let out_dw = RectI {
                    min: IVec2 { x: 0, y: 0 },
                    max: IVec2 {
                        x: width as i32,
                        y: height as i32,
                    },
                };
                let out_w = width as usize;
                let out_h = height as usize;
                let mut data = vec![0.0f32; out_w * out_h * 4];
                data.par_chunks_exact_mut(4)
                    .enumerate()
                    .for_each(|(i, out)| {
                        let px = (i % out_w) as i32;
                        let py = (i / out_w) as i32;
                        let gx = x + px;
                        let gy = y + py;
                        let rgba = image.get_rgba(gx, gy);
                        out[0] = rgba[0];
                        out[1] = rgba[1];
                        out[2] = rgba[2];
                        out[3] = rgba[3];
                    });

                let output = Image::new_with_domain(
                    Format::from_dimensions(width, height),
                    out_dw,
                    data,
                    image.color_space.clone(),
                )?;
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                Ok(outputs)
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

pub struct Flip;

impl Default for Flip {
    fn default() -> Self {
        Self::new()
    }
}

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
                    key: "horizontal".to_string(),
                    label: "Horizontal".to_string(),
                    ty: ValueType::Bool,
                    default: ParamDefault::Bool(false),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Checkbox,
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
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

pub struct Translate;

impl Default for Translate {
    fn default() -> Self {
        Self::new()
    }
}

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
                    key: "x".to_string(),
                    label: "X".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(-8192.0),
                    max: Some(8192.0),
                    step: Some(1.0),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let shift_x = ctx.get_param_int("x")?.clamp(-8192, 8192) as i32;
            let shift_y = ctx.get_param_int("y")?.clamp(-8192, 8192) as i32;

            let new_dw = image.data_window.translate(shift_x, shift_y);
            let output = Image {
                width: image.width,
                height: image.height,
                data: image.data.clone(),
                color_space: image.color_space.clone(),
                format: image.format.clone(),
                data_window: new_dw,
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

pub fn resize_nearest(image: &Image, out_w: u32, out_h: u32) -> Result<Image, CascadeError> {
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
    let out_dw = RectI::from_dimensions(out_w, out_h);
    Image::new_with_domain(
        Format::from_dimensions(out_w, out_h),
        out_dw,
        data,
        image.color_space.clone(),
    )
}

fn resize_bilinear(image: &Image, out_w: u32, out_h: u32) -> Result<Image, CascadeError> {
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
    let out_dw = RectI::from_dimensions(out_w, out_h);
    Image::new_with_domain(
        Format::from_dimensions(out_w, out_h),
        out_dw,
        data,
        image.color_space.clone(),
    )
}

fn resize_bicubic(image: &Image, out_w: u32, out_h: u32) -> Result<Image, CascadeError> {
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
    let out_dw = RectI::from_dimensions(out_w, out_h);
    Image::new_with_domain(
        Format::from_dimensions(out_w, out_h),
        out_dw,
        data,
        image.color_space.clone(),
    )
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

pub struct CornerPin;

impl Default for CornerPin {
    fn default() -> Self {
        Self::new()
    }
}

impl CornerPin {
    pub fn new() -> Self {
        Self
    }
}

impl Node for CornerPin {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "corner_pin".to_string(),
            display_name: "CornerPin".to_string(),
            category: "Transform".to_string(),
            description: "Perspective warp via four corner points".to_string(),
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
                    key: "tl_x".to_string(),
                    label: "Top Left X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "tl_y".to_string(),
                    label: "Top Left Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "tr_x".to_string(),
                    label: "Top Right X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "tr_y".to_string(),
                    label: "Top Right Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "br_x".to_string(),
                    label: "Bottom Right X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "br_y".to_string(),
                    label: "Bottom Right Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "bl_x".to_string(),
                    label: "Bottom Left X".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
                },
                ParamSpec {
                    key: "bl_y".to_string(),
                    label: "Bottom Left Y".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::NumberInput,
                    promotable: true,
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
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;

            let tl_x = ctx.get_param_float("tl_x")? as f32;
            let tl_y = ctx.get_param_float("tl_y")? as f32;
            let tr_x = ctx.get_param_float("tr_x")? as f32;
            let tr_y = ctx.get_param_float("tr_y")? as f32;
            let br_x = ctx.get_param_float("br_x")? as f32;
            let br_y = ctx.get_param_float("br_y")? as f32;
            let bl_x = ctx.get_param_float("bl_x")? as f32;
            let bl_y = ctx.get_param_float("bl_y")? as f32;
            let filter = ctx.get_param_int("filter")?.clamp(0, 1) as i32;

            let is_identity = (tl_x).abs() < 0.0001
                && (tl_y).abs() < 0.0001
                && (tr_x - 1.0).abs() < 0.0001
                && (tr_y).abs() < 0.0001
                && (br_x - 1.0).abs() < 0.0001
                && (br_y - 1.0).abs() < 0.0001
                && (bl_x).abs() < 0.0001
                && (bl_y - 1.0).abs() < 0.0001;

            if is_identity {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let in_w = image.width as f32;
            let in_h = image.height as f32;
            let out_w = image.width;
            let out_h = image.height;

            let dst = [
                [tl_x * (in_w - 1.0), tl_y * (in_h - 1.0)],
                [tr_x * (in_w - 1.0), tr_y * (in_h - 1.0)],
                [br_x * (in_w - 1.0), br_y * (in_h - 1.0)],
                [bl_x * (in_w - 1.0), bl_y * (in_h - 1.0)],
            ];

            let src = [
                [0.0f32, 0.0],
                [(in_w - 1.0), 0.0],
                [(in_w - 1.0), (in_h - 1.0)],
                [0.0, (in_h - 1.0)],
            ];

            let h = compute_perspective_inverse(&dst, &src);

            let mut data = vec![0.0f32; (out_w * out_h) as usize * 4];

            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let dx = (i % out_w as usize) as f32;
                    let dy = (i / out_w as usize) as f32;

                    let denom = h[6] * dx + h[7] * dy + 1.0;
                    if denom.abs() < 1e-10 {
                        return;
                    }
                    let sx = (h[0] * dx + h[1] * dy + h[2]) / denom;
                    let sy = (h[3] * dx + h[4] * dy + h[5]) / denom;

                    let rgba = if filter == 0 {
                        get_pixel_or_zero(image, sx.round() as i32, sy.round() as i32)
                    } else {
                        sample_bilinear_zero(image, sx, sy)
                    };
                    out[0] = rgba[0];
                    out[1] = rgba[1];
                    out[2] = rgba[2];
                    out[3] = rgba[3];
                });

            let out_dw = image.data_window;
            let output = Image::new_with_domain(
                Format::from_dimensions(out_w, out_h),
                out_dw,
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

/// Compute the 8 coefficients of a projective (homography) transform that maps
/// destination quad to source quad. Given output pixel (dx, dy), the source
/// coordinate is:
///   sx = (h0*dx + h1*dy + h2) / (h6*dx + h7*dy + 1)
///   sy = (h3*dx + h4*dy + h5) / (h6*dx + h7*dy + 1)
///
/// Uses 8x8 Gaussian elimination with partial pivoting.
fn compute_perspective_inverse(dst: &[[f32; 2]; 4], src: &[[f32; 2]; 4]) -> [f32; 8] {
    // Build 8x9 augmented matrix from 4 point correspondences.
    // Each point gives two equations:
    //   sx = h0*dx + h1*dy + h2 - h6*dx*sx - h7*dy*sx
    //   sy = h3*dx + h4*dy + h5 - h6*dx*sy - h7*dy*sy
    let mut a = [[0.0f64; 9]; 8];
    for i in 0..4 {
        let (dx, dy) = (dst[i][0] as f64, dst[i][1] as f64);
        let (sx, sy) = (src[i][0] as f64, src[i][1] as f64);

        let r0 = i * 2;
        a[r0][0] = dx;
        a[r0][1] = dy;
        a[r0][2] = 1.0;
        a[r0][3] = 0.0;
        a[r0][4] = 0.0;
        a[r0][5] = 0.0;
        a[r0][6] = -dx * sx;
        a[r0][7] = -dy * sx;
        a[r0][8] = sx;

        let r1 = r0 + 1;
        a[r1][0] = 0.0;
        a[r1][1] = 0.0;
        a[r1][2] = 0.0;
        a[r1][3] = dx;
        a[r1][4] = dy;
        a[r1][5] = 1.0;
        a[r1][6] = -dx * sy;
        a[r1][7] = -dy * sy;
        a[r1][8] = sy;
    }

    // Gaussian elimination with partial pivoting
    for col in 0..8 {
        // Find pivot
        let mut max_row = col;
        let mut max_val = a[col][col].abs();
        for (row, row_values) in a.iter().enumerate().skip(col + 1) {
            let v = row_values[col].abs();
            if v > max_val {
                max_val = v;
                max_row = row;
            }
        }
        a.swap(col, max_row);

        let pivot = a[col][col];
        if pivot.abs() < 1e-14 {
            return [0.0; 8]; // degenerate
        }

        for item in a[col].iter_mut().skip(col) {
            *item /= pivot;
        }
        for row in 0..8 {
            if row == col {
                continue;
            }
            let factor = a[row][col];
            let col_row = a[col];
            for (j, item) in a[row].iter_mut().enumerate().skip(col) {
                *item -= factor * col_row[j];
            }
        }
    }

    let mut h = [0.0f32; 8];
    for (i, val) in h.iter_mut().enumerate() {
        *val = a[i][8] as f32;
    }
    h
}

pub struct STMap;

impl Default for STMap {
    fn default() -> Self {
        Self::new()
    }
}

impl STMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for STMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "st_map".to_string(),
            display_name: "STMap".to_string(),
            category: "Transform".to_string(),
            description: "UV-based image distortion (R=U, G=V)".to_string(),
            inputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "uv".to_string(),
                    label: "UV Map".to_string(),
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
                key: "filter".to_string(),
                label: "Filter".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui_hint: UiHint::Dropdown(vec!["Nearest".to_string(), "Bilinear".to_string()]),
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let uv_map = ctx.get_input_image("uv")?;
            let filter = ctx.get_param_int("filter")?.clamp(0, 1) as i32;

            let out_w = uv_map.width;
            let out_h = uv_map.height;
            let in_w = image.width as f32;
            let in_h = image.height as f32;

            let mut data = vec![0.0f32; (out_w * out_h) as usize * 4];

            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let ux = i % out_w as usize;
                    let uy = i / out_w as usize;
                    let uv_idx = (uy * out_w as usize + ux) * 4;

                    let u = uv_map.data[uv_idx];
                    let v = uv_map.data[uv_idx + 1];

                    let sx = u * (in_w - 1.0);
                    let sy = v * (in_h - 1.0);

                    let rgba = if filter == 0 {
                        get_pixel_or_zero(image, sx.round() as i32, sy.round() as i32)
                    } else {
                        sample_bilinear_zero(image, sx, sy)
                    };
                    out[0] = rgba[0];
                    out[1] = rgba[1];
                    out[2] = rgba[2];
                    out[3] = rgba[3];
                });

            let out_dw = uv_map.data_window;
            let output = Image::new_with_domain(
                Format::from_dimensions(out_w, out_h),
                out_dw,
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
