use compositor_core::node::NodeRegistry;
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
pub mod transform;
pub mod utility;

pub use ai::AiInpaint;
pub use blend::{AlphaOver, Blend, Merge};
pub use color::{
    BrightnessContrast, ColorRampNode, CombineHsva, HueSaturation, Invert, SeparateHsva,
};
pub use color_convert::ColorConvert;
pub use color_ops::{ChannelShuffle, Clamp, ColorBalance, Curves, Gamma, Grade, Levels, Posterize, Threshold};
pub use filter::GaussianBlur;
pub use filter_ops::{Dilate, EdgeDetect, Erode, Median, Sharpen};
pub use generate::{
    Checkerboard, ColorConstant, FloatConstant, Gradient, IntegerConstant, Noise, RasterizeField,
    SolidColor, Text,
};
pub use group::{GroupInputNode, GroupNode, GroupOutputNode};
pub use input::{LoadImage, LoadImageSequence, SequenceInfo};
pub use matte::{ChromaKey, CombineRgba, CopyChannels, ExtractChannel, Premultiply, SeparateRgba, SetAlpha, Unpremultiply};
pub use output::{ExportImageSequence, ExportVideo, Viewer};
pub use palette::ColorPaletteNode;
pub use script::GpuScriptDraftNode;
pub use transform::{Crop, Flip, Resize, Rotate, Transform2D, Translate};
pub use utility::{Dot, MapRange, MathNode};

