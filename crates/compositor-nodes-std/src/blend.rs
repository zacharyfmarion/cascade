use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct Blend;

impl Blend {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Blend {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "blend".to_string(),
            display_name: "Blend".to_string(),
            category: "Composite".to_string(),
            description: "Blend two images".to_string(),
            inputs: vec![
                PortSpec {
                    name: "base".to_string(),
                    label: "Base".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "blend_input".to_string(),
                    label: "Blend".to_string(),
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
                    key: "mode".to_string(),
                    label: "Mode".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(18.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Normal".to_string(),
                        "Add".to_string(),
                        "Multiply".to_string(),
                        "Screen".to_string(),
                        "Overlay".to_string(),
                        "Soft Light".to_string(),
                        "Hard Light".to_string(),
                        "Difference".to_string(),
                        "Darken".to_string(),
                        "Lighten".to_string(),
                        "Color Dodge".to_string(),
                        "Color Burn".to_string(),
                        "Linear Burn".to_string(),
                        "Vivid Light".to_string(),
                        "Linear Light".to_string(),
                        "Pin Light".to_string(),
                        "Exclusion".to_string(),
                        "Subtract".to_string(),
                        "Divide".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "opacity".to_string(),
                    label: "Opacity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
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
            let base = ctx.get_input_image("base")?;
            let blend_img = ctx.get_input_image("blend_input")?;
            let mask_image = ctx.get_optional_input_image("mask");
            let mode = ctx.get_param_int("mode")?;
            let opacity = (ctx.get_param_float("opacity")? as f32).clamp(0.0, 1.0);

            let out_dw = base.data_window.union(blend_img.data_window);
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

                    let [base_r, base_g, base_b, base_a] = base.get_rgba(gx, gy);
                    let [bl_r, bl_g, bl_b, bl_a] = blend_img.get_rgba(gx, gy);

                    let blended_r = blend_channel(base_r, bl_r, mode);
                    let blended_g = blend_channel(base_g, bl_g, mode);
                    let blended_b = blend_channel(base_b, bl_b, mode);

                    let effective_opacity = if let Some(mask) = mask_image {
                        let [mr, mg, mb, _] = mask.get_rgba(gx, gy);
                        let mask_luma = 0.2126 * mr + 0.7152 * mg + 0.0722 * mb;
                        (opacity * mask_luma).clamp(0.0, 1.0)
                    } else {
                        opacity
                    };

                    // Blend layer's effective coverage, scaled by opacity + mask.
                    let blend_alpha = bl_a * effective_opacity;

                    // Porter-Duff "over" alpha: blend layer composited over base.
                    let out_a = blend_alpha + base_a * (1.0 - blend_alpha);

                    // RGB: lerp from base toward the blended result, weighted by
                    // the blend layer's coverage.  No clamp — HDR values (>1.0)
                    // are valid.
                    out[0] = base_r + (blended_r - base_r) * blend_alpha;
                    out[1] = base_g + (blended_g - base_g) * blend_alpha;
                    out[2] = base_b + (blended_b - base_b) * blend_alpha;
                    out[3] = out_a;
                });

            let output =
                Image::new_with_domain(base.format.clone(), out_dw, data, base.color_space.clone())?;
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

pub struct AlphaOver;

impl AlphaOver {
    pub fn new() -> Self {
        Self
    }
}

impl Node for AlphaOver {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "alpha_over".to_string(),
            display_name: "Alpha Over".to_string(),
            category: "Composite".to_string(),
            description: "Composite foreground over background".to_string(),
            inputs: vec![
                PortSpec {
                    name: "background".to_string(),
                    label: "Background".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "foreground".to_string(),
                    label: "Foreground".to_string(),
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
                key: "opacity".to_string(),
                label: "Opacity".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let background = ctx.get_input_image("background")?;
            let foreground = ctx.get_input_image("foreground")?;
            let mask_image = ctx.get_optional_input_image("mask");
            let opacity = (ctx.get_param_float("opacity")? as f32).clamp(0.0, 1.0);

            let out_dw = background.data_window.union(foreground.data_window);
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

                    let [bg_r, bg_g, bg_b, bg_a] = background.get_rgba(gx, gy);
                    let [fg_r, fg_g, fg_b, fg_a] = foreground.get_rgba(gx, gy);

                    let mut fg_alpha = (fg_a * opacity).clamp(0.0, 1.0);
                    if let Some(mask) = mask_image {
                        let [mr, mg, mb, _] = mask.get_rgba(gx, gy);
                        let mask_luma = 0.2126 * mr + 0.7152 * mg + 0.0722 * mb;
                        fg_alpha = (fg_alpha * mask_luma).clamp(0.0, 1.0);
                    }

                    let inv_alpha = 1.0 - fg_alpha;
                    out[0] = (fg_r * fg_alpha + bg_r * inv_alpha).clamp(0.0, 1.0);
                    out[1] = (fg_g * fg_alpha + bg_g * inv_alpha).clamp(0.0, 1.0);
                    out[2] = (fg_b * fg_alpha + bg_b * inv_alpha).clamp(0.0, 1.0);
                    out[3] = (fg_alpha + bg_a * inv_alpha).clamp(0.0, 1.0);
                });

            let output = Image::new_with_domain(
                background.format.clone(),
                out_dw,
                data,
                background.color_space.clone(),
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

fn blend_channel(base: f32, blend: f32, mode: i64) -> f32 {
    match mode {
        0 => blend,
        1 => base + blend,
        2 => base * blend,
        3 => 1.0 - (1.0 - base) * (1.0 - blend),
        4 => {
            if base < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        5 => soft_light(base, blend),
        6 => {
            if blend < 0.5 {
                2.0 * base * blend
            } else {
                1.0 - 2.0 * (1.0 - base) * (1.0 - blend)
            }
        }
        7 => (base - blend).abs(),
        8 => base.min(blend),
        9 => base.max(blend),
        10 => {
            if blend >= 1.0 {
                1.0
            } else {
                base / (1.0 - blend)
            }
        }
        11 => {
            if blend <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - base) / blend).min(1.0)
            }
        }
        12 => (base + blend - 1.0).max(0.0),
        13 => {
            if blend <= 0.5 {
                if blend <= 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - base) / (2.0 * blend)).min(1.0)
                }
            } else {
                let d = 2.0 * (blend - 0.5);
                if d >= 1.0 {
                    1.0
                } else {
                    base / (1.0 - d)
                }
            }
        }
        14 => (base + 2.0 * blend - 1.0).clamp(0.0, 1.0),
        15 => {
            if blend <= 0.5 {
                base.min(2.0 * blend)
            } else {
                base.max(2.0 * blend - 1.0)
            }
        }
        16 => base + blend - 2.0 * base * blend,
        17 => (base - blend).max(0.0),
        18 => {
            if blend <= 0.0 {
                1.0
            } else {
                (base / blend).min(1.0)
            }
        }
        _ => blend,
    }
}

