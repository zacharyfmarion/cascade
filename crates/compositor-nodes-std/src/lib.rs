use compositor_core::node::NodeRegistry;
use std::sync::Arc;

pub mod blend;
pub mod ai;
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

pub use blend::{AlphaOver, Blend};
pub use ai::AiInpaint;
pub use color::{
    BrightnessContrast, ColorRampNode, CombineHsva, HueSaturation, Invert, SeparateHsva,
};
pub use color_convert::ColorConvert;
pub use color_ops::{ChannelShuffle, ColorBalance, Curves, Gamma, Levels, Posterize, Threshold};
pub use filter::GaussianBlur;
pub use filter_ops::{Dilate, EdgeDetect, Erode, Median, Sharpen};
pub use generate::{
    Checkerboard, ColorConstant, FloatConstant, Gradient, IntegerConstant, Noise, RasterizeField,
    SolidColor,
};
pub use group::{GroupInputNode, GroupNode, GroupOutputNode};
pub use input::{LoadImage, LoadImageSequence, SequenceInfo};
pub use matte::{ChromaKey, ExtractChannel, Premultiply, SetAlpha, Unpremultiply};
pub use palette::ColorPaletteNode;
pub use output::{ExportImageSequence, ExportVideo, Viewer};
pub use script::GpuScriptDraftNode;
pub use transform::{Crop, Flip, Resize, Rotate, Transform2D, Translate};
pub use utility::{MapRange, MathNode};

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
    registry.register("color_ramp", || Arc::new(ColorRampNode::new()));
    registry.register("color_palette", || Arc::new(ColorPaletteNode::new()));
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
    registry.register("color_constant", || Arc::new(ColorConstant::new()));

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

    #[test]
    fn test_curves_field_passthrough() {
        let node = Curves::new();
        let mut params = HashMap::new();
        params.insert("black_point".to_string(), ParamValue::Float(0.0));
        params.insert("shadows".to_string(), ParamValue::Float(0.25));
        params.insert("midtones".to_string(), ParamValue::Float(0.5));
        params.insert("highlights".to_string(), ParamValue::Float(0.75));
        params.insert("white_point".to_string(), ParamValue::Float(1.0));
        let value = eval_field_passthrough(&node, [0.5, 0.5, 0.5, 1.0], params);
        let sampled = sample_field(&value);
        assert_color_approx(sampled, [0.5, 0.5, 0.5, 1.0], "curves");
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
        assert_eq!(output.data_window, input.data_window, "data_window must propagate");
        // Dimensions must still match
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);
        // Color space must be preserved
        assert_eq!(output.color_space, input.color_space, "color_space must propagate");
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

        assert_eq!(output.format, input.format, "format must propagate through invert");
        assert_eq!(output.data_window, input.data_window, "data_window must propagate through invert");
        assert_eq!(output.color_space, input.color_space, "color_space must propagate through invert");

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
        assert_eq!(after_invert.format, original_format, "format lost after invert");
        assert_eq!(after_invert.data_window, original_dw, "data_window lost after invert");

        // Step 2: BrightnessContrast
        let mut bc_params = HashMap::new();
        bc_params.insert("brightness".to_string(), ParamValue::Float(0.0));
        bc_params.insert("contrast".to_string(), ParamValue::Float(0.0));
        let after_bc = eval_image_node(&BrightnessContrast::new(), after_invert, bc_params);
        assert_eq!(after_bc.format, original_format, "format lost after brightness/contrast");
        assert_eq!(after_bc.data_window, original_dw, "data_window lost after brightness/contrast");

        // Step 3: Gamma
        let mut gamma_params = HashMap::new();
        gamma_params.insert("gamma".to_string(), ParamValue::Float(1.0));
        let after_gamma = eval_image_node(&Gamma::new(), after_bc, gamma_params);
        assert_eq!(after_gamma.format, original_format, "format lost after gamma");
        assert_eq!(after_gamma.data_window, original_dw, "data_window lost after gamma");
        assert_eq!(after_gamma.color_space, original_cs, "color_space lost after gamma");
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

        assert_eq!(output.format, input.format, "format must propagate through blur");
        assert_eq!(output.data_window, input.data_window, "data_window must propagate through blur");
        assert_eq!(output.color_space, input.color_space, "color_space must propagate through blur");
        assert_eq!(output.width, 4);
        assert_eq!(output.height, 4);
    }

    #[test]
    fn test_format_propagation_premultiply() {
        let input = make_offset_image([0.5, 0.5, 0.5, 0.5]);
        let node = Premultiply::new();

        let output = eval_image_node(&node, input.clone(), HashMap::new());

        assert_eq!(output.format, input.format, "format must propagate through premultiply");
        assert_eq!(output.data_window, input.data_window, "data_window must propagate through premultiply");
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

    #[test]
    fn test_alpha_over_same_size_images() {
        let bg = Image::from_f32_data(2, 2, vec![0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0,
                                                   0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0]);
        let fg = Image::from_f32_data(2, 2, vec![1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5,
                                                   1.0, 0.0, 0.0, 0.5, 1.0, 0.0, 0.0, 0.5]);
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
        let fg_dw = RectI { min: IVec2::new(1, 1), max: IVec2::new(3, 3) };
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
        assert!(approx_eq(px00[2], 1.0) && approx_eq(px00[0], 0.0),
            "top-left should be blue: {:?}", px00);

        // (1,1) = fg is opaque red (alpha=1) → completely overrides bg
        let px11 = output.get_rgba(1, 1);
        assert!(approx_eq(px11[0], 1.0) && approx_eq(px11[2], 0.0),
            "center should be red: {:?}", px11);

        // (3,3) = bg only again (fg data_window is half-open, doesn't include 3)
        let px33 = output.get_rgba(3, 3);
        assert!(approx_eq(px33[2], 1.0) && approx_eq(px33[0], 0.0),
            "bottom-right should be blue: {:?}", px33);
    }

    #[test]
    fn test_alpha_over_non_overlapping_images() {
        // A: red at (0,0)→(2,2)
        let a = Image::from_f32_data(2, 2, vec![[1.0f32, 0.0, 0.0, 1.0]; 4].concat());

        // B: green at (10,10)→(12,12) — completely separate
        let b_dw = RectI { min: IVec2::new(10, 10), max: IVec2::new(12, 12) };
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
        assert!(approx_eq(px_gap[3], 0.0), "gap should be transparent: {:?}", px_gap);
    }

    #[test]
    fn test_blend_different_size_images() {
        // Base: 4x4 mid-gray
        let base = Image::from_f32_data(4, 4, vec![[0.5f32, 0.5, 0.5, 1.0]; 16].concat());

        // Blend: 2x2 white at (1,1)→(3,3)
        let bl_dw = RectI { min: IVec2::new(1, 1), max: IVec2::new(3, 3) };
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

        // (1,1): base=0.5, blend=1.0. Add: 0.5+1.0=1.0 (clamped)
        let px11 = output.get_rgba(1, 1);
        assert!(approx_eq(px11[0], 1.0), "inside blend region: {:?}", px11);
    }

    #[test]
    fn test_alpha_over_format_from_background() {
        let bg_format = Format::hd();
        let bg_dw = RectI { min: IVec2::new(10, 10), max: IVec2::new(14, 14) };
        let bg = Image::new_with_domain(
            bg_format.clone(), bg_dw,
            vec![0.0f32; 64],
            ColorSpaceId::new(ColorSpaceId::ACESCG),
        );

        let fg = Image::from_f32_data(2, 2, vec![0.0f32; 16]);

        let node = AlphaOver::new();
        let mut params = HashMap::new();
        params.insert("opacity".to_string(), ParamValue::Float(1.0));

        let output = eval_two_input_node(&node, "background", bg.clone(), "foreground", fg, params);

        assert_eq!(output.format, bg_format, "format should come from background");
        assert_eq!(output.color_space.as_str(), ColorSpaceId::ACESCG, "color_space from background");
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
        assert_color_approx(px, [0.0, 0.0, 0.0, 0.0], "non-overlapping crop is transparent");
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

        assert!(output.width > input.width || output.height > input.height,
            "rotated image should expand: {}x{} vs {}x{}",
            output.width, output.height, input.width, input.height);
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

        assert!((out_center_x - in_center_x).abs() < 1.5, "center X preserved: {} vs {}", out_center_x, in_center_x);
        assert!((out_center_y - in_center_y).abs() < 1.5, "center Y preserved: {} vs {}", out_center_y, in_center_y);
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

        assert!(output.data_window.width_u32() >= input.data_window.width_u32() * 2 - 1,
            "scaled width: {} vs input {}",
            output.data_window.width_u32(), input.data_window.width_u32());
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
}
