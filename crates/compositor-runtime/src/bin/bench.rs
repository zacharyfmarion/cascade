use clap::{Parser, ValueEnum};
use compositor_core::types::Value;
use compositor_nodes_std::input::detect_sequence_pattern;
use compositor_nodes_std::Viewer;
use compositor_runtime::{Engine, ParamValue};
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(long, value_name = "PATH")]
    input_dir: PathBuf,
    #[arg(long, value_name = "PATH")]
    output_dir: Option<PathBuf>,
    #[arg(long)]
    start_frame: Option<u64>,
    #[arg(long)]
    end_frame: Option<u64>,
    #[arg(long, default_value = "png", value_enum)]
    format: OutputFormat,
    #[arg(long, default_value_t = 0)]
    warmup: u64,
    #[arg(long)]
    no_encode: bool,
    #[arg(long, default_value = "passthrough", value_enum)]
    node: NodeKind,
}

#[derive(Clone, Debug, ValueEnum)]
enum OutputFormat {
    Png,
    Jpg,
}

impl OutputFormat {
    fn extension(&self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Png => "PNG",
            Self::Jpg => "JPEG",
        }
    }

    fn format_param(&self) -> i64 {
        match self {
            Self::Png => 0,
            Self::Jpg => 1,
        }
    }
}

#[derive(Clone, Debug, ValueEnum)]
enum NodeKind {
    Passthrough,
    HueSaturation,
    BrightnessContrast,
    Invert,
    GaussianBlur,
}