pub fn register_standard_nodes(registry: &mut NodeRegistry) {
    // Input/Output
    registry.register("load_image", || Arc::new(LoadImage::new()));
    registry.register("load_image_sequence", || Arc::new(LoadImageSequence::new()));
    registry.register("viewer", || Arc::new(Viewer::new()));

    registry.register("ai_inpaint", || Arc::new(AiInpaint::new()));

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
    registry.register("dot", || Arc::new(Dot::new()));

    // Filter
    registry.register("gaussian_blur", || Arc::new(GaussianBlur::new()));
    registry.register("sharpen", || Arc::new(Sharpen::new()));
    registry.register("edge_detect", || Arc::new(EdgeDetect::new()));
    registry.register("dilate", || Arc::new(Dilate::new()));
    registry.register("erode", || Arc::new(Erode::new()));
    registry.register("median", || Arc::new(Median::new()));

    // Composite
    registry.register("blend", || Arc::new(Blend::new()));
    registry.register("alpha_over", || Arc::new(AlphaOver::new()));
    registry.register("merge", || Arc::new(Merge::new()));

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
    registry.register("color_constant", || Arc::new(ColorConstant::new()));
    registry.register("text", || Arc::new(Text::new()));

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
    use compositor_core::color::BuiltinColorManagement;
    use compositor_core::node::{EvalContext, Node};
    use compositor_core::types::*;
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
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
            "{}: expected {:?}, got {:?}",
            msg,
            expected,
            actual
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
        let identity = vec![
            CurvePoint { x: 0.0, y: 0.0 },
            CurvePoint { x: 1.0, y: 1.0 },
        ];
        let mut params = HashMap::new();
        params.insert("channel".to_string(), ParamValue::Int(0));
        params.insert("master_curve".to_string(), ParamValue::CurvePoints(identity.clone()));
        params.insert("red_curve".to_string(), ParamValue::CurvePoints(identity.clone()));
        params.insert("green_curve".to_string(), ParamValue::CurvePoints(identity.clone()));
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
            [result.data[0], result.data[1], result.data[2], result.data[3]],
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
        assert!(r < 0.5, "master curve should darken midtones, got r={}", r);
        assert!((r - 0.3).abs() < 0.02, "expected ~0.3, got r={}", r);
        assert!((r - g).abs() < 0.001, "master should affect all channels equally");
        assert!((r - b).abs() < 0.001, "master should affect all channels equally");
        // Alpha unchanged
        assert!((result.data[3] - 1.0).abs() < 0.001, "alpha should be unchanged");
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
        assert!(r > 0.6, "red curve should lift red midtones, got r={}", r);
        // Green and blue should be unchanged (identity curve)
        assert!((g - 0.5).abs() < 0.01, "green should be unchanged, got g={}", g);
        assert!((b - 0.5).abs() < 0.01, "blue should be unchanged, got b={}", b);
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
                out >= -0.01 && out <= 1.01,
                "monotone cubic should not overshoot: input={}, output={}",
                input_val,
                out
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
        Image::from_f32_data(w, h, data)
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
        Image::new_with_domain(format, data_window, data, ColorSpaceId::default_working())
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
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
            "brightness should be applied: got {:?}",
            px
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
            "invert should work correctly: got {:?}",
            px
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
        );

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
            "premultiply should work: got {:?}",
            px
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
            "inside data_window should return red: got {:?}",
            inside
        );

        // Outside data_window
        let outside = input.get_rgba(0, 0);
        assert!(
            approx_eq(outside[0], 0.0) && approx_eq(outside[3], 0.0),
            "outside data_window should return transparent black: got {:?}",
            outside
        );

        // Just outside boundary
        let edge = input.get_rgba(104, 104); // max is exclusive
        assert!(
            approx_eq(edge[0], 0.0) && approx_eq(edge[3], 0.0),
            "at max boundary (exclusive) should return transparent black: got {:?}",
            edge
        );
    }

    #[test]
    fn test_pixel_correctness_independent_of_offset() {
        // An image processed with data_window at (0,0) should produce
        // identical pixel values as one at (100,100)
        let color = [0.3, 0.6, 0.9, 1.0];

        // Zero-origin image
        let zero_origin = Image::from_f32_data(4, 4, vec![color; 16].concat());

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
                "pixel {} differs: zero={:?} offset={:?}",
                i,
                px_zero,
                px_offset
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
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
            [
                a[0] * b[0],
                a[1] * b[1],
                a[2] * b[2],
                out_a.clamp(0.0, 1.0),
            ]
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
        let a = Image::from_f32_data(1, 1, a_color.to_vec());
        let b = Image::from_f32_data(1, 1, b_color.to_vec());
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
        );
        let fg = Image::from_f32_data(
            2,
            2,
            vec![
                1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5,
            ],
        );
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
        let bg = Image::from_f32_data(4, 4, bg_data);

        // FG: 2x2 red at (1,1)→(3,3), offset within the BG
        let fg_data = vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat();
        let fg_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let fg = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            fg_dw,
            fg_data,
            ColorSpaceId::default_working(),
        );

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
            "top-left should be blue: {:?}",
            px00
        );

        // (1,1) = fg is opaque red (alpha=1) → completely overrides bg
        let px11 = output.get_rgba(1, 1);
        assert!(
            approx_eq(px11[0], 1.0) && approx_eq(px11[2], 0.0),
            "center should be red: {:?}",
            px11
        );

        // (3,3) = bg only again (fg data_window is half-open, doesn't include 3)
        let px33 = output.get_rgba(3, 3);
        assert!(
            approx_eq(px33[2], 1.0) && approx_eq(px33[0], 0.0),
            "bottom-right should be blue: {:?}",
            px33
        );
    }

    #[test]
    fn test_alpha_over_non_overlapping_images() {
        // A: red at (0,0)→(2,2)
        let a = Image::from_f32_data(2, 2, vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat());

        // B: green at (10,10)→(12,12) — completely separate
        let b_dw = RectI {
            min: IVec2::new(10, 10),
            max: IVec2::new(12, 12),
        };
        let b = Image::new_with_domain(
            Format::from_dimensions(20, 20),
            b_dw,
            vec![[0.0f32, 1.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );

        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", a, "foreground", b, params);

        // Union = (0,0)→(12,12) = 12x12
        assert_eq!(output.width, 12);
        assert_eq!(output.height, 12);

        // (0,0) = only bg (red)
        let px_a = output.get_rgba(0, 0);
        assert!(approx_eq(px_a[0], 1.0), "should be red: {:?}", px_a);

        // (10,10) = only fg (green, alpha=1 → overrides transparent bg)
        let px_b = output.get_rgba(10, 10);
        assert!(approx_eq(px_b[1], 1.0), "should be green: {:?}", px_b);

        // (5,5) = neither has data → transparent black
        let px_gap = output.get_rgba(5, 5);
        assert!(
            approx_eq(px_gap[3], 0.0),
            "gap should be transparent: {:?}",
            px_gap
        );
    }

    #[test]
    fn test_merge_porter_duff_vs_reference() {
        let test_pixels: Vec<([f32; 4], [f32; 4], &str)> = vec![
            ([1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0], "opaque red over opaque blue"),
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
            ([0.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0], "both transparent"),
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

        let operations: Vec<(i64, &str, fn([f32; 4], f32, [f32; 4], f32) -> [f32; 4])> = vec![
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
            vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
        let b = Image::new_with_domain(
            format,
            b_dw,
            vec![[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
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
            vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
        let b = Image::new_with_domain(
            format,
            b_dw,
            vec![[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
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
            vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
        let b = Image::new_with_domain(
            format,
            b_dw,
            vec![[0.0f32, 0.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );
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
        let b = Image::from_f32_data(4, 4, bg_data);

        let a_data = vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat();
        let a_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let a = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            a_dw,
            a_data,
            ColorSpaceId::default_working(),
        );

        let node = Merge::new();
        let output = eval_two_input_node(&node, "A", a, "B", b, merge_params(0, 0, 1.0, 1.0));

        assert_eq!(output.data_window.min, IVec2::new(0, 0));
        assert_eq!(output.data_window.max, IVec2::new(4, 4));
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);

        let px00 = output.get_rgba(0, 0);
        assert!(
            approx_eq(px00[2], 1.0) && approx_eq(px00[0], 0.0),
            "outside A region should be blue: {:?}",
            px00
        );

        let px11 = output.get_rgba(1, 1);
        assert!(
            approx_eq(px11[0], 1.0) && approx_eq(px11[2], 0.0),
            "inside A region should be red: {:?}",
            px11
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
        let a = Image::from_f32_data(1, 1, vec![1.0, 0.0, 0.0, 1.0]);
        let b = Image::from_f32_data(1, 1, vec![0.0, 0.0, 1.0, 1.0]);
        let node = Merge::new();

        let output = eval_two_input_node(&node, "A", a, "B", b, merge_params(0, 0, 1.0, 0.25));

        let px = output.get_pixel_f32(0, 0);
        assert_color_approx(px, [0.25, 0.0, 0.75, 1.0], "merge mix");
    }

    #[test]
    fn test_blend_different_size_images() {
        // Base: 4x4 mid-gray
        let base = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat());

        // Blend: 2x2 white at (1,1)→(3,3)
        let bl_dw = RectI {
            min: IVec2::new(1, 1),
            max: IVec2::new(3, 3),
        };
        let bl = Image::new_with_domain(
            Format::from_dimensions(4, 4),
            bl_dw,
            vec![[1.0f32, 1.0, 1.0, 1.0]; 4].concat(),
            ColorSpaceId::default_working(),
        );

        let node = Blend::new();
        let mut params = HashMap::new();
        params.insert("mode".to_string(), ParamValue::Int(1)); // Add mode
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "base", base, "blend_input", bl, params);

        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);

        // (0,0): base=0.5, blend=transparent black (0.0). Add: 0.5+0.0=0.5
        let px00 = output.get_rgba(0, 0);
        assert!(approx_eq(px00[0], 0.5), "outside blend region: {:?}", px00);

        // (1,1): base=0.5, blend=1.0. Add: 0.5+1.0=1.5 (HDR, no clamp)
        let px11 = output.get_rgba(1, 1);
        assert!(approx_eq(px11[0], 1.5), "inside blend region: {:?}", px11);
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
        );

        let fg = Image::from_f32_data(2, 2, vec![0.0f32; 16]);

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
    fn test_crop_no_overlap_produces_empty() {
        let input = make_offset_image([1.0, 0.0, 0.0, 1.0]);

        let node = Crop::new();
        let mut params = HashMap::new();
        params.insert("x".to_string(), ParamValue::Int(200));
        params.insert("y".to_string(), ParamValue::Int(200));
        params.insert("width".to_string(), ParamValue::Int(10));
        params.insert("height".to_string(), ParamValue::Int(10));

        let output = eval_image_node(&node, input, params);

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
        let input = Image::from_f32_data(4, 4, vec![[1.0f32, 0.0, 0.0, 1.0]; 16].concat());

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
            "center X preserved: {} vs {}",
            out_center_x,
            in_center_x
        );
        assert!(
            (out_center_y - in_center_y).abs() < 1.5,
            "center Y preserved: {} vs {}",
            out_center_y,
            in_center_y
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
        let input = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat());

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
        let input = Image::from_f32_data(2, 2, vec![
            0.1, 0.2, 0.3, 0.4,
            0.5, 0.6, 0.7, 0.8,
            0.9, 0.0, 0.1, 1.0,
            0.0, 1.0, 0.0, 0.5,
        ]);
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
        assert!(approx_eq(green.get_pixel_f32(0, 0)[0], 0.2), "green ch pixel 0");
        assert!(approx_eq(blue.get_pixel_f32(0, 0)[0], 0.3), "blue ch pixel 0");
        assert!(approx_eq(alpha.get_pixel_f32(0, 0)[0], 0.4), "alpha ch pixel 0");
        assert!(approx_eq(red.get_pixel_f32(1, 0)[0], 0.5), "red ch pixel 1");
        // All channel outputs should have alpha = 1.0
        assert!(approx_eq(red.get_pixel_f32(0, 0)[3], 1.0), "red output alpha");
        // Format should propagate
        assert_eq!(red.format, input.format);
        assert_eq!(red.data_window, input.data_window);
    }

    #[test]
    fn test_separate_combine_rgba_roundtrip() {
        // Separate then Combine should reconstruct the original channels
        let input = Image::from_f32_data(2, 2, vec![
            0.1, 0.2, 0.3, 0.4,
            0.5, 0.6, 0.7, 0.8,
            0.9, 0.0, 0.1, 1.0,
            0.0, 1.0, 0.0, 0.5,
        ]);
        // Step 1: Separate
        let sep = SeparateRgba::new();
        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(input.clone()));
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
            params: &HashMap::new(),
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
                        x, y, c, orig[c], out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_copy_channels_identity() {
        // Default params (A.R, A.G, A.B, A.A) should pass through A unchanged
        let a = Image::from_f32_data(2, 2, vec![
            0.1, 0.2, 0.3, 0.4,
            0.5, 0.6, 0.7, 0.8,
            0.9, 0.0, 0.1, 1.0,
            0.0, 1.0, 0.0, 0.5,
        ]);
        let b = Image::from_f32_data(2, 2, vec![1.0f32; 16]);
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(0));   // A.R
        params.insert("green".to_string(), ParamValue::Int(1)); // A.G
        params.insert("blue".to_string(), ParamValue::Int(2));  // A.B
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
                        x, y, c, orig[c], out[c]
                    );
                }
            }
        }
    }

    #[test]
    fn test_copy_channels_swap_from_b() {
        // Take RGB from B, Alpha from A
        let a = Image::from_f32_data(1, 1, vec![0.1, 0.2, 0.3, 0.9]);
        let b = Image::from_f32_data(1, 1, vec![0.7, 0.8, 0.9, 0.0]);
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(4));   // B.R
        params.insert("green".to_string(), ParamValue::Int(5)); // B.G
        params.insert("blue".to_string(), ParamValue::Int(6));  // B.B
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
        let a = Image::from_f32_data(1, 1, vec![0.1, 0.2, 0.3, 0.4]);
        let b = Image::from_f32_data(1, 1, vec![0.5, 0.6, 0.7, 0.8]);
        let node = CopyChannels::new();
        let mut params = HashMap::new();
        params.insert("red".to_string(), ParamValue::Int(2));   // A.B
        params.insert("green".to_string(), ParamValue::Int(7)); // B.A
        params.insert("blue".to_string(), ParamValue::Int(0));  // A.R
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
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.3, 0.7, 0.9]);
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
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.0]);
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
        let input = Image::from_f32_data(1, 1, vec![0.4, 0.6, 0.8, 1.0]);
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
        let input = Image::from_f32_data(1, 1, vec![0.25, 0.5, 0.5, 1.0]);
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
        let input = Image::from_f32_data(1, 1, vec![-0.1, 1.5, 0.5, 2.0]);
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
        let input = Image::from_f32_data(1, 1, vec![0.5, 0.5, 0.5, 1.5]);
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
        let input = Image::from_f32_data(1, 1, vec![0.0, 0.5, 1.0, 1.0]);
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

        Image::from_f32_data(img.width, img.height, out)
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

        let input = Image::from_f32_data(w, h, data);

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
                sigma, max_rgb_diff, worst_pixel.0, worst_pixel.1,
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
                "sigma={}: Alpha diff too large: {:.4}",
                sigma, max_a_diff,
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

        let input = Image::from_f32_data(w, h, data);
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
            let px = output.get_rgba(x as i32, y as i32);
            if px[3] > 0.01 {
                assert!(
                    px[0] > 0.8 && px[1] > 0.8 && px[2] > 0.8,
                    "Dark halo at ({},{}): rgba=[{:.3},{:.3},{:.3},{:.3}] — \
                     RGB should be close to 1.0 for pixels with alpha > 0",
                    x, y, px[0], px[1], px[2], px[3]
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
        params.insert(
            "color".to_string(),
            ParamValue::Color([1.0, 1.0, 1.0, 1.0]),
        );
        params.insert("width".to_string(), ParamValue::Int(128));
        params.insert("height".to_string(), ParamValue::Int(64));
        params.insert("align".to_string(), ParamValue::Int(1));
        let inputs = HashMap::new();
        let cm = BuiltinColorManagement::new();
        let format = Format::hd();
        let ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
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
                1.0, 0.5, 0.25, 1.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.1, 0.2, 0.3,
                0.4,
            ],
        );
        let node = Dot::new();
        let output = eval_image_node(&node, input.clone(), HashMap::new());
        assert_eq!(output.data, input.data);
    }
}
