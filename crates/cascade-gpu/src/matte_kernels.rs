use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_premultiply_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::premultiply".to_string(),
        display_name: "Premultiply".to_string(),
        category: "Matte".to_string(),
        description: "Premultiply alpha".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![],
        kernel: r#"
    return vec4(color.rgb * color.a, color.a);
"#
        .trim()
        .to_string(),
        supports_mask: false,
        pixel_space_params: vec![],
    }
}

pub fn builtin_unpremultiply_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::unpremultiply".to_string(),
        display_name: "Unpremultiply".to_string(),
        category: "Matte".to_string(),
        description: "Unpremultiply alpha".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![],
        kernel: r#"
    float a = color.a;
    if (a > 0.0001) {
        return vec4(color.rgb / a, a);
    }
    return color;
"#
        .trim()
        .to_string(),
        supports_mask: false,
        pixel_space_params: vec![],
    }
}

pub fn builtin_chroma_key_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::chroma_key".to_string(),
        display_name: "Chroma Key".to_string(),
        category: "Matte".to_string(),
        description: "Key out by color".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "key_r".to_string(),
                label: "Key Red".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "key_g".to_string(),
                label: "Key Green".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "key_b".to_string(),
                label: "Key Blue".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "tolerance".to_string(),
                label: "Tolerance".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.3),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "softness".to_string(),
                label: "Softness".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec3 key_color = vec3(key_r, key_g, key_b);
    float dist = length(color.rgb - key_color);
    float soft = max(softness, 0.0);
    float t = soft > 0.0 ? smoothstep(tolerance, tolerance + soft, dist) : step(tolerance, dist);
    return vec4(color.rgb, color.a * t);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_despill_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::despill".to_string(),
        display_name: "Despill".to_string(),
        category: "Matte".to_string(),
        description: "Remove color spill from keyed footage".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "method".to_string(),
                label: "Method".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(2.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Green".to_string(),
                    "Blue".to_string(),
                    "Custom".to_string(),
                ],
            },
            ManifestParam {
                key: "amount".to_string(),
                label: "Amount".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "custom_hue".to_string(),
                label: "Custom Hue".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(120.0),
                min: Some(0.0),
                max: Some(360.0),
                step: Some(1.0),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float amt = clamp(amount, 0.0, 1.0);
    if (method == 0) {
        float max_rb = max(color.r, color.b);
        float reduced = min(color.g, max_rb);
        color.g = mix(color.g, reduced, amt);
    } else if (method == 1) {
        float max_rg = max(color.r, color.g);
        float reduced = min(color.b, max_rg);
        color.b = mix(color.b, reduced, amt);
    } else {
        float h = mod(custom_hue, 360.0) / 60.0;
        float c = 1.0;
        float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
        vec3 key_color;
        if (h < 1.0) {
            key_color = vec3(c, x, 0.0);
        } else if (h < 2.0) {
            key_color = vec3(x, c, 0.0);
        } else if (h < 3.0) {
            key_color = vec3(0.0, c, x);
        } else if (h < 4.0) {
            key_color = vec3(0.0, x, c);
        } else if (h < 5.0) {
            key_color = vec3(x, 0.0, c);
        } else {
            key_color = vec3(c, 0.0, x);
        }

        float key_len = length(key_color);
        if (key_len > 0.0001) {
            vec3 nkey = key_color / key_len;
            float dist = length(color.rgb - key_color);
            float influence = clamp(1.0 - dist / 1.7320508, 0.0, 1.0) * amt;
            float dot_val = dot(color.rgb, nkey);
            float reduce = dot_val * influence;
            color.rgb -= nkey * reduce;
        }
    }

    color.rgb = clamp(color.rgb, 0.0, 1.0);
    return vec4(color.rgb, color.a);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_luminance_key_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::luminance_key".to_string(),
        display_name: "Luminance Key".to_string(),
        category: "Matte".to_string(),
        description: "Generate matte from pixel brightness".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "channel".to_string(),
                label: "Channel".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(3.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Luminance".to_string(),
                    "Red".to_string(),
                    "Green".to_string(),
                    "Blue".to_string(),
                ],
            },
            ManifestParam {
                key: "low".to_string(),
                label: "Low".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.2),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high".to_string(),
                label: "High".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.8),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "invert".to_string(),
                label: "Invert".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(1.0),
                ui: Some("Checkbox".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float low_v = min(low, high);
    float high_v = max(low, high);
    float sval;
    if (channel == 1) {
        sval = color.r;
    } else if (channel == 2) {
        sval = color.g;
    } else if (channel == 3) {
        sval = color.b;
    } else {
        sval = luminance(color);
    }
    float key = smoothstep(low_v, high_v, sval);
    if (invert == 1) { key = 1.0 - key; }
    return vec4(color.rgb, color.a * key);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_difference_matte_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::difference_matte".to_string(),
        display_name: "Difference Matte".to_string(),
        category: "Matte".to_string(),
        description: "Generate matte from difference between footage and clean plate".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "clean_plate".to_string(),
                label: "Clean Plate".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
        ],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![
            ManifestParam {
                key: "tolerance".to_string(),
                label: "Tolerance".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "softness".to_string(),
                label: "Softness".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(0.1),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec4 plate = imageLoad(u_clean_plate, pixel);
    float dist = length(color.rgb - plate.rgb);
    float soft = max(softness, 0.0);
    float key = soft > 0.0 ? smoothstep(tolerance, tolerance + soft, dist) : step(tolerance, dist);
    return vec4(color.rgb, color.a * key);
"#
        .trim()
        .to_string(),
        ..KernelManifest::default()
    }
}