impl NodeKind {
    fn node_id(&self) -> Option<&'static str> {
        match self {
            Self::Passthrough => None,
            Self::HueSaturation => Some("hue_saturation"),
            Self::BrightnessContrast => Some("brightness_contrast"),
            Self::Invert => Some("invert"),
            Self::GaussianBlur => Some("gaussian_blur"),
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Passthrough => "passthrough",
            Self::HueSaturation => "hue_saturation",
            Self::BrightnessContrast => "brightness_contrast",
            Self::Invert => "invert",
            Self::GaussianBlur => "gaussian_blur",
        }
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("Error: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse();
    let format = args.format.clone();
    let node = args.node.clone();
    let warmup = args.warmup;
    let no_encode = args.no_encode;

    if !args.input_dir.is_dir() {
        return Err(format!(
            "Input directory does not exist: {}",
            args.input_dir.display()
        ));
    }

    if let Some(output_dir) = &args.output_dir {
        if !output_dir.is_dir() {
            return Err(format!(
                "Output directory does not exist: {}",
                output_dir.display()
            ));
        }
    }

    let mut engine = Engine::new();

    let load_id = engine
        .add_node("load_image_sequence", 0.0, 0.0)
        .map_err(|e| e.to_string())?;

    let process_id = if let Some(node_id) = node.node_id() {
        Some(
            engine
                .add_node(node_id, 200.0, 0.0)
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    let export_id = engine
        .add_node("export_image_sequence", 400.0, 0.0)
        .map_err(|e| e.to_string())?;

    if let Some(process_id) = &process_id {
        engine
            .connect(&load_id, "image", process_id, "image")
            .map_err(|e| e.to_string())?;
        engine
            .connect(process_id, "image", &export_id, "image")
            .map_err(|e| e.to_string())?;
    } else {
        engine
            .connect(&load_id, "image", &export_id, "image")
            .map_err(|e| e.to_string())?;
    }

    let input_dir = args.input_dir.to_string_lossy().to_string();
    let pattern = detect_sequence_pattern(&input_dir);
    engine
        .set_sequence_directory(&load_id, &input_dir)
        .map_err(|e| e.to_string())?;
    engine
        .set_param(&load_id, "pattern", ParamValue::String(pattern.clone()))
        .map_err(|e| e.to_string())?;

    let sequence_info = engine
        .get_sequence_info(&load_id, &pattern)
        .map_err(|e| e.to_string())?;
    if sequence_info.frame_count == 0 {
        return Err("No frames detected in input directory".to_string());
    }

    let start_frame = args.start_frame.unwrap_or(sequence_info.first_frame);
    let end_frame = args.end_frame.unwrap_or(sequence_info.last_frame);
    if start_frame > end_frame {
        return Err("start-frame must be <= end-frame".to_string());
    }

    if let Some(output_dir) = &args.output_dir {
        engine
            .set_param(
                &export_id,
                "output_dir",
                ParamValue::String(output_dir.to_string_lossy().to_string()),
            )
            .map_err(|e| e.to_string())?;
    }
    engine
        .set_param(
            &export_id,
            "start_frame",
            ParamValue::Int(start_frame as i64),
        )
        .map_err(|e| e.to_string())?;
    engine
        .set_param(&export_id, "end_frame", ParamValue::Int(end_frame as i64))
        .map_err(|e| e.to_string())?;
    engine
        .set_param(&export_id, "step", ParamValue::Int(1))
        .map_err(|e| e.to_string())?;
    engine
        .set_param(&export_id, "format", ParamValue::Int(format.format_param()))
        .map_err(|e| e.to_string())?;

    let total_frames = end_frame - start_frame + 1;
    let padding = frame_padding(end_frame);

    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };

    let mut eval_times = Vec::new();
    let mut convert_times = Vec::new();
    let mut encode_times = Vec::new();
    let mut write_times = Vec::new();
    let mut total_times = Vec::new();

    let mut header_printed = false;
    let mut frame_index = 0u64;
    for frame in start_frame..=end_frame {
        let eval_start = Instant::now();
        let eval_result = engine
            .evaluate_node(&export_id, frame)
            .map_err(|e| e.to_string())?;
        let eval_ms = elapsed_ms(eval_start);

        let image = match eval_result.value {
            Value::Image(img) => img,
            _ => return Err(format!("Frame {} output is not an image", frame)),
        };

        if !header_printed {
            let output_label = match &args.output_dir {
                Some(dir) => dir.display().to_string(),
                None => "<none>".to_string(),
            };
            eprintln!("compositor-bench v{}", env!("CARGO_PKG_VERSION"));
            eprintln!("Profile: {}", profile);
            eprintln!(
                "Input: {} ({} frames, {}x{})",
                input_dir, total_frames, image.width, image.height
            );
            eprintln!("Output: {} ({})", output_label, format.label());
            eprintln!("Node: {}", node.label());
            eprintln!("Threads: {} (rayon)", rayon::current_num_threads());
            eprintln!("");
            eprintln!("Frame   Evaluate(ms)  Convert(ms)  Encode(ms)  Write(ms)  Total(ms)");
            header_printed = true;
        }

        let (convert_ms, rgba8) = if no_encode {
            (0.0, None)
        } else {
            let convert_start = Instant::now();
            let rgba8 = Viewer::image_to_rgba8(&image);
            (elapsed_ms(convert_start), Some(rgba8))
        };

        let (encode_ms, bytes) = if no_encode {
            (0.0, None)
        } else {
            let rgba8 = rgba8.ok_or_else(|| "Missing RGBA data".to_string())?;
            let encode_start = Instant::now();
            let bytes = match format {
                OutputFormat::Png => encode_png(&rgba8, image.width, image.height)?,
                OutputFormat::Jpg => encode_jpeg(rgba8, image.width, image.height)?,
            };
            (elapsed_ms(encode_start), Some(bytes))
        };

        let write_ms = if no_encode {
            0.0
        } else if let Some(output_dir) = &args.output_dir {
            let filename = format!("{:0>width$}.{}", frame, format.extension(), width = padding);
            let path = output_dir.join(filename);
            let bytes = bytes.ok_or_else(|| "Missing encoded bytes".to_string())?;
            let write_start = Instant::now();
            std::fs::write(&path, bytes)
                .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
            elapsed_ms(write_start)
        } else {
            0.0
        };

        let total_ms = eval_ms + convert_ms + encode_ms + write_ms;
        eprintln!(
            "{:0>width$}    {:>10.1}   {:>10.1}   {:>10.1}   {:>9.1}   {:>10.1}",
            frame,
            eval_ms,
            convert_ms,
            encode_ms,
            write_ms,
            total_ms,
            width = padding
        );

        let is_warmup = frame_index < warmup;
        if !is_warmup {
            eval_times.push(eval_ms);
            convert_times.push(convert_ms);
            encode_times.push(encode_ms);
            write_times.push(write_ms);
            total_times.push(total_ms);
        }
        frame_index += 1;
    }

    eprintln!("");
    eprintln!("WARMUP: {} frames discarded", warmup);
    eprintln!("");

    let eval_stats = Stats::from_samples(&eval_times);
    let convert_stats = Stats::from_samples(&convert_times);
    let encode_stats = Stats::from_samples(&encode_times);
    let write_stats = Stats::from_samples(&write_times);
    let total_stats = Stats::from_samples(&total_times);

    eprintln!("             Evaluate  Convert  Encode   Write    Total");
    eprintln!(
        "Mean (ms):   {:>7.1}   {:>6.1}   {:>6.1}   {:>6.1}   {:>7.1}",
        eval_stats.mean, convert_stats.mean, encode_stats.mean, write_stats.mean, total_stats.mean
    );
    eprintln!(
        "P50 (ms):    {:>7.1}   {:>6.1}   {:>6.1}   {:>6.1}   {:>7.1}",
        eval_stats.p50, convert_stats.p50, encode_stats.p50, write_stats.p50, total_stats.p50
    );
    eprintln!(
        "P99 (ms):    {:>7.1}   {:>6.1}   {:>6.1}   {:>6.1}   {:>7.1}",
        eval_stats.p99, convert_stats.p99, encode_stats.p99, write_stats.p99, total_stats.p99
    );
    eprintln!(
        "Total (s):   {:>7.1}   {:>6.1}   {:>6.1}   {:>6.1}   {:>7.1}",
        eval_stats.total / 1000.0,
        convert_stats.total / 1000.0,
        encode_stats.total / 1000.0,
        write_stats.total / 1000.0,
        total_stats.total / 1000.0
    );
    eprintln!(
        "% of total:  {:>6.1}%   {:>5.1}%   {:>5.1}%   {:>5.1}%   {:>6.1}%",
        percentage(eval_stats.total, total_stats.total),
        percentage(convert_stats.total, total_stats.total),
        percentage(encode_stats.total, total_stats.total),
        percentage(write_stats.total, total_stats.total),
        if total_stats.total > 0.0 { 100.0 } else { 0.0 }
    );

    Ok(())
}

fn encode_png(rgba8: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    let mut encoder = png::Encoder::new(&mut buf, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::FilterType::Sub);
    let mut writer = encoder
        .write_header()
        .map_err(|e| format!("PNG encode failed: {e}"))?;
    writer
        .write_image_data(rgba8)
        .map_err(|e| format!("PNG encode failed: {e}"))?;
    drop(writer);
    Ok(buf)
}

fn encode_jpeg(rgba8: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img = image::RgbaImage::from_raw(width, height, rgba8)
        .ok_or_else(|| "Failed to create image buffer".to_string())?;
    let rgb_img = image::DynamicImage::ImageRgba8(img).into_rgb8();
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    rgb_img
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(buf)
}

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn frame_padding(end_frame: u64) -> usize {
    if end_frame == 0 {
        return 4;
    }
    let digits = (end_frame as f64).log10().ceil() as usize + 1;
    std::cmp::max(4, digits)
}

fn percentage(part: f64, total: f64) -> f64 {
    if total <= 0.0 {
        0.0
    } else {
        (part / total) * 100.0
    }
}

#[derive(Clone, Debug)]
struct Stats {
    mean: f64,
    p50: f64,
    p99: f64,
    total: f64,
}

impl Stats {
    fn from_samples(samples: &[f64]) -> Self {
        if samples.is_empty() {
            return Self {
                mean: 0.0,
                p50: 0.0,
                p99: 0.0,
                total: 0.0,
            };
        }

        let mut sorted = samples.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let total: f64 = sorted.iter().sum();
        let mean = total / sorted.len() as f64;
        let p50 = percentile(&sorted, 50.0);
        let p99 = percentile(&sorted, 99.0);

        Self {
            mean,
            p50,
            p99,
            total,
        }
    }
}

fn percentile(sorted: &[f64], percentile: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (percentile / 100.0) * (sorted.len() as f64 - 1.0);
    let idx = rank.round() as usize;
    sorted[idx]
}
