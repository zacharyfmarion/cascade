use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_levels_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::levels".to_string(),
        display_name: "Levels (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Adjust levels".to_string(),
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
                key: "in_black".to_string(),
                label: "In Black".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "in_white".to_string(),
                label: "In White".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gamma".to_string(),
                label: "Gamma".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(10.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "out_black".to_string(),
                label: "Out Black".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "out_white".to_string(),
                label: "Out White".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float input_range = in_white - in_black;
    float inv_input_range = abs(input_range) > 1e-6 ? 1.0 / input_range : 0.0;
    float inv_gamma = abs(gamma) > 1e-6 ? 1.0 / gamma : 1.0;
    float output_range = out_white - out_black;

    vec3 rgb = color.rgb;
    rgb.r = out_black
        + pow(clamp((rgb.r - in_black) * inv_input_range, 0.0, 1.0), inv_gamma) * output_range;
    rgb.g = out_black
        + pow(clamp((rgb.g - in_black) * inv_input_range, 0.0, 1.0), inv_gamma) * output_range;
    rgb.b = out_black
        + pow(clamp((rgb.b - in_black) * inv_input_range, 0.0, 1.0), inv_gamma) * output_range;
    return vec4(rgb, color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_vibrance_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::vibrance".to_string(),
        display_name: "Vibrance (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Selectively boost saturation".to_string(),
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
            key: "vibrance".to_string(),
            label: "Vibrance".to_string(),
            ty: "Float".to_string(),
            default: serde_json::json!(0.0),
            min: Some(-1.0),
            max: Some(1.0),
            step: Some(0.01),
            ui: Some("Slider".to_string()),
            options: vec![],
        }],
        kernel: r#"
    float r = color.r;
    float g = color.g;
    float b = color.b;

    float max_c = max(r, max(g, b));
    float min_c = min(r, min(g, b));
    float l = (max_c + min_c) * 0.5;
    float delta = max_c - min_c;
    float h = 0.0;
    float s = 0.0;
    if (delta != 0.0) {
        s = delta / (1.0 - abs(2.0 * l - 1.0));
        if (max_c == r) {
            h = mod((g - b) / delta, 6.0);
        } else if (max_c == g) {
            h = ((b - r) / delta) + 2.0;
        } else {
            h = ((r - g) / delta) + 4.0;
        }
        h *= 60.0;
        if (h < 0.0) {
            h += 360.0;
        }
    }

    float sat_boost = vibrance * (1.0 - s);
    float new_s = clamp(s * (1.0 + sat_boost), 0.0, 1.0);

    vec3 out_rgb;
    if (new_s == 0.0) {
        out_rgb = vec3(l);
    } else {
        float c = (1.0 - abs(2.0 * l - 1.0)) * new_s;
        float h_prime = h / 60.0;
        float x = c * (1.0 - abs(mod(h_prime, 2.0) - 1.0));
        vec3 rgb1;
        if (h_prime >= 0.0 && h_prime < 1.0) {
            rgb1 = vec3(c, x, 0.0);
        } else if (h_prime < 2.0) {
            rgb1 = vec3(x, c, 0.0);
        } else if (h_prime < 3.0) {
            rgb1 = vec3(0.0, c, x);
        } else if (h_prime < 4.0) {
            rgb1 = vec3(0.0, x, c);
        } else if (h_prime < 5.0) {
            rgb1 = vec3(x, 0.0, c);
        } else {
            rgb1 = vec3(c, 0.0, x);
        }
        float m = l - c * 0.5;
        out_rgb = rgb1 + vec3(m);
    }

    return vec4(out_rgb, color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_tone_map_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::tone_map".to_string(),
        display_name: "Tone Map (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Apply tone mapping".to_string(),
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
                key: "exposure".to_string(),
                label: "Exposure".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-5.0),
                max: Some(5.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "method".to_string(),
                label: "Method".to_string(),
                ty: "Int".to_string(),
                default: serde_json::json!(0),
                min: Some(0.0),
                max: Some(2.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Reinhard".to_string(),
                    "ACES Filmic".to_string(),
                    "Hable".to_string(),
                ],
            },
        ],
        kernel: r#"
    float exposure_scale = pow(2.0, exposure);
    float r = color.r * exposure_scale;
    float g = color.g * exposure_scale;
    float b = color.b * exposure_scale;

    if (method == 0) {
        r = r / (1.0 + r);
        g = g / (1.0 + g);
        b = b / (1.0 + b);
    } else if (method == 1) {
        r = (r * (2.51 * r + 0.03)) / (r * (2.43 * r + 0.59) + 0.14);
        g = (g * (2.51 * g + 0.03)) / (g * (2.43 * g + 0.59) + 0.14);
        b = (b * (2.51 * b + 0.03)) / (b * (2.43 * b + 0.59) + 0.14);
    } else {
        float a = 0.15;
        float bb = 0.50;
        float c = 0.10;
        float d = 0.20;
        float e = 0.02;
        float f = 0.30;
        r = (r * (a * r + c * bb) + d * e) / (r * (a * r + bb) + d * f) - e / f;
        g = (g * (a * g + c * bb) + d * e) / (g * (a * g + bb) + d * f) - e / f;
        b = (b * (a * b + c * bb) + d * e) / (b * (a * b + bb) + d * f) - e / f;
    }

    return vec4(clamp(vec3(r, g, b), 0.0, 1.0), color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_grade_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::grade".to_string(),
        display_name: "Grade (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Lift/Gamma/Gain color correction per channel".to_string(),
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
                key: "lift_r".to_string(),
                label: "Lift R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "lift_g".to_string(),
                label: "Lift G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "lift_b".to_string(),
                label: "Lift B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gamma_r".to_string(),
                label: "Gamma R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gamma_g".to_string(),
                label: "Gamma G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gamma_b".to_string(),
                label: "Gamma B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.01),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gain_r".to_string(),
                label: "Gain R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gain_g".to_string(),
                label: "Gain G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "gain_b".to_string(),
                label: "Gain B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(4.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec3 lift = vec3(lift_r, lift_g, lift_b);
    vec3 gamma = vec3(gamma_r, gamma_g, gamma_b);
    vec3 gain = vec3(gain_r, gain_g, gain_b);
    vec3 inv_gamma = vec3(
        abs(gamma.x) > 1e-6 ? 1.0 / gamma.x : 1.0,
        abs(gamma.y) > 1e-6 ? 1.0 / gamma.y : 1.0,
        abs(gamma.z) > 1e-6 ? 1.0 / gamma.z : 1.0
    );

    vec3 lifted = color.rgb + lift;
    vec3 lifted_positive = max(lifted, vec3(0.0));
    vec3 result = gain * vec3(
        pow(lifted_positive.x, inv_gamma.x),
        pow(lifted_positive.y, inv_gamma.y),
        pow(lifted_positive.z, inv_gamma.z)
    );

    return vec4(result, color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_gradient_map_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::gradient_map".to_string(),
        display_name: "Gradient Map (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Map luminance to a color gradient".to_string(),
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
                key: "low_r".to_string(),
                label: "Low R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "low_g".to_string(),
                label: "Low G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "low_b".to_string(),
                label: "Low B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_r".to_string(),
                label: "Mid R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_g".to_string(),
                label: "Mid G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_b".to_string(),
                label: "Mid B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.5),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_r".to_string(),
                label: "High R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_g".to_string(),
                label: "High G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "high_b".to_string(),
                label: "High B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "strength".to_string(),
                label: "Strength".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec3 low = vec3(low_r, low_g, low_b);
    vec3 mid = vec3(mid_r, mid_g, mid_b);
    vec3 high = vec3(high_r, high_g, high_b);
    float lum = luminance(color);
    vec3 mapped = lum < 0.5
        ? mix(low, mid, lum * 2.0)
        : mix(mid, high, (lum - 0.5) * 2.0);
    vec3 out_rgb = clamp(mix(color.rgb, mapped, strength), 0.0, 1.0);
    return vec4(out_rgb, color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_color_balance_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::color_balance".to_string(),
        display_name: "Color Balance (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Adjust color balance".to_string(),
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
                key: "shadow_r".to_string(),
                label: "Shadow R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "shadow_g".to_string(),
                label: "Shadow G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "shadow_b".to_string(),
                label: "Shadow B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_r".to_string(),
                label: "Mid R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_g".to_string(),
                label: "Mid G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "mid_b".to_string(),
                label: "Mid B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "highlight_r".to_string(),
                label: "Highlight R".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "highlight_g".to_string(),
                label: "Highlight G".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
            ManifestParam {
                key: "highlight_b".to_string(),
                label: "Highlight B".to_string(),
                ty: "Float".to_string(),
                default: serde_json::json!(0.0),
                min: Some(-1.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    float lum = luminance(color);
    float shadow_weight = clamp(1.0 - lum * 2.0, 0.0, 1.0);
    float highlight_weight = clamp(lum * 2.0 - 1.0, 0.0, 1.0);
    float mid_weight = clamp(1.0 - shadow_weight - highlight_weight, 0.0, 1.0);

    vec3 result = color.rgb;
    result += vec3(shadow_r, shadow_g, shadow_b) * shadow_weight;
    result += vec3(mid_r, mid_g, mid_b) * mid_weight;
    result += vec3(highlight_r, highlight_g, highlight_b) * highlight_weight;
    result = clamp(result, 0.0, 1.0);

    return vec4(result, color.a);
"#
        .trim()
        .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transpile::glsl_to_wgsl;

    #[test]
    fn test_levels_manifest_transpiles() {
        let manifest = builtin_levels_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_vibrance_manifest_transpiles() {
        let manifest = builtin_vibrance_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_tone_map_manifest_transpiles() {
        let manifest = builtin_tone_map_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_grade_manifest_transpiles() {
        let manifest = builtin_grade_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_gradient_map_manifest_transpiles() {
        let manifest = builtin_gradient_map_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_color_balance_manifest_transpiles() {
        let manifest = builtin_color_balance_manifest();
        let glsl = manifest.build_glsl().expect("GLSL should build");
        assert!(glsl.contains("#version 450"));
        assert!(glsl.contains("process("));
        let wgsl = glsl_to_wgsl(&glsl).expect("transpile failed");
        assert!(!wgsl.is_empty());
    }
}
