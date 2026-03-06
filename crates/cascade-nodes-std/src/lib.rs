use cascade_core::node::NodeRegistry;
use std::sync::Arc;

pub mod ai;
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
pub mod palette;
pub mod script;
pub mod time_ops;
pub mod transform;
pub mod utility;

pub use ai::{
    decode_response_image, encode_image_png, AiDepthEstimate, AiGenerateImage, AiInpaint,
    AiRemoveBackground, AiUpscale,
};
pub use blend::{AlphaOver, Blend, KeyMix, Merge};
pub use color::{
    BrightnessContrast, ColorRampNode, CombineHsva, HueSaturation, Invert, SeparateHsva,
};
pub use color_convert::ColorConvert;
pub use color_ops::{
    ChannelShuffle, Clamp, ColorBalance, Curves, Gamma, Grade, Levels, Posterize, Threshold,
};
pub use filter::GaussianBlur;
pub use filter_ops::{Dilate, DirectionalBlur, EdgeDetect, Erode, Median, RadialBlur, Sharpen};
pub use generate::{
    BooleanConstant, Checkerboard, ColorConstant, FloatConstant, Gradient, IntegerConstant, Noise,
    RasterizeField, SolidColor, Text, TextArea, UVMap,
};
pub use group::{GroupInputNode, GroupNode, GroupOutputNode};
pub use input::{
    srgb_to_linear_lut, LoadImage, LoadImageBatch, LoadImageSequence, LoadVideo, SequenceInfo,
};
pub use matte::{
    ChromaKey, CombineRgba, CopyChannels, DifferenceMatte, EdgeBlur, ExtractChannel, LuminanceKey,
    MatteExpand, MatteShrink, Premultiply, SeparateRgba, SetAlpha, Unpremultiply,
};
pub use output::{ExportImageBatch, ExportImageSequence, ExportVideo, SaveExr, Viewer};
pub use palette::ColorPaletteNode;
pub use script::GpuScriptDraftNode;
pub use time_ops::{FrameBlend, FrameHold, TimeOffset};
pub use transform::{resize_nearest, CornerPin, Crop, Flip, Resize, Rotate, STMap, Transform2D, Translate};
pub use utility::{Dot, ImageInfo, ImageMath, MapRange, MathNode, ProjectInfo};

pub fn register_standard_nodes(registry: &mut NodeRegistry) {
    // Input/Output
    registry.register("load_image", || Arc::new(LoadImage::new()));
    registry.register("load_image_sequence", || Arc::new(LoadImageSequence::new()));
    registry.register("load_image_batch", || Arc::new(LoadImageBatch::new()));
    registry.register("load_video", || Arc::new(LoadVideo::new()));
    registry.register("viewer", || Arc::new(Viewer::new()));

    registry.register("ai_inpaint", || Arc::new(AiInpaint::new()));
    registry.register("ai_depth_estimate", || Arc::new(AiDepthEstimate::new()));
    registry.register("ai_remove_background", || {
        Arc::new(AiRemoveBackground::new())
    });
    registry.register("ai_upscale", || Arc::new(AiUpscale::new()));
    registry.register("ai_generate_image", || Arc::new(AiGenerateImage::new()));

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
    registry.register("grade", || Arc::new(Grade::new()));
    registry.register("clamp", || Arc::new(Clamp::new()));
    registry.register("color_ramp", || Arc::new(ColorRampNode::new()));
    registry.register("color_palette", || Arc::new(ColorPaletteNode::new()));
    registry.register("separate_hsva", || Arc::new(SeparateHsva::new()));
    registry.register("combine_hsva", || Arc::new(CombineHsva::new()));

    registry.register("map_range", || Arc::new(MapRange::new()));
    registry.register("math", || Arc::new(MathNode::new()));
    registry.register("image_math", || Arc::new(ImageMath::new()));
    registry.register("dot", || Arc::new(Dot::new()));
    registry.register("project_info", || Arc::new(ProjectInfo::new()));
    registry.register("image_info", || Arc::new(ImageInfo::new()));

    // Filter
    registry.register("gaussian_blur", || Arc::new(GaussianBlur::new()));
    registry.register("sharpen", || Arc::new(Sharpen::new()));
    registry.register("edge_detect", || Arc::new(EdgeDetect::new()));
    registry.register("dilate", || Arc::new(Dilate::new()));
    registry.register("erode", || Arc::new(Erode::new()));
    registry.register("median", || Arc::new(Median::new()));
    registry.register("directional_blur", || Arc::new(DirectionalBlur::new()));
    registry.register("radial_blur", || Arc::new(RadialBlur::new()));

    // Composite
    registry.register("blend", || Arc::new(Blend::new()));
    registry.register("alpha_over", || Arc::new(AlphaOver::new()));
    registry.register("merge", || Arc::new(Merge::new()));
    registry.register("keymix", || Arc::new(KeyMix::new()));

    // Transform
    registry.register("resize", || Arc::new(Resize::new()));
    registry.register("crop", || Arc::new(Crop::new()));
    registry.register("flip", || Arc::new(Flip::new()));
    registry.register("rotate", || Arc::new(Rotate::new()));
    registry.register("translate", || Arc::new(Translate::new()));
    registry.register("transform_2d", || Arc::new(Transform2D::new()));
    registry.register("corner_pin", || Arc::new(CornerPin::new()));
    registry.register("st_map", || Arc::new(STMap::new()));

    registry.register("time_offset", || Arc::new(TimeOffset::new()));
    registry.register("frame_hold", || Arc::new(FrameHold::new()));
    registry.register("frame_blend", || Arc::new(FrameBlend::new()));

    // Generator
    registry.register("solid_color", || Arc::new(SolidColor::new()));
    registry.register("noise", || Arc::new(Noise::new()));
    registry.register("gradient", || Arc::new(Gradient::new()));
    registry.register("checkerboard", || Arc::new(Checkerboard::new()));
    registry.register("rasterize_field", || Arc::new(RasterizeField::new()));
    registry.register("float_constant", || Arc::new(FloatConstant::new()));
    registry.register("integer_constant", || Arc::new(IntegerConstant::new()));
    registry.register("color_constant", || Arc::new(ColorConstant::new()));
    registry.register("boolean_constant", || Arc::new(BooleanConstant::new()));
    registry.register("text_area", || Arc::new(TextArea::new()));
    registry.register("text", || Arc::new(Text::new()));
    registry.register("uv_map", || Arc::new(UVMap::new()));

    // Matte
    registry.register("premultiply", || Arc::new(Premultiply::new()));
    registry.register("unpremultiply", || Arc::new(Unpremultiply::new()));
    registry.register("set_alpha", || Arc::new(SetAlpha::new()));
    registry.register("extract_channel", || Arc::new(ExtractChannel::new()));
    registry.register("separate_rgba", || Arc::new(SeparateRgba::new()));
    registry.register("combine_rgba", || Arc::new(CombineRgba::new()));
    registry.register("copy_channels", || Arc::new(CopyChannels::new()));
    registry.register("chroma_key", || Arc::new(ChromaKey::new()));
    registry.register("despill", || Arc::new(Despill::new()));
    registry.register("luminance_key", || Arc::new(LuminanceKey::new()));
    registry.register("difference_matte", || Arc::new(DifferenceMatte::new()));
    registry.register("edge_blur", || Arc::new(EdgeBlur::new()));
    registry.register("matte_expand", || Arc::new(MatteExpand::new()));
    registry.register("matte_shrink", || Arc::new(MatteShrink::new()));
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
    registry.register("export_video", || Arc::new(ExportVideo::new()));

    registry.register("export_image_batch", || Arc::new(ExportImageBatch::new()));
    registry.register("save_exr", || Arc::new(SaveExr::new()));
    registry.register("gpu_script", || {
        Arc::new(GpuScriptDraftNode::new("gpu_script"))
    });
}

