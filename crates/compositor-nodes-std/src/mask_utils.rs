use compositor_core::error::CompositorError;
use compositor_core::types::Image;
use rayon::prelude::*;

/// Apply a mask to blend between original and processed images.
/// For each pixel: output = lerp(original, processed, mask_luminance)
/// mask_luminance = 0.2126*R + 0.7152*G + 0.0722*B from the mask image
pub fn apply_mask(
    original: &Image,
    processed: &Image,
    mask: &Image,
) -> Result<Image, CompositorError> {
    let pixel_count = processed.pixel_count();
    let proc_width = processed.width as usize;
    let mask_width = mask.width as usize;
    let mask_max_x = mask.width.saturating_sub(1) as usize;
    let mask_max_y = mask.height.saturating_sub(1) as usize;
    let orig_data = &original.data;
    let proc_data = &processed.data;
    let mask_data = &mask.data;
    let mut data = vec![0.0f32; pixel_count * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let idx = i * 4;
            let x = i % proc_width;
            let y = i / proc_width;
            let mx = x.min(mask_max_x);
            let my = y.min(mask_max_y);
            let mask_idx = (my * mask_width + mx) * 4;
            let mask_r = mask_data[mask_idx];
            let mask_g = mask_data[mask_idx + 1];
            let mask_b = mask_data[mask_idx + 2];
            let mask_lum = (0.2126 * mask_r + 0.7152 * mask_g + 0.0722 * mask_b).clamp(0.0, 1.0);
            let inv_mask = 1.0 - mask_lum;
            for c in 0..4 {
                let orig_val = orig_data[idx + c];
                let proc_val = proc_data[idx + c];
                out[c] = orig_val * inv_mask + proc_val * mask_lum;
            }
        });
    Image::new_with_domain(
        processed.format.clone(),
        processed.data_window,
        data,
        processed.color_space.clone(),
    )
}
