use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use std::any::Any;
use std::collections::HashMap;

pub struct GaussianBlur;

impl GaussianBlur {
    pub fn new() -> Self {
        Self
    }
}

impl Node for GaussianBlur {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "gaussian_blur".to_string(),
            display_name: "Gaussian Blur".to_string(),
            category: "Filter".to_string(),
            description: "Apply Gaussian blur".to_string(),
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
                key: "sigma".to_string(),
                label: "Sigma".to_string(),
                ty: ValueType::Float,
                default: ParamDefault::Float(0.0),
                min: Some(0.0),
                max: Some(100.0),
                step: Some(0.1),
                ui_hint: UiHint::Slider,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let image = ctx.get_input_image("image")?;
            let sigma = ctx.get_param_float("sigma")? as f32;

            if sigma < 0.1 {
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

            let mut buf = image_to_f32(image);
            let radii = box_radii_for_gaussian(sigma, 3);
            let mut tmp = vec![0.0f32; w * h * 4];

            // Image data is straight alpha. Premultiply before blurring so
            // transparent pixels (which may have arbitrary RGB) contribute
            // correctly to the weighted average, then unpremultiply after.
            premultiply_buffer(&mut buf);

            for &r in &radii {
                box_blur_h(&buf, &mut tmp, w, h, r);
                box_blur_v(&tmp, &mut buf, w, h, r);
            }

            unpremultiply_buffer(&mut buf);

            let out_data = buf;
            let output = Image::new_with_domain(
                image.format.clone(),
                image.data_window,
                out_data,
                image.color_space.clone(),
            );
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

pub(crate) fn premultiply_buffer(buf: &mut [f32]) {
    buf.par_chunks_exact_mut(4).for_each(|px| {
        let a = px[3];
        px[0] *= a;
        px[1] *= a;
        px[2] *= a;
    });
}

pub(crate) fn unpremultiply_buffer(buf: &mut [f32]) {
    buf.par_chunks_exact_mut(4).for_each(|px| {
        let a = px[3];
        if a > 0.0 {
            let inv_a = 1.0 / a;
            px[0] *= inv_a;
            px[1] *= inv_a;
            px[2] *= inv_a;
        }
    });
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

/// Compute box radii that approximate a Gaussian blur when applied N passes.
/// Uses the algorithm from W3C SVG spec / "Fastest Gaussian Blur" by Ivan Kutskir.
pub(crate) fn box_radii_for_gaussian(sigma: f32, n: usize) -> Vec<usize> {
    let w_ideal = ((12.0 * sigma * sigma / n as f32) + 1.0).sqrt();
    let mut wl = w_ideal.floor() as usize;
    if wl % 2 == 0 {
        wl -= 1;
    }
    let wu = wl + 2;

    let m_ideal =
        (12.0 * sigma * sigma - (n * wl * wl + 4 * n * wl + 3 * n) as f32) / (4 * wl + 4) as f32;
    let m = m_ideal.round() as usize;

    (0..n)
        .map(|i| {
            let size = if i < m { wl } else { wu };
            (size - 1) / 2
        })
        .collect()
}

/// Horizontal box blur pass — O(width × height), independent of radius.
pub(crate) fn box_blur_h(src: &[f32], dst: &mut [f32], w: usize, _h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let span = (2 * r + 1) as f32;
    let iarr = 1.0 / span;
    let row_stride = w * 4;

    dst.par_chunks_exact_mut(row_stride)
        .enumerate()
        .for_each(|(y, dst_row)| {
            let row = y * row_stride;

            let mut acc = [0.0f32; 4];
            for i in 0..=r {
                let idx = row + i * 4;
                acc[0] += src[idx];
                acc[1] += src[idx + 1];
                acc[2] += src[idx + 2];
                acc[3] += src[idx + 3];
            }
            // Left edge pixels are clamped — count the leading edge repeats
            let first = [src[row], src[row + 1], src[row + 2], src[row + 3]];
            for c in 0..4 {
                acc[c] += first[c] * r as f32;
            }

            for x in 0..w {
                let out = x * 4;
                for c in 0..4 {
                    dst_row[out + c] = acc[c] * iarr;
                }

                let add_x = (x + r + 1).min(w - 1);
                let sub_x = if x >= r { x - r } else { 0 };
                let add = row + add_x * 4;
                let sub = row + sub_x * 4;

                let sub_vals = if x < r {
                    first
                } else {
                    [src[sub], src[sub + 1], src[sub + 2], src[sub + 3]]
                };

                for c in 0..4 {
                    acc[c] += src[add + c] - sub_vals[c];
                }
            }
        });
}

/// Vertical box blur pass — O(width × height), independent of radius.
/// Iterates column-major but processes one column at a time for locality.
pub(crate) fn box_blur_v(src: &[f32], dst: &mut [f32], w: usize, h: usize, r: usize) {
    if r == 0 {
        dst.copy_from_slice(src);
        return;
    }
    let span = (2 * r + 1) as f32;
    let iarr = 1.0 / span;
    let stride = w * 4;
    let mut columns = vec![0.0f32; w * h * 4];

    columns
        .par_chunks_exact_mut(h * 4)
        .enumerate()
        .for_each(|(x, col_buf)| {
            let col = x * 4;

            let mut acc = [0.0f32; 4];
            for i in 0..=r {
                let idx = i * stride + col;
                acc[0] += src[idx];
                acc[1] += src[idx + 1];
                acc[2] += src[idx + 2];
                acc[3] += src[idx + 3];
            }
            let first = [src[col], src[col + 1], src[col + 2], src[col + 3]];
            for c in 0..4 {
                acc[c] += first[c] * r as f32;
            }

            for y in 0..h {
                let out = y * 4;
                for c in 0..4 {
                    col_buf[out + c] = acc[c] * iarr;
                }

                let add_y = (y + r + 1).min(h - 1);
                let sub_y = if y >= r { y - r } else { 0 };
                let add = add_y * stride + col;
                let sub = sub_y * stride + col;

                let sub_vals = if y < r {
                    first
                } else {
                    [src[sub], src[sub + 1], src[sub + 2], src[sub + 3]]
                };

                for c in 0..4 {
                    acc[c] += src[add + c] - sub_vals[c];
                }
            }
        });

    dst.par_chunks_exact_mut(stride)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..w {
                let col_buf = &columns[x * h * 4..(x + 1) * h * 4];
                let src_idx = y * 4;
                let col = x * 4;
                row[col] = col_buf[src_idx];
                row[col + 1] = col_buf[src_idx + 1];
                row[col + 2] = col_buf[src_idx + 2];
                row[col + 3] = col_buf[src_idx + 3];
            }
        });
}
