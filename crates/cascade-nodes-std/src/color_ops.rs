use cascade_core::node::{EvalContext, ImageOrField, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

const CURVE_LUT_SIZE: usize = 4096;
const CURVE_LUT_SCALE: f32 = (CURVE_LUT_SIZE - 1) as f32;

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
