use clap::{Parser, ValueEnum};
use compositor_core::color::BuiltinColorManagement;
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
    Levels,
    Curves,
    ColorBalance,
    ChannelShuffle,
    Threshold,
    Posterize,
    Gamma,
    SeparateHsva,
    WhiteBalance,
    Vibrance,
    GradientMap,
    ToneMap,
    Sharpen,
    EdgeDetect,
    Dilate,
    Erode,
    Median,
    Vignette,
    Glow,
    LensDistortion,
    Premultiply,
    Unpremultiply,
    ExtractChannel,
    ChromaKey,
    Despill,
    Crop,
    Flip,
    Rotate,
    Translate,
    Transform2D,
    Resize,
    MapRange,
    MathNode,
}

impl NodeKind {
    fn node_id(&self) -> Option<&'static str> {
        match self {
            Self::Passthrough => None,
            Self::HueSaturation => Some("hue_saturation"),
            Self::BrightnessContrast => Some("brightness_contrast"),
            Self::Invert => Some("invert"),
            Self::GaussianBlur => Some("gaussian_blur"),
            Self::Levels => Some("levels"),
            Self::Curves => Some("curves"),
            Self::ColorBalance => Some("color_balance"),
            Self::ChannelShuffle => Some("channel_shuffle"),
            Self::Threshold => Some("threshold"),
            Self::Posterize => Some("posterize"),
            Self::Gamma => Some("gamma"),
            Self::SeparateHsva => Some("separate_hsva"),
            Self::WhiteBalance => Some("white_balance"),
            Self::Vibrance => Some("vibrance"),
            Self::GradientMap => Some("gradient_map"),
            Self::ToneMap => Some("tone_map"),
            Self::Sharpen => Some("sharpen"),
            Self::EdgeDetect => Some("edge_detect"),
            Self::Dilate => Some("dilate"),
            Self::Erode => Some("erode"),
            Self::Median => Some("median"),
            Self::Vignette => Some("vignette"),
            Self::Glow => Some("glow"),
            Self::LensDistortion => Some("lens_distortion"),
            Self::Premultiply => Some("premultiply"),
            Self::Unpremultiply => Some("unpremultiply"),
            Self::ExtractChannel => Some("extract_channel"),
            Self::ChromaKey => Some("chroma_key"),
            Self::Despill => Some("despill"),
            Self::Crop => Some("crop"),
            Self::Flip => Some("flip"),
            Self::Rotate => Some("rotate"),
            Self::Translate => Some("translate"),
            Self::Transform2D => Some("transform_2d"),
            Self::Resize => Some("resize"),
            Self::MapRange => Some("map_range"),
            Self::MathNode => Some("math"),
        }
    }

    fn label(&self) -> &'static str {
        match self {
            Self::Passthrough => "passthrough",
            Self::HueSaturation => "hue_saturation",
            Self::BrightnessContrast => "brightness_contrast",
            Self::Invert => "invert",
            Self::GaussianBlur => "gaussian_blur",
            Self::Levels => "levels",
            Self::Curves => "curves",
            Self::ColorBalance => "color_balance",
            Self::ChannelShuffle => "channel_shuffle",
            Self::Threshold => "threshold",
            Self::Posterize => "posterize",
            Self::Gamma => "gamma",
            Self::SeparateHsva => "separate_hsva",
            Self::WhiteBalance => "white_balance",
            Self::Vibrance => "vibrance",
            Self::GradientMap => "gradient_map",
            Self::ToneMap => "tone_map",
            Self::Sharpen => "sharpen",
            Self::EdgeDetect => "edge_detect",
            Self::Dilate => "dilate",
            Self::Erode => "erode",
            Self::Median => "median",
            Self::Vignette => "vignette",
            Self::Glow => "glow",
            Self::LensDistortion => "lens_distortion",
            Self::Premultiply => "premultiply",
            Self::Unpremultiply => "unpremultiply",
            Self::ExtractChannel => "extract_channel",
            Self::ChromaKey => "chroma_key",
            Self::Despill => "despill",
            Self::Crop => "crop",
            Self::Flip => "flip",
            Self::Rotate => "rotate",
            Self::Translate => "translate",
            Self::Transform2D => "transform_2d",
            Self::Resize => "resize",
            Self::MapRange => "map_range",
            Self::MathNode => "math",
        }
    }

    fn configure_params(&self, engine: &mut Engine, node_id: &str) -> Result<(), String> {
        match self {
            Self::Passthrough
            | Self::Invert
            | Self::Premultiply
            | Self::Unpremultiply
            | Self::SeparateHsva => Ok(()),
            Self::HueSaturation => {
                engine
                    .set_param(node_id, "hue", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "saturation", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::BrightnessContrast => {
                engine
                    .set_param(node_id, "brightness", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "contrast", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::GaussianBlur => {
                engine
                    .set_param(node_id, "sigma", ParamValue::Float(5.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Levels => {
                engine
                    .set_param(node_id, "in_black", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "in_white", ParamValue::Float(0.9))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "gamma", ParamValue::Float(1.2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "out_black", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "out_white", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Curves => {
                engine
                    .set_param(node_id, "black_point", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "shadows", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "midtones", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "highlights", ParamValue::Float(0.8))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "white_point", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::ColorBalance => {
                engine
                    .set_param(node_id, "shadow_r", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "shadow_g", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "shadow_b", ParamValue::Float(-0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "mid_r", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "mid_g", ParamValue::Float(0.05))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "mid_b", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "highlight_r", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "highlight_g", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "highlight_b", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::ChannelShuffle => {
                engine
                    .set_param(node_id, "r_source", ParamValue::Int(2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "g_source", ParamValue::Int(0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "b_source", ParamValue::Int(1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "a_source", ParamValue::Int(3))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Threshold => {
                engine
                    .set_param(node_id, "threshold", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Posterize => {
                engine
                    .set_param(node_id, "levels", ParamValue::Int(8))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Gamma => {
                engine
                    .set_param(node_id, "gamma", ParamValue::Float(2.2))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::WhiteBalance => {
                engine
                    .set_param(node_id, "temperature", ParamValue::Float(0.3))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "tint", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Vibrance => {
                engine
                    .set_param(node_id, "vibrance", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::GradientMap => {
                engine
                    .set_param(node_id, "color_low_r", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_low_g", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_low_b", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_mid_r", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_mid_g", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_mid_b", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_high_r", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_high_g", ParamValue::Float(0.9))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "color_high_b", ParamValue::Float(0.8))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "strength", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::ToneMap => {
                engine
                    .set_param(node_id, "method", ParamValue::Int(0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "exposure", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Sharpen => {
                engine
                    .set_param(node_id, "amount", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "radius", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::EdgeDetect => {
                engine
                    .set_param(node_id, "strength", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Dilate => {
                engine
                    .set_param(node_id, "radius", ParamValue::Int(3))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Erode => {
                engine
                    .set_param(node_id, "radius", ParamValue::Int(3))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Median => {
                engine
                    .set_param(node_id, "radius", ParamValue::Int(1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Vignette => {
                engine
                    .set_param(node_id, "amount", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "size", ParamValue::Float(0.8))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "softness", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Glow => {
                engine
                    .set_param(node_id, "threshold", ParamValue::Float(0.8))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "radius", ParamValue::Float(20.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "intensity", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::LensDistortion => {
                engine
                    .set_param(node_id, "distortion", ParamValue::Float(0.3))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "chromatic_aberration", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "scale", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::ExtractChannel => {
                engine
                    .set_param(node_id, "channel", ParamValue::Int(0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::ChromaKey => {
                engine
                    .set_param(node_id, "key_r", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "key_g", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "key_b", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "tolerance", ParamValue::Float(0.3))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "softness", ParamValue::Float(0.1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Despill => {
                engine
                    .set_param(node_id, "method", ParamValue::Int(0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "strength", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "key_r", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "key_g", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "key_b", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Crop => {
                engine
                    .set_param(node_id, "x", ParamValue::Int(100))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "y", ParamValue::Int(100))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "width", ParamValue::Int(512))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "height", ParamValue::Int(512))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Flip => {
                engine
                    .set_param(node_id, "horizontal", ParamValue::Bool(true))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "vertical", ParamValue::Bool(false))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Rotate => {
                engine
                    .set_param(node_id, "angle", ParamValue::Float(45.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "filter", ParamValue::Int(1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Translate => {
                engine
                    .set_param(node_id, "x", ParamValue::Int(100))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "y", ParamValue::Int(50))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Transform2D => {
                engine
                    .set_param(node_id, "translate_x", ParamValue::Float(50.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "translate_y", ParamValue::Float(30.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "rotate", ParamValue::Float(15.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "scale_x", ParamValue::Float(1.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "scale_y", ParamValue::Float(1.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "pivot_x", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "pivot_y", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "filter", ParamValue::Int(1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::Resize => {
                engine
                    .set_param(node_id, "width", ParamValue::Int(1024))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "height", ParamValue::Int(1024))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "filter", ParamValue::Int(1))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::MapRange => {
                engine
                    .set_param(node_id, "from_min", ParamValue::Float(0.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "from_max", ParamValue::Float(1.0))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "to_min", ParamValue::Float(0.2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "to_max", ParamValue::Float(0.8))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "clamp", ParamValue::Bool(true))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            Self::MathNode => {
                engine
                    .set_param(node_id, "operation", ParamValue::Int(2))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "value", ParamValue::Float(0.5))
                    .map_err(|e| e.to_string())?;
                engine
                    .set_param(node_id, "clamp_result", ParamValue::Bool(false))
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
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

    let (load_id, _) = engine
        .add_node("load_image_sequence", 0.0, 0.0)
        .map_err(|e| e.to_string())?;

    let process_id = if let Some(node_id) = node.node_id() {
        let (id, _) = engine
            .add_node(node_id, 200.0, 0.0)
            .map_err(|e| e.to_string())?;
        Some(id)
    } else {
        None
    };

    let (export_id, _) = engine
        .add_node("export_image_sequence", 400.0, 0.0)
        .map_err(|e| e.to_string())?;

    if let Some(process_id) = &process_id {
        engine
            .connect(&load_id, "image", process_id, "image")
            .map_err(|e| e.to_string())?;
        engine
            .connect(process_id, "image", &export_id, "image")
            .map_err(|e| e.to_string())?;
        node.configure_params(&mut engine, process_id)?;
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

    let cm = BuiltinColorManagement::new();
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
            let rgba8 = Viewer::image_to_rgba8(&image, &cm);
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
    let img = image::RgbaImage::from_raw(width, height, rgba8.to_vec())
        .ok_or_else(|| "Failed to create image buffer".to_string())?;
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode failed: {e}"))?;
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