fn soft_light(base: f32, blend: f32) -> f32 {
    if blend <= 0.5 {
        base - (1.0 - 2.0 * blend) * base * (1.0 - base)
    } else {
        let d = if base <= 0.25 {
            ((16.0 * base - 12.0) * base + 4.0) * base
        } else {
            base.sqrt()
        };
        base + (2.0 * blend - 1.0) * (d - base)
    }
}

pub struct Merge;

impl Merge {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Merge {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "merge".to_string(),
            display_name: "Merge".to_string(),
            category: "Composite".to_string(),
            description: "Merge two images with Porter-Duff operations".to_string(),
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
                    key: "operation".to_string(),
                    label: "Operation".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(13.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Over".to_string(),
                        "Under".to_string(),
                        "In".to_string(),
                        "Out".to_string(),
                        "Atop".to_string(),
                        "Xor".to_string(),
                        "Stencil".to_string(),
                        "Mask".to_string(),
                        "Plus".to_string(),
                        "Multiply".to_string(),
                        "Difference".to_string(),
                        "Screen".to_string(),
                        "Max".to_string(),
                        "Min".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "bbox".to_string(),
                    label: "BBox".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(3.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Union".to_string(),
                        "Intersection".to_string(),
                        "A".to_string(),
                        "B".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "opacity".to_string(),
                    label: "Opacity".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "mix".to_string(),
                    label: "Mix".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
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
            let a = ctx.get_input_image("A")?;
            let b = ctx.get_input_image("B")?;
            let mask_image = ctx.get_optional_input_image("mask");
            let operation = ctx.get_param_int("operation")? as i32;
            let bbox = ctx.get_param_int("bbox")? as i32;
            let opacity = (ctx.get_param_float("opacity")? as f32).clamp(0.0, 1.0);
            let mix = (ctx.get_param_float("mix")? as f32).clamp(0.0, 1.0);

            let out_dw = match bbox {
                0 => a.data_window.union(b.data_window),
                1 => a.data_window.intersect(b.data_window),
                2 => a.data_window,
                3 => b.data_window,
                _ => a.data_window.union(b.data_window),
            };

            if out_dw.width_u32() == 0 || out_dw.height_u32() == 0 {
                let data = vec![0.0f32; 4];
                let empty_dw = RectI {
                    min: IVec2 {
                        x: out_dw.min.x,
                        y: out_dw.min.y,
                    },
                    max: IVec2 {
                        x: out_dw.min.x + 1,
                        y: out_dw.min.y + 1,
                    },
                };
                let output =
                    Image::new_with_domain(a.format.clone(), empty_dw, data, a.color_space.clone())?;
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(output));
                return Ok(outputs);
            }

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

                    let [a_r, a_g, a_b, a_a] = a.get_rgba(gx, gy);
                    let [b_r, b_g, b_b, b_a] = b.get_rgba(gx, gy);

                    let mut a_alpha = (a_a * opacity).clamp(0.0, 1.0);
                    if let Some(mask) = mask_image {
                        let [mr, mg, mb, _] = mask.get_rgba(gx, gy);
                        let mask_luma = 0.2126 * mr + 0.7152 * mg + 0.0722 * mb;
                        a_alpha = (a_alpha * mask_luma).clamp(0.0, 1.0);
                    }
                    let b_alpha = b_a.clamp(0.0, 1.0);

                    let (m_r, m_g, m_b, m_a) = match operation {
                        0 => {
                            let out_a = a_alpha + b_alpha * (1.0 - a_alpha);
                            if out_a > 0.0 {
                                let out_r =
                                    (a_r * a_alpha + b_r * b_alpha * (1.0 - a_alpha)) / out_a;
                                let out_g =
                                    (a_g * a_alpha + b_g * b_alpha * (1.0 - a_alpha)) / out_a;
                                let out_b =
                                    (a_b * a_alpha + b_b * b_alpha * (1.0 - a_alpha)) / out_a;
                                (out_r, out_g, out_b, out_a)
                            } else {
                                (0.0, 0.0, 0.0, 0.0)
                            }
                        }
                        1 => {
                            let out_a = b_alpha + a_alpha * (1.0 - b_alpha);
                            if out_a > 0.0 {
                                let out_r =
                                    (b_r * b_alpha + a_r * a_alpha * (1.0 - b_alpha)) / out_a;
                                let out_g =
                                    (b_g * b_alpha + a_g * a_alpha * (1.0 - b_alpha)) / out_a;
                                let out_b =
                                    (b_b * b_alpha + a_b * a_alpha * (1.0 - b_alpha)) / out_a;
                                (out_r, out_g, out_b, out_a)
                            } else {
                                (0.0, 0.0, 0.0, 0.0)
                            }
                        }
                        2 => (a_r, a_g, a_b, a_alpha * b_alpha),
                        3 => (a_r, a_g, a_b, a_alpha * (1.0 - b_alpha)),
                        4 => (
                            a_r * a_alpha + b_r * (1.0 - a_alpha),
                            a_g * a_alpha + b_g * (1.0 - a_alpha),
                            a_b * a_alpha + b_b * (1.0 - a_alpha),
                            b_alpha,
                        ),
                        5 => {
                            let out_a = a_alpha * (1.0 - b_alpha) + b_alpha * (1.0 - a_alpha);
                            if out_a > 0.0 {
                                let out_r = (a_r * a_alpha * (1.0 - b_alpha)
                                    + b_r * b_alpha * (1.0 - a_alpha))
                                    / out_a;
                                let out_g = (a_g * a_alpha * (1.0 - b_alpha)
                                    + b_g * b_alpha * (1.0 - a_alpha))
                                    / out_a;
                                let out_b = (a_b * a_alpha * (1.0 - b_alpha)
                                    + b_b * b_alpha * (1.0 - a_alpha))
                                    / out_a;
                                (out_r, out_g, out_b, out_a)
                            } else {
                                (0.0, 0.0, 0.0, 0.0)
                            }
                        }
                        6 => (b_r, b_g, b_b, b_alpha * a_alpha),
                        7 => (a_r, a_g, a_b, a_alpha * b_alpha),
                        8 => (
                            a_r * a_alpha + b_r * b_alpha,
                            a_g * a_alpha + b_g * b_alpha,
                            a_b * a_alpha + b_b * b_alpha,
                            (a_alpha + b_alpha).min(1.0),
                        ),
                        9 => (
                            a_r * b_r,
                            a_g * b_g,
                            a_b * b_b,
                            a_alpha + b_alpha - a_alpha * b_alpha,
                        ),
                        10 => (
                            (a_r - b_r).abs(),
                            (a_g - b_g).abs(),
                            (a_b - b_b).abs(),
                            a_alpha + b_alpha - a_alpha * b_alpha,
                        ),
                        11 => (
                            1.0 - (1.0 - a_r) * (1.0 - b_r),
                            1.0 - (1.0 - a_g) * (1.0 - b_g),
                            1.0 - (1.0 - a_b) * (1.0 - b_b),
                            a_alpha + b_alpha - a_alpha * b_alpha,
                        ),
                        12 => (
                            a_r.max(b_r),
                            a_g.max(b_g),
                            a_b.max(b_b),
                            a_alpha + b_alpha - a_alpha * b_alpha,
                        ),
                        13 => (
                            a_r.min(b_r),
                            a_g.min(b_g),
                            a_b.min(b_b),
                            a_alpha + b_alpha - a_alpha * b_alpha,
                        ),
                        _ => {
                            let out_a = a_alpha + b_alpha * (1.0 - a_alpha);
                            if out_a > 0.0 {
                                let out_r =
                                    (a_r * a_alpha + b_r * b_alpha * (1.0 - a_alpha)) / out_a;
                                let out_g =
                                    (a_g * a_alpha + b_g * b_alpha * (1.0 - a_alpha)) / out_a;
                                let out_b =
                                    (a_b * a_alpha + b_b * b_alpha * (1.0 - a_alpha)) / out_a;
                                (out_r, out_g, out_b, out_a)
                            } else {
                                (0.0, 0.0, 0.0, 0.0)
                            }
                        }
                    };

                    let m_a = m_a.clamp(0.0, 1.0);

                    out[0] = b_r * (1.0 - mix) + m_r * mix;
                    out[1] = b_g * (1.0 - mix) + m_g * mix;
                    out[2] = b_b * (1.0 - mix) + m_b * mix;
                    out[3] = (b_a * (1.0 - mix) + m_a * mix).clamp(0.0, 1.0);
                });

            let output =
                Image::new_with_domain(a.format.clone(), out_dw, data, a.color_space.clone())?;
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
