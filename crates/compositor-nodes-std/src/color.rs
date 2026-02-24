use compositor_core::node::{EvalContext, ImageOrField, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::cmp::Ordering;
use std::collections::HashMap;

pub struct BrightnessContrast;

impl BrightnessContrast {
    pub fn new() -> Self {
        Self
    }
}

impl Node for BrightnessContrast {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "brightness_contrast".to_string(),
            display_name: "Brightness / Contrast".to_string(),
            category: "Color".to_string(),
            description: "Adjust brightness and contrast".to_string(),
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
                    key: "brightness".to_string(),
                    label: "Brightness".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "contrast".to_string(),
                    label: "Contrast".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let brightness = ctx.get_param_float("brightness")? as f32;
                    let contrast = ctx.get_param_float("contrast")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let adjusted = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let mut out = [r, g, b, a];
                            for c in 0..3 {
                                let mut v = (out[c] - 0.5) * (1.0 + contrast) + 0.5;
                                v += brightness;
                                out[c] = v.clamp(0.0, 1.0);
                            }
                            out
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(adjusted));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let brightness = ctx.get_param_float("brightness")? as f32;
                    let contrast = ctx.get_param_float("contrast")? as f32;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut rgba = [
                                image.data[idx],
                                image.data[idx + 1],
                                image.data[idx + 2],
                                image.data[idx + 3],
                            ];
                            for c in 0..3 {
                                let mut v = (rgba[c] - 0.5) * (1.0 + contrast) + 0.5;
                                v += brightness;
                                rgba[c] = v.clamp(0.0, 1.0);
                            }
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
                        let original = ctx.get_input_image("image")?;
                        crate::mask_utils::apply_mask(original, &output, mask)?
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

pub struct HueSaturation;

impl HueSaturation {
    pub fn new() -> Self {
        Self
    }
}

impl Node for HueSaturation {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "hue_saturation".to_string(),
            display_name: "Hue / Saturation".to_string(),
            category: "Color".to_string(),
            description: "Adjust hue and saturation".to_string(),
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
                    key: "hue".to_string(),
                    label: "Hue".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-180.0),
                    max: Some(180.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "saturation".to_string(),
                    label: "Saturation".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let hue_shift = ctx.get_param_float("hue")? as f32;
                    let sat_shift = ctx.get_param_float("saturation")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let adjusted = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let (mut h, mut s, l) = rgb_to_hsl(r, g, b);
                            h = (h + hue_shift) % 360.0;
                            if h < 0.0 {
                                h += 360.0;
                            }
                            s = (s * (1.0 + sat_shift)).clamp(0.0, 1.0);
                            let (nr, ng, nb) = hsl_to_rgb(h, s, l);
                            [nr, ng, nb, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(adjusted));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let hue_shift = ctx.get_param_float("hue")? as f32;
                    let sat_shift = ctx.get_param_float("saturation")? as f32;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let r = image.data[idx];
                            let g = image.data[idx + 1];
                            let b = image.data[idx + 2];
                            let a = image.data[idx + 3];
                            let (mut h, mut s, l) = rgb_to_hsl(r, g, b);
                            h = (h + hue_shift) % 360.0;
                            if h < 0.0 {
                                h += 360.0;
                            }
                            s = (s * (1.0 + sat_shift)).clamp(0.0, 1.0);
                            let (nr, ng, nb) = hsl_to_rgb(h, s, l);
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

pub struct SeparateHsva;

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

pub struct Invert;

impl Invert {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Invert {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "invert".to_string(),
            display_name: "Invert".to_string(),
            category: "Color".to_string(),
            description: "Invert colors".to_string(),
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
            params: vec![],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let inverted = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            [1.0 - r, 1.0 - g, 1.0 - b, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(inverted));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let r = 1.0 - image.data[idx];
                            let g = 1.0 - image.data[idx + 1];
                            let b = 1.0 - image.data[idx + 2];
                            let a = image.data[idx + 3];
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

fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) * 0.5;
    let delta = max - min;
    if delta == 0.0 {
        return (0.0, 0.0, l);
    }
    let s = delta / (1.0 - (2.0 * l - 1.0).abs());
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
    (h, s, l)
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
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
    let m = l - c * 0.5;
    (r1 + m, g1 + m, b1 + m)
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
            for c in 0..4 {
                let left_val = left.color[c] as f32;
                let right_val = right.color[c] as f32;
                out[c] = left_val * (1.0 - t_norm) + right_val * t_norm;
            }
            return out;
        }
    }
    [
        last.color[0] as f32,
        last.color[1] as f32,
        last.color[2] as f32,
        last.color[3] as f32,
    ]
}
