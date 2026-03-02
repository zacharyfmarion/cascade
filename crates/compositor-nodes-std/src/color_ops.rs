use compositor_core::node::{EvalContext, ImageOrField, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

const CURVE_LUT_SIZE: usize = 4096;
const CURVE_LUT_SCALE: f32 = (CURVE_LUT_SIZE - 1) as f32;

pub struct Levels;

impl Default for Levels {
    fn default() -> Self {
        Self::new()
    }
}

impl Levels {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Levels {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "levels".to_string(),
            display_name: "Levels".to_string(),
            category: "Color".to_string(),
            description: "Adjust levels".to_string(),
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
                    key: "in_black".to_string(),
                    label: "In Black".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "in_white".to_string(),
                    label: "In White".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gamma".to_string(),
                    label: "Gamma".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.1),
                    max: Some(10.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "out_black".to_string(),
                    label: "Out Black".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "out_white".to_string(),
                    label: "Out White".to_string(),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let in_black = ctx.get_param_float("in_black")? as f32;
                    let in_white = ctx.get_param_float("in_white")? as f32;
                    let gamma = ctx.get_param_float("gamma")? as f32;
                    let out_black = ctx.get_param_float("out_black")? as f32;
                    let out_white = ctx.get_param_float("out_white")? as f32;
                    let input_range = in_white - in_black;
                    let inv_input_range = if input_range.abs() > f32::EPSILON {
                        1.0 / input_range
                    } else {
                        0.0
                    };
                    let inv_gamma = if gamma.abs() > f32::EPSILON {
                        1.0 / gamma
                    } else {
                        1.0
                    };
                    let output_range = out_white - out_black;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let mut rgb = [r, g, b];
                            for channel in rgb.iter_mut() {
                                let mut value = (*channel - in_black) * inv_input_range;
                                value = value.clamp(0.0, 1.0);
                                value = value.powf(inv_gamma);
                                value = out_black + value * output_range;
                                *channel = value;
                            }
                            [rgb[0], rgb[1], rgb[2], a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let in_black = ctx.get_param_float("in_black")? as f32;
                    let in_white = ctx.get_param_float("in_white")? as f32;
                    let gamma = ctx.get_param_float("gamma")? as f32;
                    let out_black = ctx.get_param_float("out_black")? as f32;
                    let out_white = ctx.get_param_float("out_white")? as f32;
                    let input_range = in_white - in_black;
                    let inv_input_range = if input_range.abs() > f32::EPSILON {
                        1.0 / input_range
                    } else {
                        0.0
                    };
                    let inv_gamma = if gamma.abs() > f32::EPSILON {
                        1.0 / gamma
                    } else {
                        1.0
                    };
                    let output_range = out_white - out_black;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut rgb =
                                [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                            let a = image.data[idx + 3];
                            for channel in rgb.iter_mut() {
                                let mut v = (*channel - in_black) * inv_input_range;
                                v = v.clamp(0.0, 1.0);
                                v = v.powf(inv_gamma);
                                v = out_black + v * output_range;
                                *channel = v;
                            }
                            out[0] = rgb[0];
                            out[1] = rgb[1];
                            out[2] = rgb[2];
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

fn default_curve_points() -> Vec<CurvePoint> {
    vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }]
}

fn is_identity_curve(points: &[CurvePoint]) -> bool {
    if points.len() <= 1 {
        return true;
    }
    if points.len() != 2 {
        return false;
    }
    let epsilon = 1e-9;
    let matches = |point: &CurvePoint, x: f64, y: f64| {
        (point.x - x).abs() < epsilon && (point.y - y).abs() < epsilon
    };
    (matches(&points[0], 0.0, 0.0) && matches(&points[1], 1.0, 1.0))
        || (matches(&points[0], 1.0, 1.0) && matches(&points[1], 0.0, 0.0))
}

/// Build a LUT using monotone cubic Hermite interpolation (Fritsch-Carlson method).
/// This guarantees smooth curves that never overshoot between control points.
fn build_monotone_cubic_lut(points: &[CurvePoint]) -> Vec<f32> {
    let mut lut = vec![0.0f32; CURVE_LUT_SIZE];

    if points.len() <= 1 {
        for (i, entry) in lut.iter_mut().enumerate() {
            *entry = i as f32 / CURVE_LUT_SCALE;
        }
        return lut;
    }

    // Sort by x
    let mut sorted: Vec<(f64, f64)> = points.iter().map(|p| (p.x, p.y)).collect();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate: if multiple points share the same x, keep the last
    let mut knots: Vec<(f64, f64)> = Vec::with_capacity(sorted.len());
    for (x, y) in sorted {
        if let Some(last) = knots.last_mut() {
            if (x - last.0).abs() < 1e-12 {
                last.1 = y;
                continue;
            }
        }
        knots.push((x, y));
    }

    let n = knots.len();
    if n <= 1 {
        for (i, entry) in lut.iter_mut().enumerate() {
            *entry = i as f32 / CURVE_LUT_SCALE;
        }
        return lut;
    }

    // Two points → linear
    if n == 2 {
        let (x0, y0) = knots[0];
        let (x1, y1) = knots[1];
        let dx = x1 - x0;
        let slope = if dx.abs() < 1e-12 {
            0.0
        } else {
            (y1 - y0) / dx
        };
        for (i, entry) in lut.iter_mut().enumerate() {
            let x = i as f64 / CURVE_LUT_SCALE as f64;
            *entry = (y0 + slope * (x - x0)) as f32;
        }
        return lut;
    }

    // Compute deltas between consecutive knots
    let mut deltas = vec![0.0f64; n - 1];
    for k in 0..n - 1 {
        let dx = knots[k + 1].0 - knots[k].0;
        if dx.abs() < 1e-12 {
            deltas[k] = 0.0;
        } else {
            deltas[k] = (knots[k + 1].1 - knots[k].1) / dx;
        }
    }

    // Compute initial tangents
    let mut tangents = vec![0.0f64; n];
    tangents[0] = deltas[0];
    tangents[n - 1] = deltas[n - 2];
    for k in 1..n - 1 {
        tangents[k] = (deltas[k - 1] + deltas[k]) / 2.0;
    }

    // Fritsch-Carlson monotonicity constraints
    for k in 0..n - 1 {
        if deltas[k].abs() < 1e-12 {
            tangents[k] = 0.0;
            tangents[k + 1] = 0.0;
        } else {
            let alpha = tangents[k] / deltas[k];
            let beta = tangents[k + 1] / deltas[k];
            let sum_sq = alpha * alpha + beta * beta;
            if sum_sq > 9.0 {
                let tau = 3.0 / sum_sq.sqrt();
                tangents[k] = tau * alpha * deltas[k];
                tangents[k + 1] = tau * beta * deltas[k];
            }
        }
    }

    // Evaluate LUT using cubic Hermite interpolation
    for (i, entry) in lut.iter_mut().enumerate() {
        let x = i as f64 / CURVE_LUT_SCALE as f64;

        // Extrapolate left
        if x <= knots[0].0 {
            let slope = tangents[0];
            *entry = (knots[0].1 + slope * (x - knots[0].0)) as f32;
            continue;
        }

        // Extrapolate right
        if x >= knots[n - 1].0 {
            let slope = tangents[n - 1];
            *entry = (knots[n - 1].1 + slope * (x - knots[n - 1].0)) as f32;
            continue;
        }

        // Find segment
        let mut seg = 0;
        while seg + 1 < n && x > knots[seg + 1].0 {
            seg += 1;
        }

        let dx = knots[seg + 1].0 - knots[seg].0;
        if dx.abs() < 1e-12 {
            *entry = knots[seg].1 as f32;
            continue;
        }

        let t = (x - knots[seg].0) / dx;
        let t2 = t * t;
        let t3 = t2 * t;

        // Hermite basis functions
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        let y = h00 * knots[seg].1
            + h10 * dx * tangents[seg]
            + h01 * knots[seg + 1].1
            + h11 * dx * tangents[seg + 1];

        *entry = y as f32;
    }

    lut
}

fn apply_lut(value: f32, lut: &[f32]) -> f32 {
    if value <= 0.0 {
        let slope = (lut[1] - lut[0]) * CURVE_LUT_SCALE;
        lut[0] + value * slope
    } else if value >= 1.0 {
        let last = lut.len() - 1;
        let slope = (lut[last] - lut[last - 1]) * CURVE_LUT_SCALE;
        lut[last] + (value - 1.0) * slope
    } else {
        let idx = (value * CURVE_LUT_SCALE) as usize;
        lut[idx]
    }
}

fn make_curve_param(key: &str, label: &str) -> ParamSpec {
    ParamSpec {
        key: key.to_string(),
        label: label.to_string(),
        ty: ValueType::Float,
        default: ParamDefault::CurvePoints(default_curve_points()),
        min: None,
        max: None,
        step: None,
        ui_hint: UiHint::CurveEditor,
        promotable: false,
    }
}

pub struct Curves;

impl Default for Curves {
    fn default() -> Self {
        Self::new()
    }
}

impl Curves {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Curves {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "curves".to_string(),
            display_name: "Curves".to_string(),
            category: "Color".to_string(),
            description: "Per-channel curve adjustment with monotone cubic interpolation"
                .to_string(),
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
                    key: "channel".to_string(),
                    label: "Channel".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Dropdown(vec![
                        "Master".to_string(),
                        "Red".to_string(),
                        "Green".to_string(),
                        "Blue".to_string(),
                    ]),
                    promotable: false,
                },
                make_curve_param("master_curve", "Master"),
                make_curve_param("red_curve", "Red"),
                make_curve_param("green_curve", "Green"),
                make_curve_param("blue_curve", "Blue"),
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let master_pts = ctx.get_param_curve_points("master_curve")?;
            let red_pts = ctx.get_param_curve_points("red_curve")?;
            let green_pts = ctx.get_param_curve_points("green_curve")?;
            let blue_pts = ctx.get_param_curve_points("blue_curve")?;

            let has_master = !is_identity_curve(master_pts);
            let has_red = !is_identity_curve(red_pts);
            let has_green = !is_identity_curve(green_pts);
            let has_blue = !is_identity_curve(blue_pts);

            // Build LUTs only for non-identity curves
            let master_lut = if has_master {
                Some(build_monotone_cubic_lut(master_pts))
            } else {
                None
            };
            let red_lut = if has_red {
                Some(build_monotone_cubic_lut(red_pts))
            } else {
                None
            };
            let green_lut = if has_green {
                Some(build_monotone_cubic_lut(green_pts))
            } else {
                None
            };
            let blue_lut = if has_blue {
                Some(build_monotone_cubic_lut(blue_pts))
            } else {
                None
            };

            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let master_lut = master_lut.map(Arc::new);
                    let red_lut = red_lut.map(Arc::new);
                    let green_lut = green_lut.map(Arc::new);
                    let blue_lut = blue_lut.map(Arc::new);
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [mut r, mut g, mut b, a] = (source)(u, v);
                            // Apply master curve to all channels
                            if let Some(ref lut) = master_lut {
                                r = apply_lut(r, lut);
                                g = apply_lut(g, lut);
                                b = apply_lut(b, lut);
                            }
                            // Apply per-channel curves
                            if let Some(ref lut) = red_lut {
                                r = apply_lut(r, lut);
                            }
                            if let Some(ref lut) = green_lut {
                                g = apply_lut(g, lut);
                            }
                            if let Some(ref lut) = blue_lut {
                                b = apply_lut(b, lut);
                            }
                            [r, g, b, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut r = image.data[idx];
                            let mut g = image.data[idx + 1];
                            let mut b = image.data[idx + 2];
                            let a = image.data[idx + 3];
                            // Apply master curve to all channels
                            if let Some(ref lut) = master_lut {
                                r = apply_lut(r, lut);
                                g = apply_lut(g, lut);
                                b = apply_lut(b, lut);
                            }
                            // Apply per-channel curves
                            if let Some(ref lut) = red_lut {
                                r = apply_lut(r, lut);
                            }
                            if let Some(ref lut) = green_lut {
                                g = apply_lut(g, lut);
                            }
                            if let Some(ref lut) = blue_lut {
                                b = apply_lut(b, lut);
                            }
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

pub struct ColorBalance;

impl Default for ColorBalance {
    fn default() -> Self {
        Self::new()
    }
}

impl ColorBalance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ColorBalance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_balance".to_string(),
            display_name: "Color Balance".to_string(),
            category: "Color".to_string(),
            description: "Adjust color balance".to_string(),
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
                    key: "shadow_r".to_string(),
                    label: "Shadow R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "shadow_g".to_string(),
                    label: "Shadow G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "shadow_b".to_string(),
                    label: "Shadow B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "mid_r".to_string(),
                    label: "Mid R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "mid_g".to_string(),
                    label: "Mid G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "mid_b".to_string(),
                    label: "Mid B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "highlight_r".to_string(),
                    label: "Highlight R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "highlight_g".to_string(),
                    label: "Highlight G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "highlight_b".to_string(),
                    label: "Highlight B".to_string(),
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
                    let shadow_r = ctx.get_param_float("shadow_r")? as f32;
                    let shadow_g = ctx.get_param_float("shadow_g")? as f32;
                    let shadow_b = ctx.get_param_float("shadow_b")? as f32;
                    let mid_r = ctx.get_param_float("mid_r")? as f32;
                    let mid_g = ctx.get_param_float("mid_g")? as f32;
                    let mid_b = ctx.get_param_float("mid_b")? as f32;
                    let highlight_r = ctx.get_param_float("highlight_r")? as f32;
                    let highlight_g = ctx.get_param_float("highlight_g")? as f32;
                    let highlight_b = ctx.get_param_float("highlight_b")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [mut r, mut g, mut b, a] = (source)(u, v);
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let shadow_weight = (1.0 - luminance * 2.0).clamp(0.0, 1.0);
                            let highlight_weight = (luminance * 2.0 - 1.0).clamp(0.0, 1.0);
                            let mid_weight =
                                (1.0 - shadow_weight - highlight_weight).clamp(0.0, 1.0);
                            r += shadow_r * shadow_weight
                                + mid_r * mid_weight
                                + highlight_r * highlight_weight;
                            g += shadow_g * shadow_weight
                                + mid_g * mid_weight
                                + highlight_g * highlight_weight;
                            b += shadow_b * shadow_weight
                                + mid_b * mid_weight
                                + highlight_b * highlight_weight;
                            r = r.clamp(0.0, 1.0);
                            g = g.clamp(0.0, 1.0);
                            b = b.clamp(0.0, 1.0);
                            [r, g, b, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let shadow_r = ctx.get_param_float("shadow_r")? as f32;
                    let shadow_g = ctx.get_param_float("shadow_g")? as f32;
                    let shadow_b = ctx.get_param_float("shadow_b")? as f32;
                    let mid_r = ctx.get_param_float("mid_r")? as f32;
                    let mid_g = ctx.get_param_float("mid_g")? as f32;
                    let mid_b = ctx.get_param_float("mid_b")? as f32;
                    let highlight_r = ctx.get_param_float("highlight_r")? as f32;
                    let highlight_g = ctx.get_param_float("highlight_g")? as f32;
                    let highlight_b = ctx.get_param_float("highlight_b")? as f32;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut r = image.data[idx];
                            let mut g = image.data[idx + 1];
                            let mut b = image.data[idx + 2];
                            let a = image.data[idx + 3];
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let shadow_weight = (1.0 - luminance * 2.0).clamp(0.0, 1.0);
                            let highlight_weight = (luminance * 2.0 - 1.0).clamp(0.0, 1.0);
                            let mid_weight =
                                (1.0 - shadow_weight - highlight_weight).clamp(0.0, 1.0);
                            r += shadow_r * shadow_weight
                                + mid_r * mid_weight
                                + highlight_r * highlight_weight;
                            g += shadow_g * shadow_weight
                                + mid_g * mid_weight
                                + highlight_g * highlight_weight;
                            b += shadow_b * shadow_weight
                                + mid_b * mid_weight
                                + highlight_b * highlight_weight;
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

pub struct ChannelShuffle;

impl Default for ChannelShuffle {
    fn default() -> Self {
        Self::new()
    }
}

impl ChannelShuffle {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ChannelShuffle {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "channel_shuffle".to_string(),
            display_name: "Channel Shuffle".to_string(),
            category: "Color".to_string(),
            description: "Shuffle channels".to_string(),
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
                    key: "r_source".to_string(),
                    label: "R Source".to_string(),
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
                },
                ParamSpec {
                    key: "g_source".to_string(),
                    label: "G Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(1),
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
                },
                ParamSpec {
                    key: "b_source".to_string(),
                    label: "B Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(2),
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
                },
                ParamSpec {
                    key: "a_source".to_string(),
                    label: "A Source".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(3),
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
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let r_source = clamp_channel_source(ctx.get_param_int("r_source")?);
                    let g_source = clamp_channel_source(ctx.get_param_int("g_source")?);
                    let b_source = clamp_channel_source(ctx.get_param_int("b_source")?);
                    let a_source = clamp_channel_source(ctx.get_param_int("a_source")?);
                    let sources = [r_source, g_source, b_source, a_source];
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let channels = [r, g, b, a];
                            [
                                channels[sources[0]],
                                channels[sources[1]],
                                channels[sources[2]],
                                channels[sources[3]],
                            ]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let r_source = clamp_channel_source(ctx.get_param_int("r_source")?);
                    let g_source = clamp_channel_source(ctx.get_param_int("g_source")?);
                    let b_source = clamp_channel_source(ctx.get_param_int("b_source")?);
                    let a_source = clamp_channel_source(ctx.get_param_int("a_source")?);
                    let sources = [r_source, g_source, b_source, a_source];
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let channels = [
                                image.data[idx],
                                image.data[idx + 1],
                                image.data[idx + 2],
                                image.data[idx + 3],
                            ];
                            out[0] = channels[sources[0]];
                            out[1] = channels[sources[1]];
                            out[2] = channels[sources[2]];
                            out[3] = channels[sources[3]];
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

pub struct Threshold;

impl Default for Threshold {
    fn default() -> Self {
        Self::new()
    }
}

impl Threshold {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Threshold {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "threshold".to_string(),
            display_name: "Threshold".to_string(),
            category: "Color".to_string(),
            description: "Threshold image".to_string(),
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
                key: "threshold".to_string(),
                label: "Threshold".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.5),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let threshold = ctx.get_param_float("threshold")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let value = if luminance >= threshold { 1.0 } else { 0.0 };
                            [value, value, value, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let threshold = ctx.get_param_float("threshold")? as f32;
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
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let value = if luminance >= threshold { 1.0 } else { 0.0 };
                            out[0] = value;
                            out[1] = value;
                            out[2] = value;
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

pub struct Posterize;

impl Default for Posterize {
    fn default() -> Self {
        Self::new()
    }
}

impl Posterize {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Posterize {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "posterize".to_string(),
            display_name: "Posterize".to_string(),
            category: "Color".to_string(),
            description: "Posterize image".to_string(),
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
                key: "levels".to_string(),
                label: "Levels".to_string(),
                ty: ValueType::Int,
                default: ParamDefault::Int(8),
                min: Some(2.0),
                max: Some(256.0),
                step: Some(1.0),
                ui_hint: UiHint::NumberInput,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let levels = ctx.get_param_int("levels")?.clamp(2, 256) as i32;
                    let max_level = (levels - 1) as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let mut rgb = [r, g, b];
                            for channel in rgb.iter_mut() {
                                let value = (*channel).clamp(0.0, 1.0);
                                *channel = ((value * max_level) + 0.5).floor() / max_level;
                            }
                            [rgb[0], rgb[1], rgb[2], a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let levels = ctx.get_param_int("levels")?.clamp(2, 256) as i32;
                    let max_level = (levels - 1) as f32;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut rgb =
                                [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                            let a = image.data[idx + 3];
                            for channel in rgb.iter_mut() {
                                let v = (*channel).clamp(0.0, 1.0);
                                *channel = ((v * max_level) + 0.5).floor() / max_level;
                            }
                            out[0] = rgb[0];
                            out[1] = rgb[1];
                            out[2] = rgb[2];
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

pub struct Gamma;

impl Default for Gamma {
    fn default() -> Self {
        Self::new()
    }
}

impl Gamma {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Gamma {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gamma".to_string(),
            display_name: "Gamma".to_string(),
            category: "Color".to_string(),
            description: "Adjust gamma".to_string(),
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
                key: "gamma".to_string(),
                label: "Gamma".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(1.0),
                min: Some(0.1),
                max: Some(10.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let gamma = ctx.get_param_float("gamma")? as f32;
                    let passthrough = (gamma - 1.0).abs() <= f32::EPSILON;
                    let inv_gamma = if gamma.abs() > f32::EPSILON {
                        1.0 / gamma
                    } else {
                        1.0
                    };
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            if passthrough {
                                [r, g, b, a]
                            } else {
                                [r.powf(inv_gamma), g.powf(inv_gamma), b.powf(inv_gamma), a]
                            }
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let gamma = ctx.get_param_float("gamma")? as f32;
                    let passthrough = (gamma - 1.0).abs() <= f32::EPSILON;
                    let inv_gamma = if gamma.abs() > f32::EPSILON {
                        1.0 / gamma
                    } else {
                        1.0
                    };
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    if passthrough {
                        data.par_chunks_exact_mut(4)
                            .enumerate()
                            .for_each(|(i, out)| {
                                let idx = i * 4;
                                out[0] = image.data[idx];
                                out[1] = image.data[idx + 1];
                                out[2] = image.data[idx + 2];
                                out[3] = image.data[idx + 3];
                            });
                    } else {
                        data.par_chunks_exact_mut(4)
                            .enumerate()
                            .for_each(|(i, out)| {
                                let idx = i * 4;
                                let mut rgb =
                                    [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                                let a = image.data[idx + 3];
                                for channel in rgb.iter_mut() {
                                    *channel = (*channel).powf(inv_gamma);
                                }
                                out[0] = rgb[0];
                                out[1] = rgb[1];
                                out[2] = rgb[2];
                                out[3] = a;
                            });
                    }
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

pub struct WhiteBalance;

impl Default for WhiteBalance {
    fn default() -> Self {
        Self::new()
    }
}

impl WhiteBalance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for WhiteBalance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "white_balance".to_string(),
            display_name: "White Balance".to_string(),
            category: "Color".to_string(),
            description: "Adjust white balance".to_string(),
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
                    key: "temperature".to_string(),
                    label: "Temperature".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "tint".to_string(),
                    label: "Tint".to_string(),
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
                    let temperature = ctx.get_param_float("temperature")? as f32;
                    let tint = ctx.get_param_float("tint")? as f32;
                    let temp_factor = temperature * 0.5;
                    let tint_factor = tint * 0.5;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [mut r, mut g, mut b, a] = (source)(u, v);
                            r *= 1.0 + temp_factor;
                            g *= 1.0 - tint_factor;
                            b *= 1.0 - temp_factor;
                            r = r.clamp(0.0, 1.0);
                            g = g.clamp(0.0, 1.0);
                            b = b.clamp(0.0, 1.0);
                            [r, g, b, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let temperature = ctx.get_param_float("temperature")? as f32;
                    let tint = ctx.get_param_float("tint")? as f32;
                    let temp_factor = temperature * 0.5;
                    let tint_factor = tint * 0.5;
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut r = image.data[idx];
                            let mut g = image.data[idx + 1];
                            let mut b = image.data[idx + 2];
                            let a = image.data[idx + 3];
                            r *= 1.0 + temp_factor;
                            g *= 1.0 - tint_factor;
                            b *= 1.0 - temp_factor;
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

pub struct Vibrance;

impl Default for Vibrance {
    fn default() -> Self {
        Self::new()
    }
}

impl Vibrance {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Vibrance {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "vibrance".to_string(),
            display_name: "Vibrance".to_string(),
            category: "Color".to_string(),
            description: "Selectively boost saturation".to_string(),
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
                key: "vibrance".to_string(),
                label: "Vibrance".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let vibrance = ctx.get_param_float("vibrance")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let (h, s, l) = rgb_to_hsl(r, g, b);
                            let sat_boost = vibrance * (1.0 - s);
                            let new_s = (s * (1.0 + sat_boost)).clamp(0.0, 1.0);
                            let (nr, ng, nb) = hsl_to_rgb(h, new_s, l);
                            [nr, ng, nb, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let vibrance = ctx.get_param_float("vibrance")? as f32;
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
                            let (h, s, l) = rgb_to_hsl(r, g, b);
                            let sat_boost = vibrance * (1.0 - s);
                            let new_s = (s * (1.0 + sat_boost)).clamp(0.0, 1.0);
                            let (nr, ng, nb) = hsl_to_rgb(h, new_s, l);
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

pub struct GradientMap;

impl Default for GradientMap {
    fn default() -> Self {
        Self::new()
    }
}

impl GradientMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for GradientMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gradient_map".to_string(),
            display_name: "Gradient Map".to_string(),
            category: "Color".to_string(),
            description: "Map luminance to a color gradient".to_string(),
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
                    key: "color_low_r".to_string(),
                    label: "Color Low R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_low_g".to_string(),
                    label: "Color Low G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_low_b".to_string(),
                    label: "Color Low B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_mid_r".to_string(),
                    label: "Color Mid R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_mid_g".to_string(),
                    label: "Color Mid G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_mid_b".to_string(),
                    label: "Color Mid B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.5),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_high_r".to_string(),
                    label: "Color High R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_high_g".to_string(),
                    label: "Color High G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "color_high_b".to_string(),
                    label: "Color High B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "strength".to_string(),
                    label: "Strength".to_string(),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let color_low_r = ctx.get_param_float("color_low_r")? as f32;
                    let color_low_g = ctx.get_param_float("color_low_g")? as f32;
                    let color_low_b = ctx.get_param_float("color_low_b")? as f32;
                    let color_mid_r = ctx.get_param_float("color_mid_r")? as f32;
                    let color_mid_g = ctx.get_param_float("color_mid_g")? as f32;
                    let color_mid_b = ctx.get_param_float("color_mid_b")? as f32;
                    let color_high_r = ctx.get_param_float("color_high_r")? as f32;
                    let color_high_g = ctx.get_param_float("color_high_g")? as f32;
                    let color_high_b = ctx.get_param_float("color_high_b")? as f32;
                    let strength = ctx.get_param_float("strength")? as f32;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let (mr, mg, mb) = if luminance < 0.5 {
                                let t = luminance * 2.0;
                                (
                                    lerp(color_low_r, color_mid_r, t),
                                    lerp(color_low_g, color_mid_g, t),
                                    lerp(color_low_b, color_mid_b, t),
                                )
                            } else {
                                let t = (luminance - 0.5) * 2.0;
                                (
                                    lerp(color_mid_r, color_high_r, t),
                                    lerp(color_mid_g, color_high_g, t),
                                    lerp(color_mid_b, color_high_b, t),
                                )
                            };
                            let out_r = lerp(r, mr, strength).clamp(0.0, 1.0);
                            let out_g = lerp(g, mg, strength).clamp(0.0, 1.0);
                            let out_b = lerp(b, mb, strength).clamp(0.0, 1.0);
                            [out_r, out_g, out_b, a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let color_low_r = ctx.get_param_float("color_low_r")? as f32;
                    let color_low_g = ctx.get_param_float("color_low_g")? as f32;
                    let color_low_b = ctx.get_param_float("color_low_b")? as f32;
                    let color_mid_r = ctx.get_param_float("color_mid_r")? as f32;
                    let color_mid_g = ctx.get_param_float("color_mid_g")? as f32;
                    let color_mid_b = ctx.get_param_float("color_mid_b")? as f32;
                    let color_high_r = ctx.get_param_float("color_high_r")? as f32;
                    let color_high_g = ctx.get_param_float("color_high_g")? as f32;
                    let color_high_b = ctx.get_param_float("color_high_b")? as f32;
                    let strength = ctx.get_param_float("strength")? as f32;
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
                            let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                            let (mr, mg, mb) = if luminance < 0.5 {
                                let t = luminance * 2.0;
                                (
                                    lerp(color_low_r, color_mid_r, t),
                                    lerp(color_low_g, color_mid_g, t),
                                    lerp(color_low_b, color_mid_b, t),
                                )
                            } else {
                                let t = (luminance - 0.5) * 2.0;
                                (
                                    lerp(color_mid_r, color_high_r, t),
                                    lerp(color_mid_g, color_high_g, t),
                                    lerp(color_mid_b, color_high_b, t),
                                )
                            };
                            let out_r = lerp(r, mr, strength).clamp(0.0, 1.0);
                            let out_g = lerp(g, mg, strength).clamp(0.0, 1.0);
                            let out_b = lerp(b, mb, strength).clamp(0.0, 1.0);
                            out[0] = out_r;
                            out[1] = out_g;
                            out[2] = out_b;
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

pub struct ToneMap;

impl Default for ToneMap {
    fn default() -> Self {
        Self::new()
    }
}

impl ToneMap {
    pub fn new() -> Self {
        Self
    }
}

impl Node for ToneMap {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "tone_map".to_string(),
            display_name: "Tone Map".to_string(),
            category: "Color".to_string(),
            description: "Apply tone mapping".to_string(),
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
                    key: "method".to_string(),
                    label: "Method".to_string(),
                    ty: ValueType::Int,
                    default: ParamDefault::Int(0),
                    min: Some(0.0),
                    max: Some(2.0),
                    step: Some(1.0),
                    ui_hint: UiHint::Dropdown(vec![
                        "Reinhard".to_string(),
                        "ACES Filmic".to_string(),
                        "Uncharted 2".to_string(),
                    ]),
                    promotable: true,
                },
                ParamSpec {
                    key: "exposure".to_string(),
                    label: "Exposure".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-5.0),
                    max: Some(5.0),
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
                    let method = ctx.get_param_int("method")?.clamp(0, 2);
                    let exposure = ctx.get_param_float("exposure")? as f32;
                    let exposure_scale = 2.0_f32.powf(exposure);
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let mut r = r * exposure_scale;
                            let mut g = g * exposure_scale;
                            let mut b = b * exposure_scale;
                            match method {
                                0 => {
                                    r = r / (1.0 + r);
                                    g = g / (1.0 + g);
                                    b = b / (1.0 + b);
                                }
                                1 => {
                                    r = (r * (2.51 * r + 0.03)) / (r * (2.43 * r + 0.59) + 0.14);
                                    g = (g * (2.51 * g + 0.03)) / (g * (2.43 * g + 0.59) + 0.14);
                                    b = (b * (2.51 * b + 0.03)) / (b * (2.43 * b + 0.59) + 0.14);
                                }
                                _ => {
                                    r = tone_map_hable(r);
                                    g = tone_map_hable(g);
                                    b = tone_map_hable(b);
                                }
                            }
                            [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), b.clamp(0.0, 1.0), a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let method = ctx.get_param_int("method")?.clamp(0, 2);
                    let exposure = ctx.get_param_float("exposure")? as f32;
                    let exposure_scale = 2.0_f32.powf(exposure);
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut r = image.data[idx] * exposure_scale;
                            let mut g = image.data[idx + 1] * exposure_scale;
                            let mut b = image.data[idx + 2] * exposure_scale;
                            let a = image.data[idx + 3];
                            match method {
                                0 => {
                                    r = r / (1.0 + r);
                                    g = g / (1.0 + g);
                                    b = b / (1.0 + b);
                                }
                                1 => {
                                    r = (r * (2.51 * r + 0.03)) / (r * (2.43 * r + 0.59) + 0.14);
                                    g = (g * (2.51 * g + 0.03)) / (g * (2.43 * g + 0.59) + 0.14);
                                    b = (b * (2.51 * b + 0.03)) / (b * (2.43 * b + 0.59) + 0.14);
                                }
                                _ => {
                                    r = tone_map_hable(r);
                                    g = tone_map_hable(g);
                                    b = tone_map_hable(b);
                                }
                            }
                            out[0] = r.clamp(0.0, 1.0);
                            out[1] = g.clamp(0.0, 1.0);
                            out[2] = b.clamp(0.0, 1.0);
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

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
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

fn tone_map_hable(v: f32) -> f32 {
    let a = 0.15;
    let b = 0.50;
    let c = 0.10;
    let d = 0.20;
    let e = 0.02;
    let f = 0.30;
    (v * (a * v + c * b) + d * e) / (v * (a * v + b) + d * f) - e / f
}

fn clamp_channel_source(value: i64) -> usize {
    if value < 0 {
        0
    } else if value > 3 {
        3
    } else {
        value as usize
    }
}

pub struct Grade;

impl Default for Grade {
    fn default() -> Self {
        Self::new()
    }
}

impl Grade {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Grade {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "grade".to_string(),
            display_name: "Grade".to_string(),
            category: "Color".to_string(),
            description: "Lift/Gamma/Gain color correction per channel".to_string(),
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
                    key: "lift_r".to_string(),
                    label: "Lift R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "lift_g".to_string(),
                    label: "Lift G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "lift_b".to_string(),
                    label: "Lift B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(1.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gamma_r".to_string(),
                    label: "Gamma R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.1),
                    max: Some(4.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gamma_g".to_string(),
                    label: "Gamma G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.1),
                    max: Some(4.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gamma_b".to_string(),
                    label: "Gamma B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.1),
                    max: Some(4.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gain_r".to_string(),
                    label: "Gain R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(4.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gain_g".to_string(),
                    label: "Gain G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(4.0),
                    step: Some(0.01),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "gain_b".to_string(),
                    label: "Gain B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(0.0),
                    max: Some(4.0),
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
                    let lift = [
                        ctx.get_param_float("lift_r")? as f32,
                        ctx.get_param_float("lift_g")? as f32,
                        ctx.get_param_float("lift_b")? as f32,
                    ];
                    let gamma = [
                        ctx.get_param_float("gamma_r")? as f32,
                        ctx.get_param_float("gamma_g")? as f32,
                        ctx.get_param_float("gamma_b")? as f32,
                    ];
                    let gain = [
                        ctx.get_param_float("gain_r")? as f32,
                        ctx.get_param_float("gain_g")? as f32,
                        ctx.get_param_float("gain_b")? as f32,
                    ];
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let mut rgb = [r, g, b];
                            for c in 0..3 {
                                // Nuke-style Grade: output = gain * (input + lift)^(1/gamma)
                                let inv_gamma = if gamma[c].abs() > f32::EPSILON {
                                    1.0 / gamma[c]
                                } else {
                                    1.0
                                };
                                let lifted = rgb[c] + lift[c];
                                let lifted_positive = lifted.max(0.0);
                                rgb[c] = gain[c] * lifted_positive.powf(inv_gamma);
                            }
                            [rgb[0], rgb[1], rgb[2], a]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let lift = [
                        ctx.get_param_float("lift_r")? as f32,
                        ctx.get_param_float("lift_g")? as f32,
                        ctx.get_param_float("lift_b")? as f32,
                    ];
                    let gamma = [
                        ctx.get_param_float("gamma_r")? as f32,
                        ctx.get_param_float("gamma_g")? as f32,
                        ctx.get_param_float("gamma_b")? as f32,
                    ];
                    let gain = [
                        ctx.get_param_float("gain_r")? as f32,
                        ctx.get_param_float("gain_g")? as f32,
                        ctx.get_param_float("gain_b")? as f32,
                    ];
                    let inv_gamma = [
                        if gamma[0].abs() > f32::EPSILON {
                            1.0 / gamma[0]
                        } else {
                            1.0
                        },
                        if gamma[1].abs() > f32::EPSILON {
                            1.0 / gamma[1]
                        } else {
                            1.0
                        },
                        if gamma[2].abs() > f32::EPSILON {
                            1.0 / gamma[2]
                        } else {
                            1.0
                        },
                    ];
                    let pixel_count = image.pixel_count();
                    let mut data = vec![0.0f32; pixel_count * 4];
                    data.par_chunks_exact_mut(4)
                        .enumerate()
                        .for_each(|(i, out)| {
                            let idx = i * 4;
                            let mut rgb =
                                [image.data[idx], image.data[idx + 1], image.data[idx + 2]];
                            let a = image.data[idx + 3];
                            for c in 0..3 {
                                let lifted = rgb[c] + lift[c];
                                let lifted_positive = lifted.max(0.0);
                                rgb[c] = gain[c] * lifted_positive.powf(inv_gamma[c]);
                            }
                            out[0] = rgb[0];
                            out[1] = rgb[1];
                            out[2] = rgb[2];
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

pub struct Clamp;

impl Default for Clamp {
    fn default() -> Self {
        Self::new()
    }
}

impl Clamp {
    pub fn new() -> Self {
        Self
    }
}

impl Node for Clamp {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "clamp".to_string(),
            display_name: "Clamp".to_string(),
            category: "Color".to_string(),
            description: "Clamp pixel values to a range".to_string(),
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
                    key: "min_r".to_string(),
                    label: "Min R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "min_g".to_string(),
                    label: "Min G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "min_b".to_string(),
                    label: "Min B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(0.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "max_r".to_string(),
                    label: "Max R".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "max_g".to_string(),
                    label: "Max G".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "max_b".to_string(),
                    label: "Max B".to_string(),
                    ty: ValueType::Float,
                    default: ParamDefault::Float(1.0),
                    min: Some(-1.0),
                    max: Some(2.0),
                    step: Some(0.001),
                    ui_hint: UiHint::Slider,
                    promotable: true,
                },
                ParamSpec {
                    key: "clamp_alpha".to_string(),
                    label: "Clamp Alpha".to_string(),
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
            match ctx.get_input_image_or_field("image")? {
                ImageOrField::Field(field) => {
                    let min_vals = [
                        ctx.get_param_float("min_r")? as f32,
                        ctx.get_param_float("min_g")? as f32,
                        ctx.get_param_float("min_b")? as f32,
                    ];
                    let max_vals = [
                        ctx.get_param_float("max_r")? as f32,
                        ctx.get_param_float("max_g")? as f32,
                        ctx.get_param_float("max_b")? as f32,
                    ];
                    let clamp_alpha = ctx.get_param_bool("clamp_alpha")?;
                    let source = field.sample_fn.clone();
                    let transform = field.transform.clone();
                    let wrapped = Field::with_transform(
                        move |u, v| {
                            let [r, g, b, a] = (source)(u, v);
                            let out_a = if clamp_alpha { a.clamp(0.0, 1.0) } else { a };
                            [
                                r.clamp(min_vals[0], max_vals[0]),
                                g.clamp(min_vals[1], max_vals[1]),
                                b.clamp(min_vals[2], max_vals[2]),
                                out_a,
                            ]
                        },
                        transform,
                    );
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Field(wrapped));
                    Ok(outputs)
                }
                ImageOrField::Image(image) => {
                    let min_vals = [
                        ctx.get_param_float("min_r")? as f32,
                        ctx.get_param_float("min_g")? as f32,
                        ctx.get_param_float("min_b")? as f32,
                    ];
                    let max_vals = [
                        ctx.get_param_float("max_r")? as f32,
                        ctx.get_param_float("max_g")? as f32,
                        ctx.get_param_float("max_b")? as f32,
                    ];
                    let clamp_alpha = ctx.get_param_bool("clamp_alpha")?;
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
                            out[0] = r.clamp(min_vals[0], max_vals[0]);
                            out[1] = g.clamp(min_vals[1], max_vals[1]);
                            out[2] = b.clamp(min_vals[2], max_vals[2]);
                            out[3] = if clamp_alpha { a.clamp(0.0, 1.0) } else { a };
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
