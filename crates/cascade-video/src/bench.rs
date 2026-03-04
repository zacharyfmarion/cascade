#![cfg(target_os = "macos")]

use cascade_video::{DecodedFrame, LinearFrame, VideoDecoder};
use rayon::prelude::*;
use std::sync::OnceLock;
use std::time::Instant;

fn srgb_to_linear_lut() -> &'static [f32; 256] {
    static LUT: OnceLock<[f32; 256]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut table = [0.0f32; 256];
        for i in 0..256 {
            let v = i as f32 / 255.0;
            table[i] = if v <= 0.04045 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            };
        }
        table
    })
}

fn linear_to_srgb_u8(v: f32) -> u8 {
    let c = v.clamp(0.0, 1.0);
    let s = if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0 + 0.5) as u8
}

fn bench_srgb_to_linear(frame: &DecodedFrame) -> Vec<f32> {
    let lut = srgb_to_linear_lut();
    let pixel_count = (frame.width as usize) * (frame.height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let idx = i * 4;
            out[0] = lut[frame.rgba_data[idx] as usize];
            out[1] = lut[frame.rgba_data[idx + 1] as usize];
            out[2] = lut[frame.rgba_data[idx + 2] as usize];
            out[3] = frame.rgba_data[idx + 3] as f32 / 255.0;
        });
    data
}

fn bench_linear_to_srgb(linear: &[f32], width: u32, height: u32) -> Vec<u8> {
    let pixel_count = (width as usize) * (height as usize);
    let mut out = vec![0u8; pixel_count * 4];
    out.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, rgba)| {
            let idx = i * 4;
            rgba[0] = linear_to_srgb_u8(linear[idx]);
            rgba[1] = linear_to_srgb_u8(linear[idx + 1]);
            rgba[2] = linear_to_srgb_u8(linear[idx + 2]);
            rgba[3] = (linear[idx + 3].clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        });
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: video-bench <video-file> [num-frames]");
        std::process::exit(1);
    }
    let path = &args[1];
    let num_frames: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(60);

    let decoder = VideoDecoder::new(path).expect("Failed to open video");
    let info = decoder.info();
    println!(
        "Video: {}x{} @ {:.2}fps, {} frames, {:.2}s",
        info.width, info.height, info.fps, info.frame_count, info.duration_secs
    );
    println!(
        "Benchmarking {} frames...\n",
        num_frames.min(info.frame_count)
    );

    let frames_to_bench = num_frames.min(info.frame_count);

    // Stage 1: AVFoundation sequential decode (decode_frame_at_time)
    let t0 = Instant::now();
    let mut decoded_frames: Vec<DecodedFrame> = Vec::with_capacity(frames_to_bench as usize);
    for i in 0..frames_to_bench {
        let frame = decoder
            .decode_frame_at_time(i)
            .expect("decode error")
            .expect("no frame");
        decoded_frames.push(frame);
    }
    let decode_elapsed = t0.elapsed();
    let decode_per_frame = decode_elapsed / frames_to_bench as u32;
    println!(
        "Stage 1 - AVFoundation decode ({} frames sequential):",
        frames_to_bench
    );
    println!("  Total:     {:?}", decode_elapsed);
    println!(
        "  Per frame: {:?} ({:.1} fps)\n",
        decode_per_frame,
        1.0 / decode_per_frame.as_secs_f64()
    );

    // Stage 2: sRGB u8 → linear f32 (rayon parallel)
    let t1 = Instant::now();
    let mut linear_frames: Vec<Vec<f32>> = Vec::with_capacity(frames_to_bench as usize);
    for frame in &decoded_frames {
        linear_frames.push(bench_srgb_to_linear(frame));
    }
    let srgb_elapsed = t1.elapsed();
    let srgb_per_frame = srgb_elapsed / frames_to_bench as u32;
    println!(
        "Stage 2 - sRGB→linear f32 ({} frames, rayon):",
        frames_to_bench
    );
    println!("  Total:     {:?}", srgb_elapsed);
    println!(
        "  Per frame: {:?} ({:.1} fps)\n",
        srgb_per_frame,
        1.0 / srgb_per_frame.as_secs_f64()
    );

    // Stage 3: linear f32 → sRGB u8 (viewer output, rayon parallel)
    let t2 = Instant::now();
    for linear in &linear_frames {
        let _out = bench_linear_to_srgb(linear, info.width, info.height);
    }
    let output_elapsed = t2.elapsed();
    let output_per_frame = output_elapsed / frames_to_bench as u32;
    println!(
        "Stage 3 - linear→sRGB u8 output ({} frames, rayon):",
        frames_to_bench
    );
    println!("  Total:     {:?}", output_elapsed);
    println!(
        "  Per frame: {:?} ({:.1} fps)\n",
        output_per_frame,
        1.0 / output_per_frame.as_secs_f64()
    );

    // Full pipeline per frame
    let total_per_frame = decode_per_frame + srgb_per_frame + output_per_frame;
    println!("=== Full pipeline per frame ===");
    println!(
        "  Decode:       {:?} ({:.0}%)",
        decode_per_frame,
        decode_per_frame.as_secs_f64() / total_per_frame.as_secs_f64() * 100.0
    );
    println!(
        "  sRGB→linear:  {:?} ({:.0}%)",
        srgb_per_frame,
        srgb_per_frame.as_secs_f64() / total_per_frame.as_secs_f64() * 100.0
    );
    println!(
        "  linear→sRGB:  {:?} ({:.0}%)",
        output_per_frame,
        output_per_frame.as_secs_f64() / total_per_frame.as_secs_f64() * 100.0
    );
    println!(
        "  TOTAL:        {:?} ({:.1} fps)",
        total_per_frame,
        1.0 / total_per_frame.as_secs_f64()
    );

    let decoder2 = VideoDecoder::new(path).expect("Failed to open video");
    let lut = srgb_to_linear_lut();
    let t3 = Instant::now();
    let mut fused_frames: Vec<LinearFrame> = Vec::with_capacity(frames_to_bench as usize);
    for i in 0..frames_to_bench {
        let frame = decoder2
            .decode_frame_linear(i, lut)
            .expect("decode error")
            .expect("no frame");
        fused_frames.push(frame);
    }
    let fused_elapsed = t3.elapsed();
    let fused_per_frame = fused_elapsed / frames_to_bench as u32;
    let old_combined = decode_per_frame + srgb_per_frame;
    println!("\n=== Fused decode+convert (decode_frame_linear) ===");
    println!(
        "  Per frame: {:?} ({:.1} fps)",
        fused_per_frame,
        1.0 / fused_per_frame.as_secs_f64()
    );
    println!(
        "  vs old (decode+sRGB→linear): {:?} ({:.1}x speedup)",
        old_combined,
        old_combined.as_secs_f64() / fused_per_frame.as_secs_f64()
    );

    let fused_total = fused_per_frame + output_per_frame;
    println!("\n=== New full pipeline (fused decode + output) ===");
    println!(
        "  TOTAL:        {:?} ({:.1} fps)",
        fused_total,
        1.0 / fused_total.as_secs_f64()
    );
}