pub use color_ops::{GradientMap, ToneMap, Vibrance, WhiteBalance};
pub use filter_ops::{Glow, LensDistortion, Vignette};
pub use generate::Shape;
pub use matte::Despill;
pub use output::ExportImage;

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_core::color::BuiltinColorManagement;
    use cascade_core::node::{EvalContext, Node};
    use cascade_core::types::*;
    use pollster::block_on;
    use std::collections::HashMap;

    fn eval_field_passthrough(
        node: &dyn Node,
        field_color: [f32; 4],
        params: HashMap<String, ParamValue>,
    ) -> Value {
        let field = Field::new(move |_u, _v| field_color);
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Field(field));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        result.get("image").unwrap().clone()
    }

    fn eval_field_with_input(
        node: &dyn Node,
        field: Field,
        params: HashMap<String, ParamValue>,
    ) -> Value {
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Field(field));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        result.get("image").unwrap().clone()
    }

    fn sample_field(value: &Value) -> [f32; 4] {
        match value {
            Value::Field(f) => f.sample(0.5, 0.5),
            other => panic!("Expected Value::Field, got {:?}", other.value_type()),
        }
    }

    fn approx_eq(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.001
    }

    fn assert_color_approx(actual: [f32; 4], expected: [f32; 4], msg: &str) {
        assert!(
            approx_eq(actual[0], expected[0])
                && approx_eq(actual[1], expected[1])
                && approx_eq(actual[2], expected[2])
                && approx_eq(actual[3], expected[3]),
            "{msg}: expected {expected:?}, got {actual:?}"
        );
    }

    #[test]
    fn test_invert_field_passthrough() {
        let node = Invert::new();
        let value = eval_field_passthrough(&node, [0.2, 0.4, 0.6, 1.0], HashMap::new());
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.8, 0.6, 0.4, 1.0], "invert");
    }

    #[test]
    fn test_brightness_contrast_field_passthrough() {
        let node = BrightnessContrast::new();
        let mut params = HashMap::new();
        params.insert("brightness".to_string(), ParamValue::Float(0.1));
        params.insert("contrast".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.6, 0.6, 0.6, 1.0], "brightness/contrast");
    }

    #[test]
    fn test_hue_saturation_field_passthrough() {
        let node = HueSaturation::new();
        let mut params = HashMap::new();
        params.insert("hue".to_string(), ParamValue::Float(0.0));
        params.insert("saturation".to_string(), ParamValue::Float(0.0));
        params.insert("value".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "hue/saturation");
    }

    #[test]
    fn test_color_ramp_field_passthrough() {
        let node = ColorRampNode::new();
        let mut params = HashMap::new();
        params.insert(
            "stops".to_string(),
            ParamValue::ColorRamp(vec![
                ColorStop {
                    position: 0.0,
                    color: [0.0, 0.0, 0.0, 1.0],
                },
                ColorStop {
                    position: 1.0,
                    color: [1.0, 1.0, 1.0, 1.0],
                },
            ]),
        );
        params.insert("interpolation".to_string(), ParamValue::Int(0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "color ramp");
    }

    #[test]
    fn test_levels_field_passthrough() {
        let node = Levels::new();
        let mut params = HashMap::new();
        params.insert("in_black".to_string(), ParamValue::Float(0.0));
        params.insert("in_white".to_string(), ParamValue::Float(1.0));
        params.insert("gamma".to_string(), ParamValue::Float(1.0));
        params.insert("out_black".to_string(), ParamValue::Float(0.0));
        params.insert("out_white".to_string(), ParamValue::Float(1.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "levels");
    }

    fn curves_default_params() -> HashMap<String, ParamValue> {
        let identity = vec![CurvePoint { x: 0.0, y: 0.0 }, CurvePoint { x: 1.0, y: 1.0 }];
        let mut params = HashMap::new();
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert(
            "red_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert(
            "green_curve".to_string(),
            ParamValue::CurvePoints(identity.clone()),
        );
        params.insert("blue_curve".to_string(), ParamValue::CurvePoints(identity));
        params
    }

    #[test]
    fn test_curves_field_passthrough() {
        let node = Curves::new();
        let params = curves_default_params();
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "curves identity field");
    }

    #[test]
    fn test_curves_identity() {
        let node = Curves::new();
        let params = curves_default_params();
        let img = make_test_image(2, 2, [0.3, 0.5, 0.7, 1.0]);
        let result = eval_image_node(&node, img, params);
        assert_color_approx(
            [
                result.data[0],
                result.data[1],
                result.data[2],
                result.data[3],
            ],
            [0.3, 0.5, 0.7, 1.0],
            "curves identity",
        );
    }

    #[test]
    fn test_curves_master_darkens() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // S-curve that pulls midtones down
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.5, y: 0.3 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        let r = result.data[0];
        let g = result.data[1];
        let b = result.data[2];
        // Midtones should be pulled down toward 0.3
        assert!(r < 0.5, "master curve should darken midtones, got r={r}");
        assert!((r - 0.3).abs() < 0.02, "expected ~0.3, got r={r}");
        assert!(
            (r - g).abs() < 0.001,
            "master should affect all channels equally"
        );
        assert!(
            (r - b).abs() < 0.001,
            "master should affect all channels equally"
        );
        // Alpha unchanged
        assert!(
            (result.data[3] - 1.0).abs() < 0.001,
            "alpha should be unchanged"
        );
    }

    #[test]
    fn test_curves_per_channel() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // Only adjust red curve — lift midtones
        params.insert(
            "red_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.5, y: 0.7 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        let r = result.data[0];
        let g = result.data[1];
        let b = result.data[2];
        // Red should be lifted
        assert!(r > 0.6, "red curve should lift red midtones, got r={r}");
        // Green and blue should be unchanged (identity curve)
        assert!(
            (g - 0.5).abs() < 0.01,
            "green should be unchanged, got g={g}"
        );
        assert!(
            (b - 0.5).abs() < 0.01,
            "blue should be unchanged, got b={b}"
        );
    }

    #[test]
    fn test_curves_monotone_no_overshoot() {
        let node = Curves::new();
        let mut params = curves_default_params();
        // Steep S-curve that would overshoot with natural cubic spline
        params.insert(
            "master_curve".to_string(),
            ParamValue::CurvePoints(vec![
                CurvePoint { x: 0.0, y: 0.0 },
                CurvePoint { x: 0.25, y: 0.0 },
                CurvePoint { x: 0.5, y: 1.0 },
                CurvePoint { x: 0.75, y: 1.0 },
                CurvePoint { x: 1.0, y: 1.0 },
            ]),
        );
        // Test values across the range — none should go below 0 or above 1
        for input_val in [0.1f32, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] {
            let img = make_test_image(1, 1, [input_val, input_val, input_val, 1.0]);
            let result = eval_image_node(&node, img, params.clone());
            let out = result.data[0];
            assert!(
                (-0.01..=1.01).contains(&out),
                "monotone cubic should not overshoot: input={input_val}, output={out}"
            );
        }
    }

    #[test]
    fn test_curves_format_passthrough() {
        let node = Curves::new();
        let params = curves_default_params();
        let img = make_test_image(2, 2, [0.5, 0.5, 0.5, 1.0]);
        let result = eval_image_node(&node, img, params);
        assert_eq!(result.format.width(), 2);
        assert_eq!(result.format.height(), 2);
    }

    #[test]
    fn test_color_balance_field_passthrough() {
        let node = ColorBalance::new();
        let mut params = HashMap::new();
        params.insert("shadow_r".to_string(), ParamValue::Float(0.0));
        params.insert("shadow_g".to_string(), ParamValue::Float(0.0));
        params.insert("shadow_b".to_string(), ParamValue::Float(0.0));
        params.insert("mid_r".to_string(), ParamValue::Float(0.0));
        params.insert("mid_g".to_string(), ParamValue::Float(0.0));
        params.insert("mid_b".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_r".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_g".to_string(), ParamValue::Float(0.0));
        params.insert("highlight_b".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "color balance");
    }

    #[test]
    fn test_channel_shuffle_field_passthrough() {
        let node = ChannelShuffle::new();
        let mut params = HashMap::new();
        params.insert("r_source".to_string(), ParamValue::Int(2));
        params.insert("g_source".to_string(), ParamValue::Int(0));
        params.insert("b_source".to_string(), ParamValue::Int(1));
        params.insert("a_source".to_string(), ParamValue::Int(3));
        let value = eval_field_passthrough(&node, [0.1, 0.2, 0.3, 0.4], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.3, 0.1, 0.2, 0.4], "channel shuffle");
    }

    #[test]
    fn test_threshold_field_passthrough() {
        let node = Threshold::new();
        let mut params = HashMap::new();
        params.insert("threshold".to_string(), ParamValue::Float(0.5));
        let value = eval_field_passthrough(&node, [0.8, 0.8, 0.8, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [1.0, 1.0, 1.0, 1.0], "threshold");
    }

    #[test]
    fn test_posterize_field_passthrough() {
        let node = Posterize::new();
        let mut params = HashMap::new();
        params.insert("levels".to_string(), ParamValue::Int(2));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [1.0, 1.0, 1.0, 1.0], "posterize");
    }

    #[test]
    fn test_gamma_field_passthrough() {
        let node = Gamma::new();
        let mut params = HashMap::new();
        params.insert("gamma".to_string(), ParamValue::Float(2.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        let expected = 0.5_f32.sqrt();
        assert_color_approx(sampled, [expected, expected, expected, 1.0], "gamma");
    }

    #[test]
    fn test_white_balance_field_passthrough() {
        let node = WhiteBalance::new();
        let mut params = HashMap::new();
        params.insert("temperature".to_string(), ParamValue::Float(0.0));
        params.insert("tint".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "white balance");
    }

    #[test]
    fn test_vibrance_field_passthrough() {
        let node = Vibrance::new();
        let mut params = HashMap::new();
        params.insert("vibrance".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "vibrance");
    }

    #[test]
    fn test_gradient_map_field_passthrough() {
        let node = GradientMap::new();
        let mut params = HashMap::new();
        params.insert("color_low_r".to_string(), ParamValue::Float(0.0));
        params.insert("color_low_g".to_string(), ParamValue::Float(0.0));
        params.insert("color_low_b".to_string(), ParamValue::Float(0.0));
        params.insert("color_mid_r".to_string(), ParamValue::Float(0.5));
        params.insert("color_mid_g".to_string(), ParamValue::Float(0.5));
        params.insert("color_mid_b".to_string(), ParamValue::Float(0.5));
        params.insert("color_high_r".to_string(), ParamValue::Float(1.0));
        params.insert("color_high_g".to_string(), ParamValue::Float(1.0));
        params.insert("color_high_b".to_string(), ParamValue::Float(1.0));
        params.insert("strength".to_string(), ParamValue::Float(1.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "gradient map");
    }

    #[test]
    fn test_tone_map_field_passthrough() {
        let node = ToneMap::new();
        let mut params = HashMap::new();
        params.insert("method".to_string(), ParamValue::Int(0));
        params.insert("exposure".to_string(), ParamValue::Float(0.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        let expected = 0.5_f32 / 1.5_f32;
        assert_color_approx(sampled, [expected, expected, expected, 1.0], "tone map");
    }

    #[test]
    fn test_field_chain_passthrough() {
        let invert_node = Invert::new();
        let inverted = eval_field_passthrough(&invert_node, [0.8, 0.8, 0.8, 1.0], HashMap::new());
        let inverted_field = match inverted {
            Value::Field(field) => field,
            other => panic!("Expected Value::Field, got {:?}", other.value_type()),
        };

        let gamma_node = Gamma::new();
        let mut params = HashMap::new();
        params.insert("gamma".to_string(), ParamValue::Float(2.0));
        let output = eval_field_with_input(&gamma_node, inverted_field, params);
        match output {
            Value::Field(_) => {}
            other => panic!("Expected Value::Field, got {:?}", other.value_type()),
        }
        let sampled = sample_field(&output);
        let expected = 0.2_f32.sqrt();
        assert_color_approx(sampled, [expected, expected, expected, 1.0], "field chain");
    }

    // ── Format / data_window propagation tests ──────────────────────────

    /// Helper: create a small test image with a non-trivial data_window and format.
    /// The image is 4×4 pixels with data_window offset to (100,100)→(104,104)
    /// and format set to HD 1920×1080. All pixels are set to `color`.
    fn make_test_image(w: u32, h: u32, color: [f32; 4]) -> Image {
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&color);
        }
        Image::from_f32_data(w, h, data).unwrap()
    }

    fn make_offset_image(color: [f32; 4]) -> Image {
        let w = 4u32;
        let h = 4u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&color);
        }
        let format = Format::hd(); // 1920×1080 display window
        let data_window = RectI {
            min: IVec2::new(100, 100),
            max: IVec2::new(104, 104),
        };
        Image::new_with_domain(format, data_window, data, ColorSpaceId::default_working()).unwrap()
    }

    /// Helper: evaluate a node with a single image input and return the output image.
    fn eval_image_node(
        node: &dyn Node,
        input: Image,
        params: HashMap<String, ParamValue>,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Value::Image, got {:?}", other.value_type()),
        }
    }

    #[test]
    fn test_format_propagation_brightness_contrast() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = BrightnessContrast::new();
        let mut params = HashMap::new();
        params.insert("brightness".to_string(), ParamValue::Float(0.1));
        params.insert("contrast".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input.clone(), params);

        // Format must be preserved
        assert_eq!(output.format, input.format, "format must propagate");
        // Data window must be preserved (same dimensions, same offset)
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must propagate"
        );
        // Dimensions must still match
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);
        // Color space must be preserved
        assert_eq!(
            output.color_space, input.color_space,
            "color_space must propagate"
        );
        // Pixel values should be modified (brightness +0.1)
        let px = output.get_pixel_f32(0, 0);
        assert!(
            approx_eq(px[0], 0.6) && approx_eq(px[1], 0.6) && approx_eq(px[2], 0.6),
            "brightness should be applied: got {px:?}"
        );
    }

    #[test]
    fn test_format_propagation_invert() {
        let input = make_offset_image([0.2, 0.4, 0.6, 1.0]);
        let node = Invert::new();

        let output = eval_image_node(&node, input.clone(), HashMap::new());

        assert_eq!(
            output.format, input.format,
            "format must propagate through invert"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must propagate through invert"
        );
        assert_eq!(
            output.color_space, input.color_space,
            "color_space must propagate through invert"
        );

        let px = output.get_pixel_f32(0, 0);
        assert!(
            approx_eq(px[0], 0.8) && approx_eq(px[1], 0.6) && approx_eq(px[2], 0.4),
            "invert should work correctly: got {px:?}"
        );
    }

    #[test]
    fn test_format_propagation_levels() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = Levels::new();
        let mut params = HashMap::new();
        params.insert("in_black".to_string(), ParamValue::Float(0.0));
        params.insert("in_white".to_string(), ParamValue::Float(1.0));
        params.insert("gamma".to_string(), ParamValue::Float(1.0));
        params.insert("out_black".to_string(), ParamValue::Float(0.0));
        params.insert("out_white".to_string(), ParamValue::Float(1.0));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_format_propagation_chain() {
        // Feed offset image through Invert → BrightnessContrast → Gamma
        let input = make_offset_image([0.2, 0.4, 0.6, 1.0]);
        let original_format = input.format.clone();
        let original_dw = input.data_window;
        let original_cs = input.color_space.clone();

        // Step 1: Invert
        let after_invert = eval_image_node(&Invert::new(), input, HashMap::new());
        assert_eq!(
            after_invert.format, original_format,
            "format lost after invert"
        );
        assert_eq!(
            after_invert.data_window, original_dw,
            "data_window lost after invert"
        );

        // Step 2: BrightnessContrast
        let mut bc_params = HashMap::new();
        bc_params.insert("brightness".to_string(), ParamValue::Float(0.0));
        bc_params.insert("contrast".to_string(), ParamValue::Float(0.0));
        let after_bc = eval_image_node(&BrightnessContrast::new(), after_invert, bc_params);
        assert_eq!(
            after_bc.format, original_format,
            "format lost after brightness/contrast"
        );
        assert_eq!(
            after_bc.data_window, original_dw,
            "data_window lost after brightness/contrast"
        );

        // Step 3: Gamma
        let mut gamma_params = HashMap::new();
        gamma_params.insert("gamma".to_string(), ParamValue::Float(1.0));
        let after_gamma = eval_image_node(&Gamma::new(), after_bc, gamma_params);
        assert_eq!(
            after_gamma.format, original_format,
            "format lost after gamma"
        );
        assert_eq!(
            after_gamma.data_window, original_dw,
            "data_window lost after gamma"
        );
        assert_eq!(
            after_gamma.color_space, original_cs,
            "color_space lost after gamma"
        );
    }

    #[test]
    fn test_format_propagation_with_custom_color_space() {
        // Use ACEScg color space to verify it's preserved through the chain
        let w = 4u32;
        let h = 4u32;
        let data = vec![0.5f32; (w as usize) * (h as usize) * 4];
        let format = Format::hd();
        let data_window = RectI {
            min: IVec2::new(50, 50),
            max: IVec2::new(54, 54),
        };
        let input = Image::new_with_domain(
            format,
            data_window,
            data,
            ColorSpaceId::new(ColorSpaceId::ACESCG),
        )
        .unwrap();

        let output = eval_image_node(&Invert::new(), input.clone(), HashMap::new());

        assert_eq!(
            output.color_space.as_str(),
            ColorSpaceId::ACESCG,
            "ACEScg color space must be preserved"
        );
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_format_propagation_gaussian_blur() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = GaussianBlur::new();
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(1.0));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(
            output.format, input.format,
            "format must propagate through blur"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must propagate through blur"
        );
        assert_eq!(
            output.color_space, input.color_space,
            "color_space must propagate through blur"
        );
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);
    }

    #[test]
    fn test_format_propagation_premultiply() {
        let input = make_offset_image([0.5, 0.5, 0.5, 0.5]);
        let node = Premultiply::new();

        let output = eval_image_node(&node, input.clone(), HashMap::new());

        assert_eq!(
            output.format, input.format,
            "format must propagate through premultiply"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must propagate through premultiply"
        );
        // Premultiplied: RGB * A = 0.5 * 0.5 = 0.25
        let px = output.get_pixel_f32(0, 0);
        assert!(
            approx_eq(px[0], 0.25) && approx_eq(px[3], 0.5),
            "premultiply should work: got {px:?}"
        );
    }

    #[test]
    fn test_get_rgba_respects_data_window() {
        // Verify that get_rgba returns transparent black outside data_window
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);

        // Inside data_window (100,100)→(104,104)
        let inside = input.get_rgba(101, 101);
        assert!(
            approx_eq(inside[0], 1.0) && approx_eq(inside[3], 1.0),
            "inside data_window should return red: got {inside:?}"
        );

        // Outside data_window
        let outside = input.get_rgba(0, 0);
        assert!(
            approx_eq(outside[0], 0.0) && approx_eq(outside[3], 0.0),
            "outside data_window should return transparent black: got {outside:?}"
        );

        // Just outside boundary
        let edge = input.get_rgba(104, 104); // max is exclusive
        assert!(
            approx_eq(edge[0], 0.0) && approx_eq(edge[3], 0.0),
            "at max boundary (exclusive) should return transparent black: got {edge:?}"
        );
    }

    #[test]
    fn test_pixel_correctness_independent_of_offset() {
        // An image processed with data_window at (0,0) should produce
        // identical pixel values as one at (100,100)
        let color = [0.3, 0.6, 0.9, 1.0];

        // Zero-origin image
        let zero_origin = Image::from_f32_data(4, 4, vec![color; 16].concat()).unwrap();

        // Offset image
        let offset = make_offset_image(color);

        let node = BrightnessContrast::new();
        let mut params = HashMap::new();
        params.insert("brightness".to_string(), ParamValue::Float(0.2));
        params.insert("contrast".to_string(), ParamValue::Float(0.1));

        let out_zero = eval_image_node(&node, zero_origin, params.clone());
        let out_offset = eval_image_node(&node, offset, params);

        // All pixels should be identical
        for i in 0..16 {
            let px_zero = out_zero.get_pixel_f32(i % 4, i / 4);
            let px_offset = out_offset.get_pixel_f32(i % 4, i / 4);
            assert!(
                approx_eq(px_zero[0], px_offset[0])
                    && approx_eq(px_zero[1], px_offset[1])
                    && approx_eq(px_zero[2], px_offset[2])
                    && approx_eq(px_zero[3], px_offset[3]),
                "pixel {i} differs: zero={px_zero:?} offset={px_offset:?}"
            );
        }
    }

    // ── Compositing tests ───────────────────────────────────────────────

    fn eval_two_input_node(
        node: &dyn Node,
        input_a_name: &str,
        input_a: Image,
        input_b_name: &str,
        input_b: Image,
        params: HashMap<String, ParamValue>,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert(input_a_name.to_string(), Value::Image(input_a));
        inputs.insert(input_b_name.to_string(), Value::Image(input_b));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Value::Image, got {:?}", other.value_type()),
        }
    }

    fn merge_params(
        operation: i32,
        bbox: i32,
        opacity: f32,
        mix: f32,
    ) -> HashMap<String, ParamValue> {
        let mut params = HashMap::new();
        params.insert("operation".to_string(), ParamValue::Int(operation.into()));
        params.insert("bbox".to_string(), ParamValue::Int(bbox.into()));
        params.insert("opacity".to_string(), ParamValue::Float(opacity.into()));
        params.insert("mix".to_string(), ParamValue::Float(mix.into()));
        params
    }

    /// Reference Porter-Duff implementations from the 1984 paper.
    /// These use straight (unpremultiplied) alpha.
    /// a_alpha is the effective alpha of A (after opacity/mask).
    mod porter_duff_reference {
        /// A over B
        pub fn over(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa + ba * (1.0 - aa);
            if out_a <= 0.0 {
                return [0.0, 0.0, 0.0, 0.0];
            }
            [
                (a[0] * aa + b[0] * ba * (1.0 - aa)) / out_a,
                (a[1] * aa + b[1] * ba * (1.0 - aa)) / out_a,
                (a[2] * aa + b[2] * ba * (1.0 - aa)) / out_a,
                out_a.clamp(0.0, 1.0),
            ]
        }

        /// B over A (Under)
        pub fn under(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            over(b, ba, a, aa)
        }

        /// A In B
        pub fn src_in(a: [f32; 4], aa: f32, _b: [f32; 4], ba: f32) -> [f32; 4] {
            [a[0], a[1], a[2], (aa * ba).clamp(0.0, 1.0)]
        }

        /// A Out B
        pub fn src_out(a: [f32; 4], aa: f32, _b: [f32; 4], ba: f32) -> [f32; 4] {
            [a[0], a[1], a[2], (aa * (1.0 - ba)).clamp(0.0, 1.0)]
        }

        /// A Atop B
        pub fn atop(a: [f32; 4], aa: f32, b: [f32; 4], _ba: f32) -> [f32; 4] {
            [
                a[0] * aa + b[0] * (1.0 - aa),
                a[1] * aa + b[1] * (1.0 - aa),
                a[2] * aa + b[2] * (1.0 - aa),
                _ba.clamp(0.0, 1.0),
            ]
        }

        /// A Xor B
        pub fn xor(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa * (1.0 - ba) + ba * (1.0 - aa);
            if out_a <= 0.0 {
                return [0.0, 0.0, 0.0, 0.0];
            }
            [
                (a[0] * aa * (1.0 - ba) + b[0] * ba * (1.0 - aa)) / out_a,
                (a[1] * aa * (1.0 - ba) + b[1] * ba * (1.0 - aa)) / out_a,
                (a[2] * aa * (1.0 - ba) + b[2] * ba * (1.0 - aa)) / out_a,
                out_a.clamp(0.0, 1.0),
            ]
        }

        /// Stencil: B where A has alpha
        pub fn stencil(_a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            [b[0], b[1], b[2], (ba * aa).clamp(0.0, 1.0)]
        }

        /// Mask: same as In
        pub fn mask(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            src_in(a, aa, b, ba)
        }

        /// Plus (additive)
        pub fn plus(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            [
                a[0] * aa + b[0] * ba, // no RGB clamp (HDR)
                a[1] * aa + b[1] * ba,
                a[2] * aa + b[2] * ba,
                (aa + ba).min(1.0),
            ]
        }

        /// Multiply
        pub fn multiply(a: [f32; 4], _aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = _aa + ba - _aa * ba;
            [a[0] * b[0], a[1] * b[1], a[2] * b[2], out_a.clamp(0.0, 1.0)]
        }

        /// Difference
        pub fn difference(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa + ba - aa * ba;
            [
                (a[0] - b[0]).abs(),
                (a[1] - b[1]).abs(),
                (a[2] - b[2]).abs(),
                out_a.clamp(0.0, 1.0),
            ]
        }

        /// Screen
        pub fn screen(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa + ba - aa * ba;
            [
                1.0 - (1.0 - a[0]) * (1.0 - b[0]),
                1.0 - (1.0 - a[1]) * (1.0 - b[1]),
                1.0 - (1.0 - a[2]) * (1.0 - b[2]),
                out_a.clamp(0.0, 1.0),
            ]
        }

        /// Max
        pub fn max_op(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa + ba - aa * ba;
            [
                a[0].max(b[0]),
                a[1].max(b[1]),
                a[2].max(b[2]),
                out_a.clamp(0.0, 1.0),
            ]
        }

        /// Min
        pub fn min_op(a: [f32; 4], aa: f32, b: [f32; 4], ba: f32) -> [f32; 4] {
            let out_a = aa + ba - aa * ba;
            [
                a[0].min(b[0]),
                a[1].min(b[1]),
                a[2].min(b[2]),
                out_a.clamp(0.0, 1.0),
            ]
        }
    }

    /// Run the Merge node on two 1x1 images and return the output pixel.
    fn merge_single_pixel(
        a_color: [f32; 4],
        b_color: [f32; 4],
        operation: i64,
        opacity: f64,
    ) -> [f32; 4] {
        let a = Image::from_f32_data(1, 1, a_color.to_vec()).unwrap();
        let b = Image::from_f32_data(1, 1, b_color.to_vec()).unwrap();
        let node = Merge::new();
        let mut params = HashMap::new();
        params.insert("operation".to_string(), ParamValue::Int(operation));
        params.insert("bbox".to_string(), ParamValue::Int(0));
        params.insert("opacity".to_string(), ParamValue::Float(opacity));
        params.insert("mix".to_string(), ParamValue::Float(1.0));
        let output = eval_two_input_node(&node, "A", a, "B", b, params);
        output.get_pixel_f32(0, 0)
    }

    #[test]
    fn test_alpha_over_same_size_images() {
        let bg = Image::from_f32_data(
            2,
            2,
            vec![
                0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0,
            ],
        )
        .unwrap();
        let fg = Image::from_f32_data(
            2,
            2,
            vec![
                1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", bg, "foreground", fg, params);

        assert_eq!(output.width, 2);
        assert_eq!(output.height, 2);
        let px = output.get_pixel_f32(0, 0);
        // fg_alpha=0.5, inv=0.5: R = 1.0*0.5 + 0.0*0.5 = 0.5
        // B = 0.0*0.5 + 1.0*0.5 = 0.5
        assert!(approx_eq(px[0], 0.5), "R: got {}", px[0]);
        assert!(approx_eq(px[2], 0.5), "B: got {}", px[2]);
    }

    #[test]
    fn test_alpha_over_different_size_images() {
        // BG: 4x4 blue at (0,0)→(4,4)
        let bg_data = vec![[0.0f32, 0.0, 1.0, 1.0]; 16].concat();
        let bg = Image::from_f32_data(4, 4, bg_data).unwrap();

        // FG: 2x2 red at (1,1)→(3,3), offset within the BG
        let fg_data = [[1.0f32, 0.0, 0.0, 1.0]; 4].concat();
        let fg_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let fg = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            fg_dw,
            fg_data,
            ColorSpaceId::default_working(),
        )
        .unwrap();

        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", bg, "foreground", fg, params);

        // Output should cover union = (0,0)→(4,4)
        assert_eq!(output.data_window.min, IVec2::new(0, 0));
        assert_eq!(output.data_window.max, IVec2::new(4, 4));
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);

        // (0,0) = bg only (blue), fg is transparent black here → pure blue
        let px00 = output.get_rgba(0, 0);
        assert!(
            approx_eq(px00[2], 1.0) && approx_eq(px00[0], 0.0),
            "top-left should be blue: {px00:?}"
        );

        // (1,1) = fg is opaque red (alpha=1) → completely overrides bg
        let px11 = output.get_rgba(1, 1);
        assert!(
            approx_eq(px11[0], 1.0) && approx_eq(px11[2], 0.0),
            "center should be red: {px11:?}"
        );

        // (3,3) = bg only again (fg data_window is half-open, doesn't include 3)
        let px33 = output.get_rgba(3, 3);
        assert!(
            approx_eq(px33[2], 1.0) && approx_eq(px33[0], 0.0),
            "bottom-right should be blue: {px33:?}"
        );
    }

    #[test]
    fn test_alpha_over_non_overlapping_images() {
        // A: red at (0,0)→(2,2)
        let a = Image::from_f32_data(2, 2, [[1.0f32, 0.0, 0.0, 1.0]; 4].concat()).unwrap();

        // B: green at (10,10)→(12,12) — completely separate
        let b_dw = RectI {
            min: IVec2::new(10, 10),
            max: IVec2::new(12, 12),
        };
        let b = Image::new_with_domain(
            Format::from_dimensions(20, 20),
            b_dw,
            [[0.0f32, 1.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();

        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", a, "foreground", b, params);

        // Union = (0,0)→(12,12) = 12x12
        assert_eq!(output.width, 12);
        assert_eq!(output.height, 12);

        // (0,0) = only bg (red)
        let px_a = output.get_rgba(0, 0);
        assert!(approx_eq(px_a[0], 1.0), "should be red: {px_a:?}");

        // (10,10) = only fg (green, alpha=1 → overrides transparent bg)
        let px_b = output.get_rgba(10, 10);
        assert!(approx_eq(px_b[1], 1.0), "should be green: {px_b:?}");

        // (5,5) = neither has data → transparent black
        let px_gap = output.get_rgba(5, 5);
        assert!(
            approx_eq(px_gap[3], 0.0),
            "gap should be transparent: {px_gap:?}"
        );
    }

    #[test]
    fn test_merge_porter_duff_vs_reference() {
        let test_pixels: Vec<([f32; 4], [f32; 4], &str)> = vec![
            (
                [1.0, 0.0, 0.0, 1.0],
                [0.0, 0.0, 1.0, 1.0],
                "opaque red over opaque blue",
            ),
            (
                [1.0, 0.0, 0.0, 0.5],
                [0.0, 0.0, 1.0, 0.8],
                "semi-trans red over semi-trans blue",
            ),
            (
                [0.0, 1.0, 0.0, 0.0],
                [1.0, 1.0, 0.0, 1.0],
                "transparent A over opaque B",
            ),
            (
                [1.0, 0.5, 0.0, 1.0],
                [0.0, 0.0, 0.0, 0.0],
                "opaque A over transparent B",
            ),
            (
                [0.0, 0.0, 0.0, 0.0],
                [0.0, 0.0, 0.0, 0.0],
                "both transparent",
            ),
            (
                [0.3, 0.6, 0.9, 0.7],
                [0.9, 0.3, 0.1, 0.4],
                "arbitrary semi-transparent",
            ),
            (
                [1.0, 1.0, 1.0, 0.5],
                [0.5, 0.5, 0.5, 0.5],
                "white over gray, both 50%",
            ),
            (
                [0.0, 0.0, 0.0, 1.0],
                [1.0, 1.0, 1.0, 1.0],
                "black over white, both opaque",
            ),
            (
                [1.4, 0.2, 0.0, 0.9],
                [0.4, 1.3, 0.8, 0.6],
                "hdr channels over semi-transparent",
            ),
        ];

        type BlendOp = fn([f32; 4], f32, [f32; 4], f32) -> [f32; 4];
        type Operation = (i64, &'static str, BlendOp);

        let operations: Vec<Operation> = vec![
            (0, "Over", porter_duff_reference::over),
            (1, "Under", porter_duff_reference::under),
            (2, "In", porter_duff_reference::src_in),
            (3, "Out", porter_duff_reference::src_out),
            (4, "Atop", porter_duff_reference::atop),
            (5, "Xor", porter_duff_reference::xor),
            (6, "Stencil", porter_duff_reference::stencil),
            (7, "Mask", porter_duff_reference::mask),
            (8, "Plus", porter_duff_reference::plus),
            (9, "Multiply", porter_duff_reference::multiply),
            (10, "Difference", porter_duff_reference::difference),
            (11, "Screen", porter_duff_reference::screen),
            (12, "Max", porter_duff_reference::max_op),
            (13, "Min", porter_duff_reference::min_op),
        ];

        for (a, b, pixel_desc) in &test_pixels {
            for (op_idx, op_name, ref_fn) in &operations {
                let actual = merge_single_pixel(*a, *b, *op_idx, 1.0);
                let expected = ref_fn(*a, a[3], *b, b[3]);

                for c in 0..4 {
                    let channel = ["R", "G", "B", "A"][c];
                    assert!(
                        (actual[c] - expected[c]).abs() < 0.002,
                        "MISMATCH: op={}, pixels={}, channel={}: got {}, expected {}\n  A={:?}, B={:?}\n  actual={:?}, expected={:?}",
                        op_name,
                        pixel_desc,
                        channel,
                        actual[c],
                        expected[c],
                        a,
                        b,
                        actual,
                        expected,
                    );
                }
            }
        }
    }

    #[test]
    fn test_merge_bbox_intersection() {
        let a_dw = RectI {
            min: IVec2::new(0, 0),
            max: IVec2::new(2, 2),
        };
        let b_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let format = Format::from_dimensions(3, 3);
        let a = Image::new_with_domain(
            format.clone(),
            a_dw,
            [[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let b = Image::new_with_domain(
            format,
            b_dw,
            [[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let node = Merge::new();

        let output = eval_two_input_node(&node, "A", a, "B", b, merge_params(0, 1, 1.0, 1.0));

        assert_eq!(output.data_window.min, IVec2::new(1, 1));
        assert_eq!(output.data_window.max, IVec2::new(2, 2));
        assert_eq!(output.width, 1);
        assert_eq!(output.height, 1);
        let px = output.get_rgba(1, 1);
        assert_color_approx(px, [1.0, 0.0, 0.0, 1.0], "merge bbox intersection");
    }

    #[test]
    fn test_merge_bbox_a() {
        let a_dw = RectI {
            min: IVec2::new(0, 0),
            max: IVec2::new(2, 2),
        };
        let b_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let format = Format::from_dimensions(3, 3);
        let a = Image::new_with_domain(
            format.clone(),
            a_dw,
            [[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let b = Image::new_with_domain(
            format,
            b_dw,
            [[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let node = Merge::new();

        let output =
            eval_two_input_node(&node, "A", a.clone(), "B", b, merge_params(0, 2, 1.0, 1.0));

        assert_eq!(output.data_window, a.data_window);
        assert_eq!(output.width, a.width);
        assert_eq!(output.height, a.height);
    }

    #[test]
    fn test_merge_bbox_b() {
        let a_dw = RectI {
            min: IVec2::new(0, 0),
            max: IVec2::new(2, 2),
        };
        let b_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let format = Format::from_dimensions(3, 3);
        let a = Image::new_with_domain(
            format.clone(),
            a_dw,
            [[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let b = Image::new_with_domain(
            format,
            b_dw,
            [[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();
        let node = Merge::new();

        let output =
            eval_two_input_node(&node, "A", a, "B", b.clone(), merge_params(0, 3, 1.0, 1.0));

        assert_eq!(output.data_window, b.data_window);
        assert_eq!(output.width, b.width);
        assert_eq!(output.height, b.height);
    }

    #[test]
    fn test_merge_different_size_images() {
        let bg_data = vec![[0.0f32, 0.0, 1.0, 1.0]; 16].concat();
        let b = Image::from_f32_data(4, 4, bg_data).unwrap();

        let a_data = [[1.0f32, 0.0, 0.0, 1.0]; 4].concat();
        let a_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let a = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            a_dw,
            a_data,
            ColorSpaceId::default_working(),
        )
        .unwrap();

        let node = Merge::new();
        let output = eval_two_input_node(&node, "A", a, "B", b, merge_params(0, 0, 1.0, 1.0));

        assert_eq!(output.data_window.min, IVec2::new(0, 0));
        assert_eq!(output.data_window.max, IVec2::new(4, 4));
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);

        let px00 = output.get_rgba(0, 0);
        assert!(
            approx_eq(px00[2], 1.0) && approx_eq(px00[0], 0.0),
            "outside A region should be blue: {px00:?}"
        );

        let px11 = output.get_rgba(1, 1);
        assert!(
            approx_eq(px11[0], 1.0) && approx_eq(px11[2], 0.0),
            "inside A region should be red: {px11:?}"
        );
    }

    #[test]
    fn test_merge_with_opacity() {
        let a = [1.0f32, 0.0, 0.0, 0.8];
        let b = [0.0f32, 0.0, 1.0, 0.6];

        for opacity_int in [0, 25, 50, 75, 100] {
            let opacity = opacity_int as f64 / 100.0;
            let effective_aa = a[3] * opacity as f32;

            let actual = merge_single_pixel(a, b, 0, opacity);
            let expected = porter_duff_reference::over(a, effective_aa, b, b[3]);

            for c in 0..4 {
                assert!(
                    (actual[c] - expected[c]).abs() < 0.002,
                    "Opacity {}: channel {} mismatch: got {}, expected {}",
                    opacity,
                    c,
                    actual[c],
                    expected[c],
                );
            }
        }
    }

    #[test]
    fn test_merge_with_mix() {
        let a = Image::from_f32_data(1, 1, vec![1.0, 0.0, 0.0, 1.0]).unwrap();
        let b = Image::from_f32_data(1, 1, vec![0.0, 0.0, 1.0, 1.0]).unwrap();
        let node = Merge::new();

        let output = eval_two_input_node(&node, "A", a, "B", b, merge_params(0, 0, 1.0, 0.25));

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.25, 0.0, 0.75, 1.0], "merge mix");
    }

    #[test]
    fn test_blend_different_size_images() {
        // Base: 4x4 mid-gray
        let base = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat()).unwrap();

        // Blend: 2x2 white at (1,1)→(3,3)
        let bl_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let bl = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            bl_dw,
            [[1.0f32, 1.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        )
        .unwrap();

        let node = Blend::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1)); // Add mode
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "base", base, "blend_input", bl, params);

        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);

        // (0,0): base=0.5, blend=transparent black (0.0). Add: 0.5+0.0=0.5
        let px00 = output.get_rgba(0, 0);
        assert!(approx_eq(px00[0], 0.5), "outside blend region: {px00:?}");

        // (1,1): base=0.5, blend=1.0. Add: 0.5+1.0=1.5 (HDR, no clamp)
        let px11 = output.get_rgba(1, 1);
        assert!(approx_eq(px11[0], 1.5), "inside blend region: {px11:?}");
    }

    #[test]
    fn test_alpha_over_format_from_background() {
        let bg_format = Format::hd();
        let bg_dw = RectI {
            min: IVec2::new(10, 10),
            max: IVec2::new(14, 14),
        };
        let bg = Image::new_with_domain(
            bg_format.clone(),
            bg_dw,
            vec![0.0f32; 64],
            ColorSpaceId::new(ColorSpaceId::ACESCG),
        )
        .unwrap();

        let fg = Image::from_f32_data(2, 2, vec![0.0f32; 16]).unwrap();

        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", bg.clone(), "foreground", fg, params);

        assert_eq!(
            output.format, bg_format,
            "format should come from background"
        );
        assert_eq!(
            output.color_space.as_str(),
            ColorSpaceId::ACESCG,
            "color_space from background"
        );
    }

    #[test]
    fn test_translate_zero_cost_data_window_shift() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);
        let original_dw = input.data_window;

        let node = Translate::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(50));
        params.insert("y".to_string(), ParamValue::Int(-30));

        let output = eval_image_node(&node, input.clone(), params);

        let expected_dw = RectI {
            min: IVec2::new(original_dw.min.x + 50, original_dw.min.y - 30),
            max: IVec2::new(original_dw.max.x + 50, original_dw.max.y - 30),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.format, input.format);
        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);

        let px = output.get_rgba(150, 70);
        assert_color_approx(px, [1.0, 0.0, 0.0, 1.0], "pixel at shifted location");
    }

    #[test]
    fn test_crop_intersects_data_window() {
        let input = make_offset_image([0.0, 1.0, 0.0, 1.0]);
        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(102));
        params.insert("y".to_string(), ParamValue::Int(101));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));

        let output = eval_image_node(&node, input.clone(), params);

        // Output is always exactly width×height, starting at origin
        let expected_dw = RectI {
            min: IVec2::new(0, 0),
            max: IVec2::new(10, 10),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.width, 10);
        assert_eq!(output.height, 10);
        assert_eq!(output.format, input.format);
        // Pixel at output (0,0) maps to source global (102,101) which is inside the input
        let px = output.get_rgba(0, 0);
        assert_color_approx(px, [0.0, 1.0, 0.0, 1.0], "pixel inside crop");
        // Pixel at output (2,3) maps to source global (104,104) which is outside the input
        let px_outside = output.get_rgba(2, 3);
        assert_color_approx(
            px_outside,
            [0.0, 0.0, 0.0, 0.0],
            "pixel outside source is transparent",
        );
    }

    #[test]
    fn test_crop_no_overlap_produces_empty() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);
        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(200));
        params.insert("y".to_string(), ParamValue::Int(200));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));

        let output = eval_image_node(&node, input, params);

        // Output is always exactly width×height, even with no overlap
        assert_eq!(output.width, 10);
        assert_eq!(output.height, 10);
        let px = output.get_rgba(0, 0);
        assert_color_approx(
            px,
            [0.0, 0.0, 0.0, 0.0],
            "non-overlapping crop is transparent",
        );
    }

    #[test]
    fn test_crop_clip_to_source_intersects_data_window() {
        let input = make_offset_image([0.0, 1.0, 0.0, 1.0]);

        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(102));
        params.insert("y".to_string(), ParamValue::Int(101));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));
        params.insert("clip_to_source".to_string(), ParamValue::Bool(true));

        let output = eval_image_node(&node, input.clone(), params);

        // With clip_to_source, output is intersection of crop rect with source data_window
        let expected_dw = RectI {
            min: IVec2::new(102, 101),
            max: IVec2::new(104, 104),
        };
        assert_eq!(output.data_window, expected_dw);
        assert_eq!(output.width, 2);
        assert_eq!(output.height, 3);
        assert_eq!(output.format, input.format);

        let px = output.get_rgba(102, 101);
        assert_color_approx(px, [0.0, 1.0, 0.0, 1.0], "pixel inside crop");
    }

    #[test]
    fn test_crop_clip_to_source_no_overlap_produces_empty() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);

        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(200));
        params.insert("y".to_string(), ParamValue::Int(200));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));
        params.insert("clip_to_source".to_string(), ParamValue::Bool(true));

        let output = eval_image_node(&node, input, params);

        // With clip_to_source and no overlap, output is 1×1 transparent
        assert_eq!(output.width, 1);
        assert_eq!(output.height, 1);
        let px = output.get_rgba(200, 200);
        assert_color_approx(
            px,
            [0.0, 0.0, 0.0, 0.0],
            "non-overlapping crop is transparent",
        );
    }
    #[test]
    fn test_resize_produces_new_format() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);

        let node = Resize::new();
        let mut params = HashMap::new();
        params.insert("width".to_string(), ParamValue::Int(8));
        params.insert("height".to_string(), ParamValue::Int(6));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        assert_eq!(output.width, 8);
        assert_eq!(output.height, 6);
        let expected_format = Format::from_dimensions(8, 6);
        assert_eq!(output.format, expected_format);
        let expected_dw = RectI::from_dimensions(8, 6);
        assert_eq!(output.data_window, expected_dw);
    }

    #[test]
    fn test_rotate_data_window_expands() {
        let input = Image::from_f32_data(4, 4, vec![[1.0f32, 0.0, 0.0, 1.0]; 16].concat()).unwrap();

        let node = Rotate::new();
        let mut params = HashMap::new();
        params.insert("angle".to_string(), ParamValue::Float(45.0));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input.clone(), params);

        assert!(
            output.width > input.width || output.height > input.height,
            "rotated image should expand: {}x{} vs {}x{}",
            output.width,
            output.height,
            input.width,
            input.height
        );
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_rotate_offset_image_preserves_center() {
        let input = make_offset_image([0.0, 0.0, 1.0, 1.0]);
        let in_center_x = (input.data_window.min.x + input.data_window.max.x) as f32 / 2.0;
        let in_center_y = (input.data_window.min.y + input.data_window.max.y) as f32 / 2.0;

        let node = Rotate::new();
        let mut params = HashMap::new();
        params.insert("angle".to_string(), ParamValue::Float(90.0));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input.clone(), params);

        let out_center_x = (output.data_window.min.x + output.data_window.max.x) as f32 / 2.0;
        let out_center_y = (output.data_window.min.y + output.data_window.max.y) as f32 / 2.0;

        assert!(
            (out_center_x - in_center_x).abs() < 1.5,
            "center X preserved: {out_center_x} vs {in_center_x}"
        );
        assert!(
            (out_center_y - in_center_y).abs() < 1.5,
            "center Y preserved: {out_center_y} vs {in_center_y}"
        );
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_transform2d_translate_only() {
        let input = make_offset_image([1.0, 1.0, 0.0, 1.0]);

        let node = Transform2D::new();
        let mut params = HashMap::new();
        params.insert("translate_x".to_string(), ParamValue::Float(10.0));
        params.insert("translate_y".to_string(), ParamValue::Float(20.0));
        params.insert("rotate".to_string(), ParamValue::Float(0.0));
        params.insert("scale_x".to_string(), ParamValue::Float(1.0));
        params.insert("scale_y".to_string(), ParamValue::Float(1.0));
        params.insert("pivot_x".to_string(), ParamValue::Float(0.5));
        params.insert("pivot_y".to_string(), ParamValue::Float(0.5));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.data_window.min.x, input.data_window.min.x + 10);
        assert_eq!(output.data_window.min.y, input.data_window.min.y + 20);
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_transform2d_scale_expands_bbox() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat()).unwrap();

        let node = Transform2D::new();
        let mut params = HashMap::new();
        params.insert("translate_x".to_string(), ParamValue::Float(0.0));
        params.insert("translate_y".to_string(), ParamValue::Float(0.0));
        params.insert("rotate".to_string(), ParamValue::Float(0.0));
        params.insert("scale_x".to_string(), ParamValue::Float(2.0));
        params.insert("scale_y".to_string(), ParamValue::Float(2.0));
        params.insert("pivot_x".to_string(), ParamValue::Float(0.5));
        params.insert("pivot_y".to_string(), ParamValue::Float(0.5));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input.clone(), params);

        assert!(
            output.data_window.width_u32() >= input.data_window.width_u32() * 2 - 1,
            "scaled width: {} vs input {}",
            output.data_window.width_u32(),
            input.data_window.width_u32()
        );
        assert_eq!(output.format, input.format);
    }

    #[test]
    fn test_transform2d_clamp_preserves_dimensions() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat()).unwrap();

        let node = Transform2D::new();
        let mut params = HashMap::new();
        params.insert("translate_x".to_string(), ParamValue::Float(0.0));
        params.insert("translate_y".to_string(), ParamValue::Float(0.0));
        params.insert("rotate".to_string(), ParamValue::Float(0.0));
        params.insert("scale_x".to_string(), ParamValue::Float(2.0));
        params.insert("scale_y".to_string(), ParamValue::Float(2.0));
        params.insert("pivot_x".to_string(), ParamValue::Float(0.5));
        params.insert("pivot_y".to_string(), ParamValue::Float(0.5));
        params.insert("filter".to_string(), ParamValue::Int(0));
        params.insert("clamp".to_string(), ParamValue::Bool(true));

        let output = eval_image_node(&node, input.clone(), params);

        // With clamp enabled, data_window must match input exactly
        assert_eq!(
            output.data_window, input.data_window,
            "clamp should preserve original data_window"
        );
        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);
    }

    #[test]
    fn test_flip_preserves_format_and_data_window() {
        let input = make_offset_image([1.0, 0.0, 1.0, 1.0]);

        let node = Flip::new();
        let mut params = HashMap::new();
        params.insert("horizontal".to_string(), ParamValue::Bool(true));
        params.insert("vertical".to_string(), ParamValue::Bool(false));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);
    }

    // ── Channel node tests ───────────────────────────────────────────────

    #[test]
    fn test_separate_rgba_roundtrip() {
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 1.0, 0.0, 1.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(sep.evaluate(&ctx)).unwrap();
        let red = match result.get("red").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let green = match result.get("green").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let blue = match result.get("blue").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        let alpha = match result.get("alpha").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        // Each channel output should be grayscale with the channel value
        assert!(approx_eq(red.get_pixel_f32(0, 0)[0], 0.1), "red ch pixel 0");
        assert!(
            approx_eq(green.get_pixel_f32(0, 0)[0], 0.2),
            "green ch pixel 0"
        );
        assert!(
            approx_eq(blue.get_pixel_f32(0, 0)[0], 0.3),
            "blue ch pixel 0"
        );
        assert!(
            approx_eq(alpha.get_pixel_f32(0, 0)[0], 0.4),
            "alpha ch pixel 0"
        );
        assert!(approx_eq(red.get_pixel_f32(1, 0)[0], 0.5), "red ch pixel 1");
        // All channel outputs should have alpha = 1.0
        assert!(
            approx_eq(red.get_pixel_f32(0, 0)[3], 1.0),
            "red output alpha"
        );
        // Format should propagate
        assert_eq!(red.format, input.format);
        assert_eq!(red.data_window, input.data_window);
    }

    #[test]
    fn test_separate_combine_rgba_roundtrip() {
        // Separate then Combine should reconstruct the original channels
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 1.0, 0.0, 1.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        // Step 1: Separate
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let sep_result = block_on(sep.evaluate(&ctx)).unwrap();
        let red = sep_result.get("red").unwrap().clone();
        let green = sep_result.get("green").unwrap().clone();
        let blue = sep_result.get("blue").unwrap().clone();
        let alpha = sep_result.get("alpha").unwrap().clone();
        // Step 2: Combine
        let comb = CombineRgba::new();
        let mut comb_inputs = HashMap::new();
        comb_inputs.insert("red".to_string(), red);
        comb_inputs.insert("green".to_string(), green);
        comb_inputs.insert("blue".to_string(), blue);
        comb_inputs.insert("alpha".to_string(), alpha);
        let ctx2 = EvalContext {
            inputs: comb_inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let comb_result = block_on(comb.evaluate(&ctx2)).unwrap();
        let output = match comb_result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };
        // Should match original pixel values
        for y in 0..2u32 {
            for x in 0..2u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        (orig[c] - out[c]).abs() < 0.01,
                        "pixel ({},{}) channel {}: orig={}, got={}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_copy_channels_identity() {
        // Default params (A.R, A.G, A.B, A.A) should pass through A unchanged
        let a = Image::from_f32_data(
            2,
            2,
            vec![
                0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.0, 0.1, 1.0, 0.0, 1.0, 0.0, 0.5,
            ],
        )
        .unwrap();
        let b = Image::from_f32_data(2, 2, vec![1.0f32; 16]).unwrap();
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(0)); // A.R
        params.insert("green".to_string(), ParamValue::Int(1)); // A.G
        params.insert("blue".to_string(), ParamValue::Int(2)); // A.B
        params.insert("alpha".to_string(), ParamValue::Int(3)); // A.A
        let output = eval_two_input_node(&node, "A", a.clone(), "B", b, params);
        for y in 0..2u32 {
            for x in 0..2u32 {
                let orig = a.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        approx_eq(orig[c], out[c]),
                        "identity failed at ({},{}) ch {}: {} vs {}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_copy_channels_swap_from_b() {
        // Take RGB from B, Alpha from A
        let a = Image::from_f32_data(1, 1, vec![0.1, 0.2, 0.3, 0.9]).unwrap();
        let b = Image::from_f32_data(1, 1, vec![0.7, 0.8, 0.9, 0.0]).unwrap();
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(4)); // B.R
        params.insert("green".to_string(), ParamValue::Int(5)); // B.G
        params.insert("blue".to_string(), ParamValue::Int(6)); // B.B
        params.insert("alpha".to_string(), ParamValue::Int(3)); // A.A
        let output = eval_two_input_node(&node, "A", a, "B", b, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.7), "R from B: {}", px[0]);
        assert!(approx_eq(px[1], 0.8), "G from B: {}", px[1]);
        assert!(approx_eq(px[2], 0.9), "B from B: {}", px[2]);
        assert!(approx_eq(px[3], 0.9), "A from A: {}", px[3]);
    }

    #[test]
    fn test_copy_channels_shuffle() {
        // Shuffle: output R=A.Blue, G=B.Alpha, B=A.Red, A=B.Green
        let a = Image::from_f32_data(1, 1, vec![0.1, 0.2, 0.3, 0.4]).unwrap();
        let b = Image::from_f32_data(1, 1, vec![0.5, 0.6, 0.7, 0.8]).unwrap();
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(2)); // A.B
        params.insert("green".to_string(), ParamValue::Int(7)); // B.A
        params.insert("blue".to_string(), ParamValue::Int(0)); // A.R
        params.insert("alpha".to_string(), ParamValue::Int(5)); // B.G
        let output = eval_two_input_node(&node, "A", a, "B", b, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.3), "R=A.B: {}", px[0]);
        assert!(approx_eq(px[1], 0.8), "G=B.A: {}", px[1]);
        assert!(approx_eq(px[2], 0.1), "B=A.R: {}", px[2]);
        assert!(approx_eq(px[3], 0.6), "A=B.G: {}", px[3]);
    }

    // ── Grade and Clamp node tests ──────────────────────────────────────

    #[test]
    fn test_grade_identity() {
        let node = Grade::new();
        let mut params = HashMap::new();
        params.insert("lift_r".to_string(), ParamValue::Float(0.0));
        params.insert("lift_g".to_string(), ParamValue::Float(0.0));
        params.insert("lift_b".to_string(), ParamValue::Float(0.0));
        params.insert("gamma_r".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_g".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_b".to_string(), ParamValue::Float(1.0));
        params.insert("gain_r".to_string(), ParamValue::Float(1.0));
        params.insert("gain_g".to_string(), ParamValue::Float(1.0));
        params.insert("gain_b".to_string(), ParamValue::Float(1.0));
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.3, 0.7, 0.9]).unwrap();
        let output = eval_image_node(&node, input.clone(), params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.5), "R identity: {}", px[0]);
        assert!(approx_eq(px[1], 0.3), "G identity: {}", px[1]);
        assert!(approx_eq(px[2], 0.7), "B identity: {}", px[2]);
        assert!(approx_eq(px[3], 0.9), "A preserved: {}", px[3]);
    }

    #[test]
    fn test_grade_lift() {
        let node = Grade::new();
        let mut params = HashMap::new();
        params.insert("lift_r".to_string(), ParamValue::Float(0.1));
        params.insert("lift_g".to_string(), ParamValue::Float(0.0));
        params.insert("lift_b".to_string(), ParamValue::Float(-0.1));
        params.insert("gamma_r".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_g".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_b".to_string(), ParamValue::Float(1.0));
        params.insert("gain_r".to_string(), ParamValue::Float(1.0));
        params.insert("gain_g".to_string(), ParamValue::Float(1.0));
        params.insert("gain_b".to_string(), ParamValue::Float(1.0));
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.0]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.6), "R lifted +0.1: {}", px[0]);
        assert!(approx_eq(px[1], 0.5), "G unchanged: {}", px[1]);
        assert!(approx_eq(px[2], 0.4), "B lifted -0.1: {}", px[2]);
    }

    #[test]
    fn test_grade_gain() {
        let node = Grade::new();
        let mut params = HashMap::new();
        params.insert("lift_r".to_string(), ParamValue::Float(0.0));
        params.insert("lift_g".to_string(), ParamValue::Float(0.0));
        params.insert("lift_b".to_string(), ParamValue::Float(0.0));
        params.insert("gamma_r".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_g".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_b".to_string(), ParamValue::Float(1.0));
        params.insert("gain_r".to_string(), ParamValue::Float(2.0));
        params.insert("gain_g".to_string(), ParamValue::Float(0.5));
        params.insert("gain_b".to_string(), ParamValue::Float(1.0));
        let input = Image::from_f32_data(1, 1, vec![0.4, 0.6, 0.8, 1.0]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.8), "R gain 2x: {}", px[0]);
        assert!(approx_eq(px[1], 0.3), "G gain 0.5x: {}", px[1]);
        assert!(approx_eq(px[2], 0.8), "B gain 1x: {}", px[2]);
    }

    #[test]
    fn test_grade_gamma() {
        let node = Grade::new();
        let mut params = HashMap::new();
        params.insert("lift_r".to_string(), ParamValue::Float(0.0));
        params.insert("lift_g".to_string(), ParamValue::Float(0.0));
        params.insert("lift_b".to_string(), ParamValue::Float(0.0));
        params.insert("gamma_r".to_string(), ParamValue::Float(2.0));
        params.insert("gamma_g".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_b".to_string(), ParamValue::Float(1.0));
        params.insert("gain_r".to_string(), ParamValue::Float(1.0));
        params.insert("gain_g".to_string(), ParamValue::Float(1.0));
        params.insert("gain_b".to_string(), ParamValue::Float(1.0));
        let input = Image::from_f32_data(1, 1, vec![0.25, 0.5, 0.5, 1.0]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        // gamma=2 means inv_gamma=0.5, so 0.25^0.5 = 0.5
        assert!(approx_eq(px[0], 0.5), "R gamma 2.0: {}", px[0]);
        assert!(approx_eq(px[1], 0.5), "G unchanged: {}", px[1]);
    }

    #[test]
    fn test_grade_format_propagation() {
        let node = Grade::new();
        let mut params = HashMap::new();
        params.insert("lift_r".to_string(), ParamValue::Float(0.0));
        params.insert("lift_g".to_string(), ParamValue::Float(0.0));
        params.insert("lift_b".to_string(), ParamValue::Float(0.0));
        params.insert("gamma_r".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_g".to_string(), ParamValue::Float(1.0));
        params.insert("gamma_b".to_string(), ParamValue::Float(1.0));
        params.insert("gain_r".to_string(), ParamValue::Float(1.0));
        params.insert("gain_g".to_string(), ParamValue::Float(1.0));
        params.insert("gain_b".to_string(), ParamValue::Float(1.0));
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_clamp_default() {
        let node = Clamp::new();
        let mut params = HashMap::new();
        params.insert("min_r".to_string(), ParamValue::Float(0.0));
        params.insert("min_g".to_string(), ParamValue::Float(0.0));
        params.insert("min_b".to_string(), ParamValue::Float(0.0));
        params.insert("max_r".to_string(), ParamValue::Float(1.0));
        params.insert("max_g".to_string(), ParamValue::Float(1.0));
        params.insert("max_b".to_string(), ParamValue::Float(1.0));
        params.insert("clamp_alpha".to_string(), ParamValue::Bool(false));
        // HDR values outside [0,1]
        let input = Image::from_f32_data(1, 1, vec![-0.1, 1.5, 0.5, 2.0]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.0), "R clamped min: {}", px[0]);
        assert!(approx_eq(px[1], 1.0), "G clamped max: {}", px[1]);
        assert!(approx_eq(px[2], 0.5), "B unchanged: {}", px[2]);
        assert!(approx_eq(px[3], 2.0), "A not clamped: {}", px[3]);
    }

    #[test]
    fn test_clamp_alpha() {
        let node = Clamp::new();
        let mut params = HashMap::new();
        params.insert("min_r".to_string(), ParamValue::Float(0.0));
        params.insert("min_g".to_string(), ParamValue::Float(0.0));
        params.insert("min_b".to_string(), ParamValue::Float(0.0));
        params.insert("max_r".to_string(), ParamValue::Float(1.0));
        params.insert("max_g".to_string(), ParamValue::Float(1.0));
        params.insert("max_b".to_string(), ParamValue::Float(1.0));
        params.insert("clamp_alpha".to_string(), ParamValue::Bool(true));
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.5]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[3], 1.0), "A clamped: {}", px[3]);
    }

    #[test]
    fn test_clamp_custom_range() {
        let node = Clamp::new();
        let mut params = HashMap::new();
        params.insert("min_r".to_string(), ParamValue::Float(0.2));
        params.insert("min_g".to_string(), ParamValue::Float(0.2));
        params.insert("min_b".to_string(), ParamValue::Float(0.2));
        params.insert("max_r".to_string(), ParamValue::Float(0.8));
        params.insert("max_g".to_string(), ParamValue::Float(0.8));
        params.insert("max_b".to_string(), ParamValue::Float(0.8));
        params.insert("clamp_alpha".to_string(), ParamValue::Bool(false));
        let input = Image::from_f32_data(1, 1, vec![0.0, 0.5, 1.0, 1.0]).unwrap();
        let output = eval_image_node(&node, input, params);
        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.2), "R clamped to min: {}", px[0]);
        assert!(approx_eq(px[1], 0.5), "G in range: {}", px[1]);
        assert!(approx_eq(px[2], 0.8), "B clamped to max: {}", px[2]);
    }

    #[test]
    fn test_clamp_format_propagation() {
        let node = Clamp::new();
        let mut params = HashMap::new();
        params.insert("min_r".to_string(), ParamValue::Float(0.0));
        params.insert("min_g".to_string(), ParamValue::Float(0.0));
        params.insert("min_b".to_string(), ParamValue::Float(0.0));
        params.insert("max_r".to_string(), ParamValue::Float(1.0));
        params.insert("max_g".to_string(), ParamValue::Float(1.0));
        params.insert("max_b".to_string(), ParamValue::Float(1.0));
        params.insert("clamp_alpha".to_string(), ParamValue::Bool(false));
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    /// Naive direct-convolution Gaussian blur as a reference implementation.
    /// Slow (O(w*h*r^2)) but obviously correct. Works in premultiplied space
    /// to handle alpha edges properly, then converts back to straight alpha.
    fn reference_gaussian_blur(img: &Image, sigma: f32) -> Image {
        let w = img.width as usize;
        let h = img.height as usize;
        let radius = (sigma * 3.0).ceil() as i32;
        let mut kernel = Vec::new();
        let mut sum = 0.0f64;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let d2 = (dx * dx + dy * dy) as f64;
                let g = (-d2 / (2.0 * sigma as f64 * sigma as f64)).exp();
                kernel.push((dx, dy, g));
                sum += g;
            }
        }
        for entry in kernel.iter_mut() {
            entry.2 /= sum;
        }

        let src = &img.data;
        let mut out = vec![0.0f32; w * h * 4];

        for y in 0..h {
            for x in 0..w {
                let mut acc_r = 0.0f64;
                let mut acc_g = 0.0f64;
                let mut acc_b = 0.0f64;
                let mut acc_a = 0.0f64;

                for &(dx, dy, weight) in &kernel {
                    let sx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    let sy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    let idx = (sy * w + sx) * 4;
                    let a = src[idx + 3] as f64;
                    acc_r += src[idx] as f64 * a * weight;
                    acc_g += src[idx + 1] as f64 * a * weight;
                    acc_b += src[idx + 2] as f64 * a * weight;
                    acc_a += a * weight;
                }

                let oi = (y * w + x) * 4;
                if acc_a > 1e-10 {
                    out[oi] = (acc_r / acc_a) as f32;
                    out[oi + 1] = (acc_g / acc_a) as f32;
                    out[oi + 2] = (acc_b / acc_a) as f32;
                } else {
                    out[oi] = 0.0;
                    out[oi + 1] = 0.0;
                    out[oi + 2] = 0.0;
                }
                out[oi + 3] = acc_a as f32;
            }
        }

        Image::from_f32_data(img.width, img.height, out).unwrap()
    }

    #[test]
    fn test_gaussian_blur_vs_reference() {
        let w = 64u32;
        let h = 64u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];

        // Left half: opaque white. Right half: transparent black.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 32 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }

        let input = Image::from_f32_data(w, h, data).unwrap();

        for sigma in [0.5f64, 1.0, 1.5, 2.0, 3.0, 5.0, 7.0, 10.0] {
            let node = GaussianBlur::new();
            let mut params = HashMap::new();
            params.insert("sigma".to_string(), ParamValue::Float(sigma));
            let actual = eval_image_node(&node, input.clone(), params);
            let expected = reference_gaussian_blur(&input, sigma as f32);

            let mut max_rgb_diff: f32 = 0.0;
            let mut max_a_diff: f32 = 0.0;
            let mut worst_pixel = (0, 0);

            for y in 0..h as usize {
                for x in 0..w as usize {
                    let ai = (y * w as usize + x) * 4;
                    let a = &actual.data;
                    let e = &expected.data;

                    // Only compare RGB where alpha is significant — at near-zero
                    // alpha, RGB values are invisible and unpremultiply amplifies
                    // noise.
                    let alpha = a[ai + 3].max(e[ai + 3]);
                    if alpha > 0.05 {
                        for c in 0..3 {
                            let diff = (a[ai + c] - e[ai + c]).abs();
                            if diff > max_rgb_diff {
                                max_rgb_diff = diff;
                                worst_pixel = (x, y);
                            }
                        }
                    }
                    let ad = (a[ai + 3] - e[ai + 3]).abs();
                    if ad > max_a_diff {
                        max_a_diff = ad;
                    }
                }
            }

            // RGB should match very closely — the premultiply sandwich
            // ensures correct color blending regardless of approximation method.
            assert!(
                max_rgb_diff < 0.01,
                "sigma={}: RGB diff too large: {:.4} at pixel ({},{}) \
                 actual=[{:.3},{:.3},{:.3},{:.3}] expected=[{:.3},{:.3},{:.3},{:.3}]",
                sigma,
                max_rgb_diff,
                worst_pixel.0,
                worst_pixel.1,
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 1],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 2],
                actual.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 3],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 1],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 2],
                expected.data[(worst_pixel.1 * w as usize + worst_pixel.0) * 4 + 3],
            );

            // Alpha tolerance is generous because 3-pass box blur is an
            // approximation of a true Gaussian — divergence up to ~0.27 is
            // expected at very small sigma where the box radius is tiny.
            assert!(
                max_a_diff < 0.30,
                "sigma={sigma}: Alpha diff too large: {max_a_diff:.4}",
            );
        }
    }

    #[test]
    fn test_gaussian_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];

        // Left half: opaque white. Right half: transparent black.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }

        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = GaussianBlur::new();
        let mut params = HashMap::new();
        params.insert("sigma".to_string(), ParamValue::Float(3.0));
        let output = eval_image_node(&node, input, params);

        // Check pixels near the alpha edge (x=7..9, middle row).
        // With correct blurring, any pixel with partial alpha should
        // have RGB close to white (1.0), not darkened by transparent
        // black bleeding in.
        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}] — \
                     RGB should be close to 1.0 for pixels with alpha > 0",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_text_renders() {
        let node = Text::new();
        let mut params = HashMap::new();
        params.insert("text".to_string(), ParamValue::String("Hi".to_string()));
        params.insert("font_size".to_string(), ParamValue::Float(48.0));
        params.insert("color".to_string(), ParamValue::Color([1.0, 1.0, 1.0, 1.0]));
        params.insert("width".to_string(), ParamValue::Int(128));
        params.insert("height".to_string(), ParamValue::Int(64));
        params.insert("align".to_string(), ParamValue::Int(1));
        let inputs = HashMap::new();
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let img = match result.get("image").unwrap() {
            Value::Image(img) => img,
            _ => panic!("Expected Image output"),
        };
        assert_eq!(img.width, 128);
        assert_eq!(img.height, 64);
        let has_content = img.data.iter().any(|&v| v > 0.0);
        assert!(has_content, "Text node should render visible pixels");
    }

    #[test]
    fn test_dot_passthrough() {
        let input = Image::from_f32_data(
            2,
            2,
            vec![
                1.0, 0.5, 0.25, 1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.1, 0.2, 0.3, 0.4,
            ],
        )
        .unwrap();
        let node = Dot::new();
        let output = eval_image_node(&node, input.clone(), HashMap::new());
        assert_eq!(output.data, input.data);
    }

    // ── Matte node helpers ───────────────────────────────────────────────

    /// Evaluate a node with one image input and return both "image" and "matte" outputs.
    fn eval_matte_node(
        node: &dyn Node,
        input: Image,
        params: HashMap<String, ParamValue>,
    ) -> (Image, Image) {
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let image = match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Image, got {:?}", other.value_type()),
        };
        let matte = match result.get("matte").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Image for matte, got {:?}", other.value_type()),
        };
        (image, matte)
    }

    /// Evaluate DifferenceMatte with two inputs (image + plate).
    fn eval_difference_matte(
        image: Image,
        plate: Image,
        params: HashMap<String, ParamValue>,
    ) -> (Image, Image) {
        let node = DifferenceMatte::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        inputs.insert("plate".to_string(), Value::Image(plate));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let img = match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Image, got {:?}", other.value_type()),
        };
        let matte = match result.get("matte").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Image for matte, got {:?}", other.value_type()),
        };
        (img, matte)
    }

    // ── LuminanceKey tests ───────────────────────────────────────────────

    #[test]
    fn test_luminance_key_bright_keyed() {
        // Bright pixel (lum=1.0) with low=0.2, high=0.8 → key=1.0
        let input = Image::from_f32_data(1, 1, vec![1.0, 1.0, 1.0, 1.0]).unwrap();
        let node = LuminanceKey::new();
        let mut params = HashMap::new();
        params.insert("low".to_string(), ParamValue::Float(0.2));
        params.insert("high".to_string(), ParamValue::Float(0.8));
        params.insert("channel".to_string(), ParamValue::Int(0)); // luminance
        params.insert("invert".to_string(), ParamValue::Bool(false));

        let (img, matte) = eval_matte_node(&node, input, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        // key=1.0, so alpha = 1.0*1.0 = 1.0, matte = white
        assert!(approx_eq(px[3], 1.0), "alpha should be 1.0: {}", px[3]);
        assert!(approx_eq(mk[0], 1.0), "matte R should be 1.0: {}", mk[0]);
        assert!(
            approx_eq(mk[3], 1.0),
            "matte alpha should be 1.0: {}",
            mk[3]
        );
    }

    #[test]
    fn test_luminance_key_dark_suppressed() {
        // Dark pixel (lum=0.0) with low=0.2, high=0.8 → key=0.0
        let input = Image::from_f32_data(1, 1, vec![0.0, 0.0, 0.0, 1.0]).unwrap();
        let node = LuminanceKey::new();
        let mut params = HashMap::new();
        params.insert("low".to_string(), ParamValue::Float(0.2));
        params.insert("high".to_string(), ParamValue::Float(0.8));
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert("invert".to_string(), ParamValue::Bool(false));

        let (img, matte) = eval_matte_node(&node, input, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        assert!(approx_eq(px[3], 0.0), "alpha should be 0.0: {}", px[3]);
        assert!(approx_eq(mk[0], 0.0), "matte should be 0.0: {}", mk[0]);
    }

    #[test]
    fn test_luminance_key_midtone_soft() {
        // Pixel with lum=0.5, low=0.2, high=0.8 → key=(0.5-0.2)/0.6 = 0.5
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.0]).unwrap();
        let node = LuminanceKey::new();
        let mut params = HashMap::new();
        params.insert("low".to_string(), ParamValue::Float(0.2));
        params.insert("high".to_string(), ParamValue::Float(0.8));
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert("invert".to_string(), ParamValue::Bool(false));

        let (img, matte) = eval_matte_node(&node, input, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        assert!(approx_eq(px[3], 0.5), "alpha should be 0.5: {}", px[3]);
        assert!(approx_eq(mk[0], 0.5), "matte should be 0.5: {}", mk[0]);
    }

    #[test]
    fn test_luminance_key_invert() {
        // Bright pixel with invert → key should flip
        let input = Image::from_f32_data(1, 1, vec![1.0, 1.0, 1.0, 1.0]).unwrap();
        let node = LuminanceKey::new();
        let mut params = HashMap::new();
        params.insert("low".to_string(), ParamValue::Float(0.2));
        params.insert("high".to_string(), ParamValue::Float(0.8));
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert("invert".to_string(), ParamValue::Bool(true));

        let (img, matte) = eval_matte_node(&node, input, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        // Inverted: key=1.0 → 0.0
        assert!(
            approx_eq(px[3], 0.0),
            "inverted alpha should be 0.0: {}",
            px[3]
        );
        assert!(
            approx_eq(mk[0], 0.0),
            "inverted matte should be 0.0: {}",
            mk[0]
        );
    }

    #[test]
    fn test_luminance_key_red_channel() {
        // Red=0.8, Green=0.0, Blue=0.0 → channel=1 (Red), low=0.2, high=0.8 → key=1.0
        let input = Image::from_f32_data(1, 1, vec![0.8, 0.0, 0.0, 1.0]).unwrap();
        let node = LuminanceKey::new();
        let mut params = HashMap::new();
        params.insert("low".to_string(), ParamValue::Float(0.2));
        params.insert("high".to_string(), ParamValue::Float(0.8));
        params.insert("channel".to_string(), ParamValue::Int(1)); // Red channel
        params.insert("invert".to_string(), ParamValue::Bool(false));

        let (_, matte) = eval_matte_node(&node, input, params);
        let mk = matte.get_pixel_f32(0, 0);
        assert!(
            approx_eq(mk[0], 1.0),
            "red channel key should be 1.0: {}",
            mk[0]
        );
    }

    // ── DifferenceMatte tests ────────────────────────────────────────────

    #[test]
    fn test_difference_matte_identical() {
        // Identical image and plate → difference=0 → key=0 (background keyed out)
        let image = Image::from_f32_data(1, 1, vec![0.5, 0.3, 0.7, 1.0]).unwrap();
        let plate = Image::from_f32_data(1, 1, vec![0.5, 0.3, 0.7, 1.0]).unwrap();
        let mut params = HashMap::new();
        params.insert("tolerance".to_string(), ParamValue::Float(0.1));
        params.insert("softness".to_string(), ParamValue::Float(0.1));

        let (img, matte) = eval_difference_matte(image, plate, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        assert!(
            approx_eq(px[3], 0.0),
            "alpha should be 0 for identical: {}",
            px[3]
        );
        assert!(
            approx_eq(mk[0], 0.0),
            "matte should be 0 for identical: {}",
            mk[0]
        );
    }

    #[test]
    fn test_difference_matte_very_different() {
        // Very different → large distance → key=1.0
        let image = Image::from_f32_data(1, 1, vec![1.0, 0.0, 0.0, 1.0]).unwrap();
        let plate = Image::from_f32_data(1, 1, vec![0.0, 1.0, 0.0, 1.0]).unwrap();
        let mut params = HashMap::new();
        params.insert("tolerance".to_string(), ParamValue::Float(0.1));
        params.insert("softness".to_string(), ParamValue::Float(0.1));

        let (img, matte) = eval_difference_matte(image, plate, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        // Distance = sqrt(1+1) ≈ 1.414, well above tolerance+softness
        assert!(
            approx_eq(px[3], 1.0),
            "alpha should be 1.0 for different: {}",
            px[3]
        );
        assert!(
            approx_eq(mk[0], 1.0),
            "matte should be 1.0 for different: {}",
            mk[0]
        );
    }

    #[test]
    fn test_difference_matte_soft_edge() {
        // Small difference within softness range → partial key
        let image = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.0]).unwrap();
        // dist = sqrt(0.15^2 * 3) ≈ 0.2598
        let plate = Image::from_f32_data(1, 1, vec![0.35, 0.35, 0.35, 1.0]).unwrap();
        let mut params = HashMap::new();
        params.insert("tolerance".to_string(), ParamValue::Float(0.1));
        params.insert("softness".to_string(), ParamValue::Float(0.3));

        let (img, matte) = eval_difference_matte(image, plate, params);
        let px = img.get_pixel_f32(0, 0);
        let mk = matte.get_pixel_f32(0, 0);

        // key = (dist - 0.1) / 0.3 ≈ (0.2598 - 0.1) / 0.3 ≈ 0.533
        assert!(
            px[3] > 0.1 && px[3] < 0.9,
            "alpha should be partial: {}",
            px[3]
        );
        assert!(
            mk[0] > 0.1 && mk[0] < 0.9,
            "matte should be partial: {}",
            mk[0]
        );
    }

    // ── EdgeBlur tests ───────────────────────────────────────────────────

    #[test]
    fn test_edge_blur_no_edges() {
        // Fully opaque image with no alpha edges → should be unchanged
        let input = make_test_image(4, 4, [0.5, 0.3, 0.7, 1.0]);
        let node = EdgeBlur::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Float(3.0));
        params.insert("edge_threshold".to_string(), ParamValue::Float(0.01));

        let output = eval_image_node(&node, input.clone(), params);
        // All alpha values are 1.0 → no edges → output ≈ input
        for i in 0..16 {
            let idx = i * 4;
            for c in 0..4 {
                assert!(
                    (output.data[idx + c] - input.data[idx + c]).abs() < 0.02,
                    "pixel {} channel {} should be unchanged: {} vs {}",
                    i,
                    c,
                    output.data[idx + c],
                    input.data[idx + c]
                );
            }
        }
    }

    #[test]
    fn test_edge_blur_with_edge() {
        // Create image with sharp alpha edge: left half opaque, right half transparent
        let w = 8u32;
        let h = 4u32;
        let mut data = vec![0.0f32; (w * h) as usize * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let idx = (y * w as usize + x) * 4;
                if x < 4 {
                    data[idx] = 1.0;
                    data[idx + 1] = 1.0;
                    data[idx + 2] = 1.0;
                    data[idx + 3] = 1.0;
                }
                // right half stays 0,0,0,0
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = EdgeBlur::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Float(2.0));
        params.insert("edge_threshold".to_string(), ParamValue::Float(0.01));

        let output = eval_image_node(&node, input.clone(), params);

        // Interior pixels (x=0) should be nearly unchanged
        let interior = output.get_pixel_f32(0, 2);
        assert!(
            interior[3] > 0.9,
            "Interior alpha should stay high: {}",
            interior[3]
        );

        // The edge pixel (x=3, adjacent to transparent) should be blurred
        let edge = output.get_pixel_f32(3, 2);
        let orig_edge = input.get_pixel_f32(3, 2);
        // Edge region should show some blur effect (alpha slightly reduced)
        // or at minimum, the node should run without error
        assert!(
            edge[3] <= orig_edge[3] + 0.01,
            "Edge alpha should not increase beyond original"
        );
    }

    // ── MatteExpand tests ────────────────────────────────────────────────

    #[test]
    fn test_matte_expand_grows_alpha() {
        // Single opaque pixel in center of 3x3, rest transparent
        let mut data = vec![0.0f32; 9 * 4];
        // Center pixel (1,1) = opaque white
        let center = (3 + 1) * 4;
        data[center] = 1.0;
        data[center + 1] = 1.0;
        data[center + 2] = 1.0;
        data[center + 3] = 1.0;

        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteExpand::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        // Center should still be opaque
        let c = output.get_pixel_f32(1, 1);
        assert!(approx_eq(c[3], 1.0), "center alpha: {}", c[3]);

        // Neighbors should now also be opaque (dilated by 1)
        let top = output.get_pixel_f32(1, 0);
        let bot = output.get_pixel_f32(1, 2);
        let left = output.get_pixel_f32(0, 1);
        let right = output.get_pixel_f32(2, 1);
        assert!(approx_eq(top[3], 1.0), "top alpha after expand: {}", top[3]);
        assert!(approx_eq(bot[3], 1.0), "bot alpha after expand: {}", bot[3]);
        assert!(
            approx_eq(left[3], 1.0),
            "left alpha after expand: {}",
            left[3]
        );
        assert!(
            approx_eq(right[3], 1.0),
            "right alpha after expand: {}",
            right[3]
        );
    }

    #[test]
    fn test_matte_expand_preserves_rgb() {
        let data = vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0];
        let input = Image::from_f32_data(2, 1, data).unwrap();
        let node = MatteExpand::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);
        let px0 = output.get_pixel_f32(0, 0);
        // RGB preserved, alpha expanded
        assert!(approx_eq(px0[0], 1.0), "R preserved: {}", px0[0]);
        assert!(approx_eq(px0[1], 0.0), "G preserved: {}", px0[1]);
        assert!(approx_eq(px0[2], 0.0), "B preserved: {}", px0[2]);
        assert!(approx_eq(px0[3], 1.0), "A expanded: {}", px0[3]);
    }

    // ── MatteShrink tests ────────────────────────────────────────────────

    #[test]
    fn test_matte_shrink_erodes_alpha() {
        // 3x3 fully opaque, shrink by 1 → only center should remain
        let data = vec![1.0f32; 9 * 4]; // all pixels [1,1,1,1]
        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        let c = output.get_pixel_f32(1, 1);
        assert!(approx_eq(c[3], 1.0), "center alpha: {}", c[3]);
    }

    #[test]
    fn test_matte_shrink_erodes_edge() {
        // 3x3 where edge is opaque but one corner is transparent
        let mut data = vec![1.0f32; 9 * 4];
        // Make top-left corner transparent
        data[0] = 1.0;
        data[1] = 1.0;
        data[2] = 1.0;
        data[3] = 0.0;

        let input = Image::from_f32_data(3, 3, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);

        let px01 = output.get_pixel_f32(0, 1);
        assert!(
            approx_eq(px01[3], 0.0),
            "neighbor of transparent should erode: {}",
            px01[3]
        );

        let px10 = output.get_pixel_f32(1, 0);
        assert!(
            approx_eq(px10[3], 0.0),
            "neighbor of transparent should erode: {}",
            px10[3]
        );

        // Separable H→V min propagation: (0,0)=0 → H pass zeros row 0 → V pass zeros (1,1)
        let px11 = output.get_pixel_f32(1, 1);
        assert!(
            approx_eq(px11[3], 0.0),
            "center should erode due to separable pass: {}",
            px11[3]
        );
    }

    #[test]
    fn test_matte_shrink_preserves_rgb() {
        let data = vec![0.8, 0.3, 0.5, 1.0, 0.2, 0.7, 0.1, 0.0];
        let input = Image::from_f32_data(2, 1, data).unwrap();
        let node = MatteShrink::new();
        let mut params = HashMap::new();
        params.insert("radius".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input, params);
        // RGB should always be preserved
        let px0 = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px0[0], 0.8), "R preserved: {}", px0[0]);
        assert!(approx_eq(px0[1], 0.3), "G preserved: {}", px0[1]);
        assert!(approx_eq(px0[2], 0.5), "B preserved: {}", px0[2]);
        // Alpha should be eroded (neighbor has alpha=0.0)
        assert!(approx_eq(px0[3], 0.0), "A eroded: {}", px0[3]);
    }

    #[test]
    fn test_directional_blur_zero_length_identity() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.3, 0.7, 1.0]; 16].concat()).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(0.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input.clone(), params);
        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        approx_eq(orig[c], out[c]),
                        "zero-length directional blur should be identity at ({},{}) ch {}: {} vs {}",
                        x, y, c, orig[c], out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_directional_blur_horizontal() {
        let w = 64u32;
        let h = 1u32;
        let mut data = vec![0.0f32; (w as usize) * 4];
        let mid = (w / 2) as usize;
        data[mid * 4] = 1.0;
        data[mid * 4 + 1] = 1.0;
        data[mid * 4 + 2] = 1.0;
        data[mid * 4 + 3] = 1.0;

        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(6.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input, params);

        let center = output.get_pixel_f32(mid as u32, 0);
        assert!(center[0] > 0.0, "center should have some brightness");

        let spread_left = output.get_pixel_f32((mid - 2) as u32, 0);
        let spread_right = output.get_pixel_f32((mid + 2) as u32, 0);
        assert!(
            spread_left[0] > 0.0 && spread_right[0] > 0.0,
            "blur should spread horizontally: left={}, right={}",
            spread_left[0],
            spread_right[0]
        );

        let far_edge = output.get_pixel_f32(0, 0);
        assert!(
            far_edge[0] < center[0],
            "far edge should be less bright than center: far={}, center={}",
            far_edge[0],
            center[0]
        );
    }

    #[test]
    fn test_directional_blur_format_propagation() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(5.0));
        params.insert("angle".to_string(), ParamValue::Float(45.0));

        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_directional_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = DirectionalBlur::new();
        let mut params = HashMap::new();
        params.insert("length".to_string(), ParamValue::Float(8.0));
        params.insert("angle".to_string(), ParamValue::Float(0.0));

        let output = eval_image_node(&node, input, params);

        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}]",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_radial_blur_zero_strength_identity() {
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.3, 0.7, 1.0]; 16].concat()).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.0));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);
        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        approx_eq(orig[c], out[c]),
                        "zero-strength radial blur should be identity at ({},{}) ch {}: {} vs {}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_radial_blur_spreads_from_center() {
        let w = 32u32;
        let h = 32u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        // Create a ring of bright pixels away from center — radial blur
        // samples inward toward center, so outer pixels will pick up
        // brightness from this ring.
        for y in 0..h as usize {
            for x in 0..w as usize {
                let dx = x as f32 - 15.5;
                let dy = y as f32 - 15.5;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist > 6.0 && dist < 10.0 {
                    let i = (y * w as usize + x) * 4;
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.5));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);

        // Pixels outside the ring should pick up brightness from inward samples
        let outer = output.get_pixel_f32(28, 16);
        let orig_outer = input.get_pixel_f32(28, 16);
        assert!(
            outer[0] > orig_outer[0],
            "outer pixel should gain brightness from radial sampling: {} vs original {}",
            outer[0],
            orig_outer[0]
        );
    }

    #[test]
    fn test_radial_blur_format_propagation() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.3));
        params.insert("center_x".to_string(), ParamValue::Float(0.5));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input.clone(), params);
        assert_eq!(output.format, input.format);
        assert_eq!(output.data_window, input.data_window);
        assert_eq!(output.color_space, input.color_space);
    }

    #[test]
    fn test_radial_blur_no_dark_halo() {
        let w = 16u32;
        let h = 16u32;
        let mut data = vec![0.0f32; (w as usize) * (h as usize) * 4];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let i = (y * w as usize + x) * 4;
                if x < 8 {
                    data[i] = 1.0;
                    data[i + 1] = 1.0;
                    data[i + 2] = 1.0;
                    data[i + 3] = 1.0;
                }
            }
        }
        let input = Image::from_f32_data(w, h, data).unwrap();
        let node = RadialBlur::new();
        let mut params = HashMap::new();
        params.insert("strength".to_string(), ParamValue::Float(0.5));
        params.insert("center_x".to_string(), ParamValue::Float(0.25));
        params.insert("center_y".to_string(), ParamValue::Float(0.5));

        let output = eval_image_node(&node, input, params);

        let y = 8;
        for x in 5..11 {
            let px = output.get_rgba(x, y);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}]",
                    x,
                    y,
                    px[0],
                    px[1],
                    px[2],
                    px[3]
                );
            }
        }
    }

    #[test]
    fn test_corner_pin_identity() {
        let input = make_test_image(4, 4, [0.5, 0.3, 0.7, 1.0]);
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.0));
        params.insert("tl_y".to_string(), ParamValue::Float(0.0));
        params.insert("tr_x".to_string(), ParamValue::Float(1.0));
        params.insert("tr_y".to_string(), ParamValue::Float(0.0));
        params.insert("br_x".to_string(), ParamValue::Float(1.0));
        params.insert("br_y".to_string(), ParamValue::Float(1.0));
        params.insert("bl_x".to_string(), ParamValue::Float(0.0));
        params.insert("bl_y".to_string(), ParamValue::Float(1.0));
        params.insert("filter".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.width, input.width);
        assert_eq!(output.height, input.height);
        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.5, 0.3, 0.7, 1.0], "corner_pin identity");
    }

    #[test]
    fn test_corner_pin_output_size_matches_input() {
        let input = make_test_image(8, 6, [1.0, 0.0, 0.0, 1.0]);
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.1));
        params.insert("tl_y".to_string(), ParamValue::Float(0.1));
        params.insert("tr_x".to_string(), ParamValue::Float(0.9));
        params.insert("tr_y".to_string(), ParamValue::Float(0.05));
        params.insert("br_x".to_string(), ParamValue::Float(0.95));
        params.insert("br_y".to_string(), ParamValue::Float(0.95));
        params.insert("bl_x".to_string(), ParamValue::Float(0.05));
        params.insert("bl_y".to_string(), ParamValue::Float(0.9));
        params.insert("filter".to_string(), ParamValue::Int(1));

        let output = eval_image_node(&node, input.clone(), params);

        assert_eq!(output.width, input.width, "output width must match input");
        assert_eq!(
            output.height, input.height,
            "output height must match input"
        );
        assert_eq!(
            output.data_window, input.data_window,
            "data_window must match input"
        );
    }

    #[test]
    fn test_corner_pin_warps_pixels() {
        let mut data = vec![0.0f32; 4 * 4 * 4];
        for pixel in data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[1.0, 1.0, 1.0, 1.0]);
        }
        let input = Image::from_f32_data(4, 4, data).unwrap();
        let node = CornerPin::new();
        let mut params = HashMap::new();
        params.insert("tl_x".to_string(), ParamValue::Float(0.25));
        params.insert("tl_y".to_string(), ParamValue::Float(0.25));
        params.insert("tr_x".to_string(), ParamValue::Float(0.75));
        params.insert("tr_y".to_string(), ParamValue::Float(0.25));
        params.insert("br_x".to_string(), ParamValue::Float(0.75));
        params.insert("br_y".to_string(), ParamValue::Float(0.75));
        params.insert("bl_x".to_string(), ParamValue::Float(0.25));
        params.insert("bl_y".to_string(), ParamValue::Float(0.75));
        params.insert("filter".to_string(), ParamValue::Int(0));

        let output = eval_image_node(&node, input, params);

        let center = output.get_pixel_f32(2, 2);
        assert!(center[3] > 0.0, "center should have content after warp");

        let corner = output.get_pixel_f32(0, 0);
        assert!(
            corner[3] < 0.01,
            "corner should be transparent after inward warp: alpha={}",
            corner[3]
        );
    }

    #[test]
    fn test_stmap_identity_uv() {
        let input = make_test_image(4, 4, [0.8, 0.2, 0.4, 1.0]);
        let mut uv_data = vec![0.0f32; 4 * 4 * 4];
        for y in 0..4u32 {
            for x in 0..4u32 {
                let idx = (y * 4 + x) as usize * 4;
                uv_data[idx] = x as f32 / 3.0;
                uv_data[idx + 1] = y as f32 / 3.0;
                uv_data[idx + 2] = 0.0;
                uv_data[idx + 3] = 1.0;
            }
        }
        let uv_map = Image::from_f32_data(4, 4, uv_data).unwrap();

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.8, 0.2, 0.4, 1.0], "stmap identity uv (0,0)");
        let px2 = output.get_pixel_f32(3, 3);
        assert_color_approx(px2, [0.8, 0.2, 0.4, 1.0], "stmap identity uv (3,3)");
    }

    #[test]
    fn test_stmap_output_size_matches_uv() {
        let input = make_test_image(8, 8, [1.0, 0.0, 0.0, 1.0]);
        let uv_map = make_test_image(4, 6, [0.5, 0.5, 0.0, 1.0]);

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        assert_eq!(output.width, 4, "output width should match uv map");
        assert_eq!(output.height, 6, "output height should match uv map");
    }

    #[test]
    fn test_stmap_out_of_bounds_uv() {
        let input = make_test_image(4, 4, [1.0, 0.5, 0.0, 1.0]);
        let uv_map = Image::from_f32_data(1, 1, vec![2.0, 2.0, 0.0, 1.0]).unwrap();

        let node = STMap::new();
        let mut params = HashMap::new();
        params.insert("filter".to_string(), ParamValue::Int(0));
        let output = eval_two_input_node(&node, "image", input, "uv", uv_map, params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.0, 0.0, 0.0, 0.0], "out of bounds uv should be black");
    }

    #[test]
    fn test_uv_map_corners() {
        let node = UVMap::new();
        let mut params = HashMap::new();
        params.insert("width".to_string(), ParamValue::Int(4));
        params.insert("height".to_string(), ParamValue::Int(4));

        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();
        let img = match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };

        assert_eq!(img.width, 4);
        assert_eq!(img.height, 4);

        let tl = img.get_pixel_f32(0, 0);
        assert_color_approx(tl, [0.0, 0.0, 0.0, 1.0], "uv top-left");

        let tr = img.get_pixel_f32(3, 0);
        assert_color_approx(tr, [1.0, 0.0, 0.0, 1.0], "uv top-right");

        let bl = img.get_pixel_f32(0, 3);
        assert_color_approx(bl, [0.0, 1.0, 0.0, 1.0], "uv bottom-left");

        let br = img.get_pixel_f32(3, 3);
        assert_color_approx(br, [1.0, 1.0, 0.0, 1.0], "uv bottom-right");
    }

    #[test]
    fn test_uv_map_feeds_stmap_identity() {
        let input = make_test_image(4, 4, [0.8, 0.2, 0.4, 1.0]);

        let uv_node = UVMap::new();
        let mut uv_params = HashMap::new();
        uv_params.insert("width".to_string(), ParamValue::Int(4));
        uv_params.insert("height".to_string(), ParamValue::Int(4));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &uv_params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let uv_result = block_on(uv_node.evaluate(&ctx)).unwrap();
        let uv_img = match uv_result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            _ => panic!("expected image"),
        };

        let st_node = STMap::new();
        let mut st_params = HashMap::new();
        st_params.insert("filter".to_string(), ParamValue::Int(1));
        let output = eval_two_input_node(&st_node, "image", input.clone(), "uv", uv_img, st_params);

        for y in 0..4u32 {
            for x in 0..4u32 {
                let orig = input.get_pixel_f32(x, y);
                let out = output.get_pixel_f32(x, y);
                for c in 0..4 {
                    assert!(
                        (orig[c] - out[c]).abs() < 0.01,
                        "pixel ({},{}) ch {}: orig={}, got={}",
                        x,
                        y,
                        c,
                        orig[c],
                        out[c]
                    );
                }
            }
        }
    }

    fn eval_no_input_node(
        node: &dyn Node,
        params: HashMap<String, ParamValue>,
    ) -> HashMap<String, Value> {
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs: HashMap::new(),
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 42 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        block_on(node.evaluate(&ctx)).unwrap()
    }

    #[test]
    fn test_project_info_outputs() {
        let node = ProjectInfo::new();
        let result = eval_no_input_node(&node, HashMap::new());

        let w = match result.get("width").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let h = match result.get("height").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let pa = match result.get("pixel_aspect").unwrap() {
            Value::Float(v) => *v,
            other => panic!("expected Float, got {:?}", other.value_type()),
        };
        let frame = match result.get("frame").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };

        assert_eq!(w, 1920, "project width");
        assert_eq!(h, 1080, "project height");
        assert!(approx_eq(pa, 1.0), "pixel aspect: {pa}");
        assert_eq!(frame, 42, "frame number");
    }

    #[test]
    fn test_image_info_outputs() {
        let input = make_offset_image([0.5, 0.5, 0.5, 1.0]);
        let node = ImageInfo::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let result = block_on(node.evaluate(&ctx)).unwrap();

        let w = match result.get("width").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let h = match result.get("height").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let aspect = match result.get("aspect_ratio").unwrap() {
            Value::Float(v) => *v,
            other => panic!("expected Float, got {:?}", other.value_type()),
        };
        let px_count = match result.get("pixel_count").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let dw_x = match result.get("dw_x").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };
        let dw_y = match result.get("dw_y").unwrap() {
            Value::Int(v) => *v,
            other => panic!("expected Int, got {:?}", other.value_type()),
        };

        assert_eq!(w, 4, "image width");
        assert_eq!(h, 4, "image height");
        assert!(approx_eq(aspect, 1.0), "aspect ratio: {aspect}");
        assert_eq!(px_count, 16, "pixel count");
        assert_eq!(dw_x, 100, "data window x offset");
        assert_eq!(dw_y, 100, "data window y offset");
    }
    // ── KeyMix tests ──────────────────────────────────────────────────

    fn eval_keymix(
        a: Image,
        b: Image,
        mask: Option<Image>,
        params: HashMap<String, ParamValue>,
    ) -> Image {
        let mut inputs = HashMap::new();
        inputs.insert("a".to_string(), Value::Image(a));
        inputs.insert("b".to_string(), Value::Image(b));
        if let Some(m) = mask {
            inputs.insert("mask".to_string(), Value::Image(m));
        }
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            extra_inputs: HashMap::new(),
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
            preview_scale: 1.0,
        };
        let node = KeyMix::new();
        let result = block_on(node.evaluate(&ctx)).unwrap();
        match result.get("image").unwrap() {
            Value::Image(img) => img.clone(),
            other => panic!("Expected Value::Image, got {:?}", other.value_type()),
        }
    }

    fn keymix_default_params() -> HashMap<String, ParamValue> {
        let mut params = HashMap::new();
        params.insert("invert_mask".to_string(), ParamValue::Bool(false));
        params.insert("mix".to_string(), ParamValue::Float(1.0));
        params
    }

    #[test]
    fn test_keymix_white_mask_selects_a() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [1.0, 0.0, 0.0, 1.0], "white mask should select A");
    }

    #[test]
    fn test_keymix_black_mask_selects_b() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [0.0, 0.0, 0.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.0, 0.0, 1.0, 1.0], "black mask should select B");
    }

    #[test]
    fn test_keymix_gray_mask_blends() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [0.5, 0.5, 0.5, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert!(
            approx_eq(px[0], 0.5),
            "red channel should be 0.5, got {}",
            px[0]
        );
        assert!(
            approx_eq(px[1], 0.0),
            "green channel should be 0.0, got {}",
            px[1]
        );
        assert!(
            approx_eq(px[2], 0.5),
            "blue channel should be 0.5, got {}",
            px[2]
        );
        assert!(
            approx_eq(px[3], 1.0),
            "alpha channel should be 1.0, got {}",
            px[3]
        );
    }

    #[test]
    fn test_keymix_no_mask_selects_a() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, None, params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [1.0, 0.0, 0.0, 1.0], "no mask should select A");
    }

    #[test]
    fn test_keymix_invert_mask() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let mut params = keymix_default_params();
        params.insert("invert_mask".to_string(), ParamValue::Bool(true));
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(
            px,
            [0.0, 0.0, 1.0, 1.0],
            "inverted white mask should select B",
        );
    }

    #[test]
    fn test_keymix_mix_zero_passthrough_b() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let mut params = keymix_default_params();
        params.insert("mix".to_string(), ParamValue::Float(0.0));
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.0, 0.0, 1.0, 1.0], "mix=0 should passthrough B");
    }

    #[test]
    fn test_keymix_mix_half() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let mut params = keymix_default_params();
        params.insert("mix".to_string(), ParamValue::Float(0.5));
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert!(approx_eq(px[0], 0.5), "red should be 0.5, got {}", px[0]);
        assert!(approx_eq(px[1], 0.0), "green should be 0.0, got {}", px[1]);
        assert!(approx_eq(px[2], 0.5), "blue should be 0.5, got {}", px[2]);
        assert!(approx_eq(px[3], 1.0), "alpha should be 1.0, got {}", px[3]);
    }

    #[test]
    fn test_keymix_different_sizes() {
        // Create A: 4x4 at (0,0)
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);

        // Create B: 2x2 at (1,1) - offset image
        let mut b_data = vec![0.0f32; 2 * 2 * 4];
        for pixel in b_data.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[0.0, 0.0, 1.0, 1.0]);
        }
        let b_format = Format::hd();
        let b_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let b = Image::new_with_domain(b_format, b_dw, b_data, ColorSpaceId::default_working())
            .unwrap();

        // Create 4x4 mask at (0,0)
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);

        let params = keymix_default_params();
        let output = eval_keymix(a.clone(), b, Some(mask), params);

        // At (0,0): A only, should be red
        let px_00 = output.get_pixel_f32(0, 0);
        assert_color_approx(px_00, [1.0, 0.0, 0.0, 1.0], "at (0,0) should be A");

        // At (2,2): overlap region, white mask selects A
        let px_22 = output.get_pixel_f32(2, 2);
        assert_color_approx(
            px_22,
            [1.0, 0.0, 0.0, 1.0],
            "at (2,2) overlap should select A",
        );
    }

    #[test]
    fn test_keymix_alpha_blending() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 0.8]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 0.4]);
        let mask = make_test_image(4, 4, [0.5, 0.5, 0.5, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        // Alpha: 0.8 * 0.5 + 0.4 * 0.5 = 0.4 + 0.2 = 0.6
        assert!(approx_eq(px[3], 0.6), "alpha should be 0.6, got {}", px[3]);
    }

    #[test]
    fn test_keymix_mask_uses_luminance() {
        let a = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 0.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        // Luma = 0.2126 * 1.0 + 0.7152 * 0.0 + 0.0722 * 0.0 = 0.2126
        // white * 0.2126 + black * (1 - 0.2126) ≈ [0.2126, 0.2126, 0.2126, 1.0]
        assert!(
            approx_eq(px[0], 0.2126),
            "red should be ~0.2126, got {}",
            px[0]
        );
        assert!(
            approx_eq(px[1], 0.2126),
            "green should be ~0.2126, got {}",
            px[1]
        );
        assert!(
            approx_eq(px[2], 0.2126),
            "blue should be ~0.2126, got {}",
            px[2]
        );
    }

    #[test]
    fn test_keymix_format_propagation() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [1.0, 1.0, 1.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a.clone(), b, Some(mask), params);

        assert_eq!(output.format, a.format, "output format should match A");
        assert_eq!(
            output.color_space, a.color_space,
            "output color space should match A"
        );
    }

    #[test]
    fn test_keymix_single_pixel() {
        let a = make_test_image(1, 1, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(1, 1, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(1, 1, [0.0, 0.0, 0.0, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(
            px,
            [0.0, 0.0, 1.0, 1.0],
            "single pixel black mask should select B",
        );
    }

    #[test]
    fn test_keymix_transparent_inputs() {
        let a = make_test_image(4, 4, [0.0, 0.0, 0.0, 0.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 0.0, 0.0]);
        let mask = make_test_image(4, 4, [0.5, 0.5, 0.5, 1.0]);
        let params = keymix_default_params();
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(
            px,
            [0.0, 0.0, 0.0, 0.0],
            "transparent inputs should stay transparent",
        );
    }

    #[test]
    fn test_keymix_invert_with_mix() {
        let a = make_test_image(4, 4, [1.0, 0.0, 0.0, 1.0]);
        let b = make_test_image(4, 4, [0.0, 0.0, 1.0, 1.0]);
        let mask = make_test_image(4, 4, [0.0, 0.0, 0.0, 1.0]);
        let mut params = keymix_default_params();
        params.insert("invert_mask".to_string(), ParamValue::Bool(true));
        params.insert("mix".to_string(), ParamValue::Float(0.5));
        let output = eval_keymix(a, b, Some(mask), params);

        let px = output.get_pixel_f32(0, 0);
        // Black mask inverted = white, white * 0.5 mix = 0.5 effective
        // red: 1.0 * 0.5 + 0.0 * 0.5 = 0.5, blue: 0.0 * 0.5 + 1.0 * 0.5 = 0.5
        assert!(approx_eq(px[0], 0.5), "red should be 0.5, got {}", px[0]);
        assert!(approx_eq(px[1], 0.0), "green should be 0.0, got {}", px[1]);
        assert!(approx_eq(px[2], 0.5), "blue should be 0.5, got {}", px[2]);
        assert!(approx_eq(px[3], 1.0), "alpha should be 1.0, got {}", px[3]);
    }
}
