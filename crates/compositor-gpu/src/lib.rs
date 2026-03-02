pub mod context;
pub mod kernel_node;
pub mod kuwahara;
pub mod manifest;
pub mod template;
pub mod transpile;

use std::sync::Arc;

use compositor_core::node::NodeRegistry;

use crate::kernel_node::GpuKernelNode;
use crate::kuwahara::GpuKuwaharaNode;
use crate::manifest::builtin_pixelate_manifest;

pub use crate::context::GpuContext;
pub use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn register_gpu_nodes(registry: &mut NodeRegistry, context: Arc<GpuContext>) {
    let ctx = context.clone();
    registry.register("gpu_kernel::pixelate", move || {
        let manifest = builtin_pixelate_manifest();
        Arc::new(GpuKernelNode::from_manifest(manifest, ctx.clone()).expect("GPU node"))
    });

    let ctx = context.clone();
    registry.register("kuwahara", move || {
        Arc::new(GpuKuwaharaNode::new(ctx.clone()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::builtin_pixelate_manifest;
    use crate::transpile::glsl_to_wgsl;
    use compositor_core::types::Format;

    #[test]
    fn test_pixelate_glsl_builds() {
        let manifest = builtin_pixelate_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        assert!(glsl.contains("u_palette"));
        assert!(glsl.contains("has_palette"));
    }

    #[test]
    fn test_pixelate_transpile_to_wgsl() {
        let manifest = builtin_pixelate_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile to WGSL");
        assert!(wgsl.contains("fn main"));
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_pixelate_node_spec() {
        let manifest = builtin_pixelate_manifest();
        let spec = manifest.to_node_spec().expect("Spec should build");
        assert_eq!(spec.id, "gpu_kernel::pixelate");
        assert_eq!(spec.inputs.len(), 2);
        assert_eq!(spec.outputs.len(), 1);
        assert_eq!(spec.params.len(), 4);
        assert_eq!(spec.params[0].key, "pixel_size");
    }

    #[test]
    fn test_simple_kernel_transpile() {
        let manifest = KernelManifest {
            id: "invert_gpu".to_string(),
            display_name: "Invert GPU".to_string(),
            category: "GPU".to_string(),
            description: "Simple invert".to_string(),
            inputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            }],
            params: vec![manifest::ManifestParam {
                key: "strength".to_string(),
                label: "Strength".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            }],
            kernel: "return vec4(mix(color.rgb, vec3(1.0) - color.rgb, strength), color.a);"
                .to_string(),
        };

        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("Should transpile to WGSL");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_gpu_context_init() {
        use compositor_core::node::Node;

        match GpuContext::new() {
            Ok(ctx) => {
                let manifest = KernelManifest {
                    id: "test_passthrough".to_string(),
                    display_name: "Test".to_string(),
                    category: "GPU".to_string(),
                    description: "test".to_string(),
                    inputs: vec![manifest::ManifestPort {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: "Image".to_string(),
                        optional: false,
                    }],
                    outputs: vec![manifest::ManifestPort {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: "Image".to_string(),
                        optional: false,
                    }],
                    params: vec![],
                    kernel: "return color;".to_string(),
                };

                let node = kernel_node::GpuKernelNode::from_manifest(manifest, Arc::new(ctx))
                    .expect("Should create GPU kernel node");
                let spec = node.spec();
                assert_eq!(spec.id, "test_passthrough");
            }
            Err(e) => {
                println!("GPU not available (expected in CI): {e}");
            }
        }
    }

    #[test]
    fn test_gpu_passthrough_execution() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = KernelManifest {
            id: "test_pass".to_string(),
            display_name: "Test".to_string(),
            category: "GPU".to_string(),
            description: "test".to_string(),
            inputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            }],
            params: vec![],
            kernel: "return color;".to_string(),
        };

        let node =
            kernel_node::GpuKernelNode::from_manifest(manifest, ctx).expect("Should create node");

        let mut data = Vec::new();
        for y in 0..4u32 {
            for x in 0..4u32 {
                let r = (x as f32) / 3.0;
                let g = (y as f32) / 3.0;
                let b = 0.5f32;
                let a = 1.0f32;
                data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = compositor_core::types::Image::from_f32_data(4, 4, data).unwrap();

        use compositor_core::node::EvalContext;
        use compositor_core::types::{FrameTime, Value};
        use std::collections::HashMap;

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image.clone()));
        let params = HashMap::new();

        let cm = compositor_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
        };

        use compositor_core::node::Node;
        let result = pollster::block_on(node.evaluate(&eval_ctx)).expect("Evaluate should succeed");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 4);
                assert_eq!(out_img.height, 4);
                let px = out_img.get_pixel_f32(0, 0);
                assert!(
                    (px[2] - 0.5).abs() < 0.01,
                    "Blue should be ~0.5, got {}",
                    px[2]
                );
                assert!(
                    (px[3] - 1.0).abs() < 0.01,
                    "Alpha should be ~1.0, got {}",
                    px[3]
                );
                let px = out_img.get_pixel_f32(3, 3);
                assert!(
                    (px[0] - 1.0).abs() < 0.01,
                    "Red should be ~1.0, got {}",
                    px[0]
                );
                assert!(
                    (px[1] - 1.0).abs() < 0.01,
                    "Green should be ~1.0, got {}",
                    px[1]
                );
            }
            _ => panic!("Expected image output"),
        }
    }

    #[test]
    fn test_pixelate_kernel_e2e() {
        use compositor_core::node::{EvalContext, Node};
        use compositor_core::types::{FrameTime, ParamValue, Value};
        use std::collections::HashMap;

        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = builtin_pixelate_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create pixelate node");

        let mut img_data = Vec::new();
        for y in 0..8u32 {
            for x in 0..8u32 {
                let r = (x as f32) / 7.0;
                let g = (y as f32) / 7.0;
                let b = 0.3f32;
                let a = 1.0f32;
                img_data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = compositor_core::types::Image::from_f32_data(8, 8, img_data).unwrap();

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("pixel_size".to_string(), ParamValue::Int(4));

        let cm = compositor_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
        };

        let result = pollster::block_on(node.evaluate(&eval_ctx)).expect("Pixelate should succeed");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 8);
                assert_eq!(out_img.height, 8);
                let px = out_img.get_pixel_f32(0, 0);
                assert!(px[3] > 0.9, "Alpha should be preserved");
            }
            _ => panic!("Expected image output"),
        }
    }

    #[test]
    fn test_pixelate_with_optional_palette_missing() {
        use compositor_core::node::{EvalContext, Node};
        use compositor_core::types::{FrameTime, ParamValue, Value};
        use std::collections::HashMap;

        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {e}");
                return;
            }
        };

        let manifest = builtin_pixelate_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create pixelate node");

        let mut img_data = Vec::new();
        for y in 0..8u32 {
            for x in 0..8u32 {
                let r = (x as f32) / 7.0;
                let g = (y as f32) / 7.0;
                let b = 0.3f32;
                let a = 1.0f32;
                img_data.extend_from_slice(&[r, g, b, a]);
            }
        }
        let image = compositor_core::types::Image::from_f32_data(8, 8, img_data).unwrap();

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("pixel_size".to_string(), ParamValue::Int(2));

        let cm = compositor_core::color::BuiltinColorManagement::new();
        let format = Format::hd();
        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
            color_management: &cm,
            ai_provider: None,
            project_format: &format,
            ai_cached_outputs: None,
        };

        let result = pollster::block_on(node.evaluate(&eval_ctx))
            .expect("Pixelate should succeed without palette");
        let output = result.get("image").expect("Should have image output");
        match output {
            Value::Image(out_img) => {
                assert_eq!(out_img.width, 8);
                assert_eq!(out_img.height, 8);
                let px00 = out_img.get_pixel_f32(0, 0);
                let px10 = out_img.get_pixel_f32(1, 0);
                assert!((px00[0] - px10[0]).abs() < 0.001, "Block should match");
                assert!((px00[1] - px10[1]).abs() < 0.001, "Block should match");
                assert!(px00[3] > 0.9, "Alpha should be preserved");
            }
            _ => panic!("Expected image output"),
        }
    }
}
