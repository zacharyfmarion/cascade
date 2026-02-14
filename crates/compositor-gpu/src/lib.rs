pub mod context;
pub mod kernel_node;
pub mod manifest;
pub mod template;
pub mod transpile;

use std::sync::Arc;

use compositor_core::node::NodeRegistry;

use crate::kernel_node::GpuKernelNode;
use crate::manifest::{builtin_dither_manifest, builtin_pixelate_manifest};

pub use crate::context::GpuContext;
pub use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn register_gpu_nodes(registry: &mut NodeRegistry, context: Arc<GpuContext>) {
    let ctx = context.clone();
    registry.register("gpu_kernel::pixelate", move || {
        let manifest = builtin_pixelate_manifest();
        Arc::new(GpuKernelNode::from_manifest(manifest, ctx.clone()).expect("GPU node"))
    });

    let ctx = context.clone();
    registry.register("gpu_kernel::dither", move || {
        let manifest = builtin_dither_manifest();
        Arc::new(GpuKernelNode::from_manifest(manifest, ctx.clone()).expect("GPU node"))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{builtin_dither_manifest, builtin_pixelate_manifest};
    use crate::transpile::glsl_to_wgsl;

    #[test]
    fn test_pixelate_glsl_builds() {
        let manifest = builtin_pixelate_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
    }

    #[test]
    fn test_dither_glsl_builds() {
        let manifest = builtin_dither_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        assert!(glsl.contains("u_palette"));
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
    fn test_dither_transpile_to_wgsl() {
        let manifest = builtin_dither_manifest();
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
        assert_eq!(spec.inputs.len(), 1);
        assert_eq!(spec.outputs.len(), 1);
        assert_eq!(spec.params.len(), 1);
        assert_eq!(spec.params[0].key, "pixel_size");
    }

    #[test]
    fn test_dither_node_spec() {
        let manifest = builtin_dither_manifest();
        let spec = manifest.to_node_spec().expect("Spec should build");
        assert_eq!(spec.id, "gpu_kernel::dither");
        assert_eq!(spec.inputs.len(), 2);
        assert_eq!(spec.outputs.len(), 1);
        assert_eq!(spec.params.len(), 2);
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
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
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
                    }],
                    outputs: vec![manifest::ManifestPort {
                        name: "image".to_string(),
                        label: "Image".to_string(),
                        ty: "Image".to_string(),
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
                println!("GPU not available (expected in CI): {}", e);
            }
        }
    }

    #[test]
    fn test_gpu_passthrough_execution() {
        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {}", e);
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
            }],
            outputs: vec![manifest::ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
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
        let image = compositor_core::types::Image::from_f32_data(4, 4, data);

        use compositor_core::node::EvalContext;
        use compositor_core::types::{FrameTime, Value};
        use std::collections::HashMap;

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image.clone()));
        let params = HashMap::new();

        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
        };

        use compositor_core::node::Node;
        let result = node.evaluate(&eval_ctx).expect("Evaluate should succeed");
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
                println!("GPU not available, skipping: {}", e);
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
        let image = compositor_core::types::Image::from_f32_data(8, 8, img_data);

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        let mut params = HashMap::new();
        params.insert("pixel_size".to_string(), ParamValue::Int(4));

        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
        };

        let result = node.evaluate(&eval_ctx).expect("Pixelate should succeed");
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
    fn test_dither_kernel_e2e() {
        use compositor_core::node::{EvalContext, Node};
        use compositor_core::types::{FrameTime, ParamValue, Value};
        use std::collections::HashMap;

        let ctx = match GpuContext::new() {
            Ok(ctx) => Arc::new(ctx),
            Err(e) => {
                println!("GPU not available, skipping: {}", e);
                return;
            }
        };

        let manifest = builtin_dither_manifest();
        let node = kernel_node::GpuKernelNode::from_manifest(manifest, ctx)
            .expect("Should create dither node");

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
        let image = compositor_core::types::Image::from_f32_data(8, 8, img_data);

        let palette_data = vec![
            1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
        ];
        let palette = compositor_core::types::Image::from_f32_data(4, 1, palette_data);

        let mut inputs = HashMap::new();
        inputs.insert("image".to_string(), Value::Image(image));
        inputs.insert("palette".to_string(), Value::Image(palette));
        let mut params = HashMap::new();
        params.insert("dither_amount".to_string(), ParamValue::Float(1.0));
        params.insert("palette_size".to_string(), ParamValue::Int(4));

        let eval_ctx = EvalContext {
            inputs,
            params: &params,
            frame_time: FrameTime { frame: 0 },
        };

        let result = node.evaluate(&eval_ctx).expect("Dither should succeed");
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
}