pub fn builtin_set_alpha_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::set_alpha".to_string(),
        display_name: "Set Alpha".to_string(),
        category: "Matte".to_string(),
        description: "Set alpha from luminance".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "alpha_source".to_string(),
                label: "Alpha Source".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
        ],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![],
        kernel: r#"
    vec4 a = imageLoad(u_alpha_source, pixel);
    return vec4(color.rgb, luminance(a));
"#
        .trim()
        .to_string(),
        supports_mask: false,
        pixel_space_params: vec![],
    }
}

pub fn builtin_extract_channel_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::extract_channel".to_string(),
        display_name: "Extract Channel".to_string(),
        category: "Matte".to_string(),
        description: "Extract a single channel".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
            optional: false,
        }],
        params: vec![ManifestParam {
            key: "channel".to_string(),
            label: "Channel".to_string(),
            ty: "Int".to_string(),
            default: serde_json::Value::from(0),
            min: Some(0.0),
            max: Some(3.0),
            step: Some(1.0),
            ui: Some("Dropdown".to_string()),
            options: vec![
                "Red".to_string(),
                "Green".to_string(),
                "Blue".to_string(),
                "Alpha".to_string(),
            ],
        }],
        kernel: r#"
    float v;
    if (channel == 0) {
        v = color.r;
    } else if (channel == 1) {
        v = color.g;
    } else if (channel == 2) {
        v = color.b;
    } else {
        v = color.a;
    }
    return vec4(v, v, v, 1.0);
"#
        .trim()
        .to_string(),
        supports_mask: false,
        pixel_space_params: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transpile::glsl_to_wgsl;

    #[test]
    fn test_premultiply_manifest_transpiles() {
        let m = builtin_premultiply_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_unpremultiply_manifest_transpiles() {
        let m = builtin_unpremultiply_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_chroma_key_manifest_transpiles() {
        let m = builtin_chroma_key_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_despill_manifest_transpiles() {
        let m = builtin_despill_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_luminance_key_manifest_transpiles() {
        let m = builtin_luminance_key_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_difference_matte_manifest_transpiles() {
        let m = builtin_difference_matte_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_set_alpha_manifest_transpiles() {
        let m = builtin_set_alpha_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_extract_channel_manifest_transpiles() {
        let m = builtin_extract_channel_manifest();
        let glsl = m.build_glsl().expect("build glsl failed");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }
}
