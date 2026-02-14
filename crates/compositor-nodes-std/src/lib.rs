use compositor_core::node::NodeRegistry;
use std::sync::Arc;

pub mod blend;
pub mod color;
pub mod color_convert;
pub mod color_ops;
pub mod filter;
pub mod filter_ops;
pub mod generate;
pub mod group;
pub mod input;
pub mod mask_utils;
pub mod matte;
pub mod output;
pub mod script;
pub mod transform;
pub mod utility;

pub use blend::{AlphaOver, Blend};
pub use color::{
    BrightnessContrast, ColorRampNode, CombineHsva, HueSaturation, Invert, SeparateHsva,
};
pub use color_convert::ColorConvert;
pub use color_ops::{ChannelShuffle, ColorBalance, Curves, Gamma, Levels, Posterize, Threshold};
pub use filter::GaussianBlur;
pub use filter_ops::{Dilate, EdgeDetect, Erode, Kuwahara, Median, Sharpen};
pub use generate::{
    Checkerboard, FloatConstant, Gradient, IntegerConstant, Noise, RasterizeField, SolidColor,
};
pub use group::{GroupInputNode, GroupNode, GroupOutputNode};
pub use input::{LoadImage, LoadImageSequence, SequenceInfo};
pub use matte::{ChromaKey, ExtractChannel, Premultiply, SetAlpha, Unpremultiply};
pub use output::{ExportImageSequence, Viewer};
pub use script::GpuScriptDraftNode;
pub use transform::{Crop, Flip, Resize, Rotate, Transform2D, Translate};
pub use utility::{MapRange, MathNode};

pub fn register_standard_nodes(registry: &mut NodeRegistry) {
    // Input/Output
    registry.register("load_image", || Arc::new(LoadImage::new()));
    registry.register("load_image_sequence", || Arc::new(LoadImageSequence::new()));
    registry.register("viewer", || Arc::new(Viewer::new()));

    // Color
    registry.register("color_convert", || Arc::new(ColorConvert::new()));
    registry.register(
        "brightness_contrast",
        || Arc::new(BrightnessContrast::new()),
    );
    registry.register("hue_saturation", || Arc::new(HueSaturation::new()));
    registry.register("invert", || Arc::new(Invert::new()));
    registry.register("levels", || Arc::new(Levels::new()));
    registry.register("curves", || Arc::new(Curves::new()));
    registry.register("color_balance", || Arc::new(ColorBalance::new()));
    registry.register("channel_shuffle", || Arc::new(ChannelShuffle::new()));
    registry.register("threshold", || Arc::new(Threshold::new()));
    registry.register("posterize", || Arc::new(Posterize::new()));
    registry.register("gamma", || Arc::new(Gamma::new()));
    registry.register("color_ramp", || Arc::new(ColorRampNode::new()));
    registry.register("separate_hsva", || Arc::new(SeparateHsva::new()));
    registry.register("combine_hsva", || Arc::new(CombineHsva::new()));

    registry.register("map_range", || Arc::new(MapRange::new()));
    registry.register("math", || Arc::new(MathNode::new()));

    // Filter
    registry.register("gaussian_blur", || Arc::new(GaussianBlur::new()));
    registry.register("sharpen", || Arc::new(Sharpen::new()));
    registry.register("edge_detect", || Arc::new(EdgeDetect::new()));
    registry.register("dilate", || Arc::new(Dilate::new()));
    registry.register("erode", || Arc::new(Erode::new()));
    registry.register("median", || Arc::new(Median::new()));
    registry.register("kuwahara", || Arc::new(Kuwahara::new()));

    // Composite
    registry.register("blend", || Arc::new(Blend::new()));
    registry.register("alpha_over", || Arc::new(AlphaOver::new()));

    // Transform
    registry.register("resize", || Arc::new(Resize::new()));
    registry.register("crop", || Arc::new(Crop::new()));
    registry.register("flip", || Arc::new(Flip::new()));
    registry.register("rotate", || Arc::new(Rotate::new()));
    registry.register("translate", || Arc::new(Translate::new()));
    registry.register("transform_2d", || Arc::new(Transform2D::new()));

    // Generator
    registry.register("solid_color", || Arc::new(SolidColor::new()));
    registry.register("noise", || Arc::new(Noise::new()));
    registry.register("gradient", || Arc::new(Gradient::new()));
    registry.register("checkerboard", || Arc::new(Checkerboard::new()));
    registry.register("rasterize_field", || Arc::new(RasterizeField::new()));
    registry.register("float_constant", || Arc::new(FloatConstant::new()));
    registry.register("integer_constant", || Arc::new(IntegerConstant::new()));

    // Matte
    registry.register("premultiply", || Arc::new(Premultiply::new()));
    registry.register("unpremultiply", || Arc::new(Unpremultiply::new()));
    registry.register("set_alpha", || Arc::new(SetAlpha::new()));
    registry.register("extract_channel", || Arc::new(ExtractChannel::new()));
    registry.register("chroma_key", || Arc::new(ChromaKey::new()));
    registry.register("despill", || Arc::new(Despill::new()));
    registry.register("shape", || Arc::new(Shape::new()));
    registry.register("white_balance", || Arc::new(WhiteBalance::new()));
    registry.register("vibrance", || Arc::new(Vibrance::new()));
    registry.register("vignette", || Arc::new(Vignette::new()));
    registry.register("glow", || Arc::new(Glow::new()));
    registry.register("gradient_map", || Arc::new(GradientMap::new()));
    registry.register("tone_map", || Arc::new(ToneMap::new()));
    registry.register("lens_distortion", || Arc::new(LensDistortion::new()));
    registry.register("export_image", || Arc::new(ExportImage::new()));
    registry.register("export_image_sequence", || {
        Arc::new(ExportImageSequence::new())
    });

    registry.register("gpu_script", || {
        Arc::new(GpuScriptDraftNode::new("gpu_script"))
    });
}

pub use color_ops::{GradientMap, ToneMap, Vibrance, WhiteBalance};
pub use filter_ops::{Glow, LensDistortion, Vignette};
pub use generate::Shape;
pub use matte::Despill;
pub use output::ExportImage;
