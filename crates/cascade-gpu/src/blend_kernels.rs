use crate::manifest::{KernelManifest, ManifestParam, ManifestPort};

pub fn builtin_blend_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::blend".to_string(),
        display_name: "Blend (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Blend two images with classic blend modes".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "blend_image".to_string(),
                label: "Blend".to_string(),
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
                key: "mode".to_string(),
                label: "Mode".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(18.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Normal".to_string(),
                    "Add".to_string(),
                    "Multiply".to_string(),
                    "Screen".to_string(),
                    "Overlay".to_string(),
                    "Soft Light".to_string(),
                    "Hard Light".to_string(),
                    "Difference".to_string(),
                    "Darken".to_string(),
                    "Lighten".to_string(),
                    "Color Dodge".to_string(),
                    "Color Burn".to_string(),
                    "Linear Burn".to_string(),
                    "Vivid Light".to_string(),
                    "Linear Light".to_string(),
                    "Pin Light".to_string(),
                    "Exclusion".to_string(),
                    "Subtract".to_string(),
                    "Divide".to_string(),
                ],
            },
            ManifestParam {
                key: "opacity".to_string(),
                label: "Opacity".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec4 blend_color = imageLoad(u_blend_image, pixel);
    int blend_mode = mode;
    float opacity_val = clamp(opacity, 0.0, 1.0);

    float base_channels[3] = float[3](color.r, color.g, color.b);
    float blend_channels[3] = float[3](blend_color.r, blend_color.g, blend_color.b);
    float blended_channels[3];

    for (int i = 0; i < 3; i++) {
        float base = base_channels[i];
        float blend = blend_channels[i];
        float result = blend;

        if (blend_mode == 0) {
            result = blend;
        } else if (blend_mode == 1) {
            result = base + blend;
        } else if (blend_mode == 2) {
            result = base * blend;
        } else if (blend_mode == 3) {
            result = 1.0 - (1.0 - base) * (1.0 - blend);
        } else if (blend_mode == 4) {
            if (base < 0.5) {
                result = 2.0 * base * blend;
            } else {
                result = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
            }
        } else if (blend_mode == 5) {
            if (blend <= 0.5) {
                result = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
            } else {
                float d = base <= 0.25
                    ? ((16.0 * base - 12.0) * base + 4.0) * base
                    : sqrt(base);
                result = base + (2.0 * blend - 1.0) * (d - base);
            }
        } else if (blend_mode == 6) {
            if (blend < 0.5) {
                result = 2.0 * base * blend;
            } else {
                result = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
            }
        } else if (blend_mode == 7) {
            result = abs(base - blend);
        } else if (blend_mode == 8) {
            result = min(base, blend);
        } else if (blend_mode == 9) {
            result = max(base, blend);
        } else if (blend_mode == 10) {
            if (blend >= 1.0) {
                result = 1.0;
            } else {
                result = base / (1.0 - blend);
            }
        } else if (blend_mode == 11) {
            if (blend <= 0.0) {
                result = 0.0;
            } else {
                result = 1.0 - min((1.0 - base) / blend, 1.0);
            }
        } else if (blend_mode == 12) {
            result = max(base + blend - 1.0, 0.0);
        } else if (blend_mode == 13) {
            if (blend <= 0.5) {
                if (blend <= 0.0) {
                    result = 0.0;
                } else {
                    result = 1.0 - min((1.0 - base) / (2.0 * blend), 1.0);
                }
            } else {
                float d = 2.0 * (blend - 0.5);
                if (d >= 1.0) {
                    result = 1.0;
                } else {
                    result = base / (1.0 - d);
                }
            }
        } else if (blend_mode == 14) {
            result = clamp(base + 2.0 * blend - 1.0, 0.0, 1.0);
        } else if (blend_mode == 15) {
            if (blend <= 0.5) {
                result = min(base, 2.0 * blend);
            } else {
                result = max(base, 2.0 * blend - 1.0);
            }
        } else if (blend_mode == 16) {
            result = base + blend - 2.0 * base * blend;
        } else if (blend_mode == 17) {
            result = max(base - blend, 0.0);
        } else if (blend_mode == 18) {
            if (blend <= 0.0) {
                result = 1.0;
            } else {
                result = min(base / blend, 1.0);
            }
        } else {
            result = blend;
        }

        blended_channels[i] = result;
    }

    vec3 blended = vec3(blended_channels[0], blended_channels[1], blended_channels[2]);
    float blend_alpha = blend_color.a * opacity_val;
    float out_a = blend_alpha + color.a * (1.0 - blend_alpha);
    vec3 out_rgb = color.rgb + (blended - color.rgb) * blend_alpha;
    return vec4(out_rgb, out_a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_alpha_over_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::alpha_over".to_string(),
        display_name: "Alpha Over (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Composite foreground over background".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Background".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "foreground".to_string(),
                label: "Foreground".to_string(),
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
        params: vec![ManifestParam {
            key: "opacity".to_string(),
            label: "Opacity".to_string(),
            ty: "Float".to_string(),
            default: serde_json::Value::from(1.0),
            min: Some(0.0),
            max: Some(1.0),
            step: Some(0.01),
            ui: Some("Slider".to_string()),
            options: vec![],
        }],
        kernel: r#"
    vec4 fg = imageLoad(u_foreground, pixel);
    fg.a *= clamp(opacity, 0.0, 1.0);
    vec3 out_rgb = fg.rgb * fg.a + color.rgb * (1.0 - fg.a);
    float out_a = fg.a + color.a * (1.0 - fg.a);
    return vec4(out_rgb, out_a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_merge_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::merge".to_string(),
        display_name: "Merge (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Merge two images with Porter-Duff operations".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "A".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "b_image".to_string(),
                label: "B".to_string(),
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
                key: "operation".to_string(),
                label: "Operation".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(13.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "Over".to_string(),
                    "Under".to_string(),
                    "In".to_string(),
                    "Out".to_string(),
                    "Atop".to_string(),
                    "Xor".to_string(),
                    "Stencil".to_string(),
                    "Mask".to_string(),
                    "Plus".to_string(),
                    "Multiply".to_string(),
                    "Difference".to_string(),
                    "Screen".to_string(),
                    "Max".to_string(),
                    "Min".to_string(),
                ],
            },
            ManifestParam {
                key: "mix".to_string(),
                label: "Mix".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
                options: vec![],
            },
        ],
        kernel: r#"
    vec4 b = imageLoad(u_b_image, pixel);
    float a_alpha = clamp(color.a, 0.0, 1.0);
    float b_alpha = clamp(b.a, 0.0, 1.0);
    float m_r = 0.0;
    float m_g = 0.0;
    float m_b = 0.0;
    float m_a = 0.0;

    if (operation == 0) {
        float out_a = a_alpha + b_alpha * (1.0 - a_alpha);
        if (out_a > 0.0) {
            m_r = (color.r * a_alpha + b.r * b_alpha * (1.0 - a_alpha)) / out_a;
            m_g = (color.g * a_alpha + b.g * b_alpha * (1.0 - a_alpha)) / out_a;
            m_b = (color.b * a_alpha + b.b * b_alpha * (1.0 - a_alpha)) / out_a;
            m_a = out_a;
        }
    } else if (operation == 1) {
        float out_a = b_alpha + a_alpha * (1.0 - b_alpha);
        if (out_a > 0.0) {
            m_r = (b.r * b_alpha + color.r * a_alpha * (1.0 - b_alpha)) / out_a;
            m_g = (b.g * b_alpha + color.g * a_alpha * (1.0 - b_alpha)) / out_a;
            m_b = (b.b * b_alpha + color.b * a_alpha * (1.0 - b_alpha)) / out_a;
            m_a = out_a;
        }
    } else if (operation == 2) {
        m_r = color.r;
        m_g = color.g;
        m_b = color.b;
        m_a = a_alpha * b_alpha;
    } else if (operation == 3) {
        m_r = color.r;
        m_g = color.g;
        m_b = color.b;
        m_a = a_alpha * (1.0 - b_alpha);
    } else if (operation == 4) {
        m_r = color.r * a_alpha + b.r * (1.0 - a_alpha);
        m_g = color.g * a_alpha + b.g * (1.0 - a_alpha);
        m_b = color.b * a_alpha + b.b * (1.0 - a_alpha);
        m_a = b_alpha;
    } else if (operation == 5) {
        float out_a = a_alpha * (1.0 - b_alpha) + b_alpha * (1.0 - a_alpha);
        if (out_a > 0.0) {
            m_r = (color.r * a_alpha * (1.0 - b_alpha) + b.r * b_alpha * (1.0 - a_alpha)) / out_a;
            m_g = (color.g * a_alpha * (1.0 - b_alpha) + b.g * b_alpha * (1.0 - a_alpha)) / out_a;
            m_b = (color.b * a_alpha * (1.0 - b_alpha) + b.b * b_alpha * (1.0 - a_alpha)) / out_a;
            m_a = out_a;
        }
    } else if (operation == 6) {
        m_r = b.r;
        m_g = b.g;
        m_b = b.b;
        m_a = b_alpha * a_alpha;
    } else if (operation == 7) {
        m_r = color.r;
        m_g = color.g;
        m_b = color.b;
        m_a = a_alpha * b_alpha;
    } else if (operation == 8) {
        m_r = color.r * a_alpha + b.r * b_alpha;
        m_g = color.g * a_alpha + b.g * b_alpha;
        m_b = color.b * a_alpha + b.b * b_alpha;
        m_a = min(a_alpha + b_alpha, 1.0);
    } else if (operation == 9) {
        m_r = color.r * b.r;
        m_g = color.g * b.g;
        m_b = color.b * b.b;
        m_a = a_alpha + b_alpha - a_alpha * b_alpha;
    } else if (operation == 10) {
        m_r = abs(color.r - b.r);
        m_g = abs(color.g - b.g);
        m_b = abs(color.b - b.b);
        m_a = a_alpha + b_alpha - a_alpha * b_alpha;
    } else if (operation == 11) {
        m_r = 1.0 - (1.0 - color.r) * (1.0 - b.r);
        m_g = 1.0 - (1.0 - color.g) * (1.0 - b.g);
        m_b = 1.0 - (1.0 - color.b) * (1.0 - b.b);
        m_a = a_alpha + b_alpha - a_alpha * b_alpha;
    } else if (operation == 12) {
        m_r = max(color.r, b.r);
        m_g = max(color.g, b.g);
        m_b = max(color.b, b.b);
        m_a = a_alpha + b_alpha - a_alpha * b_alpha;
    } else if (operation == 13) {
        m_r = min(color.r, b.r);
        m_g = min(color.g, b.g);
        m_b = min(color.b, b.b);
        m_a = a_alpha + b_alpha - a_alpha * b_alpha;
    } else {
        float out_a = a_alpha + b_alpha * (1.0 - a_alpha);
        if (out_a > 0.0) {
            m_r = (color.r * a_alpha + b.r * b_alpha * (1.0 - a_alpha)) / out_a;
            m_g = (color.g * a_alpha + b.g * b_alpha * (1.0 - a_alpha)) / out_a;
            m_b = (color.b * a_alpha + b.b * b_alpha * (1.0 - a_alpha)) / out_a;
            m_a = out_a;
        }
    }

    m_a = clamp(m_a, 0.0, 1.0);
    vec3 out_rgb = b.rgb * (1.0 - mix) + vec3(m_r, m_g, m_b) * mix;
    float out_a = clamp(b.a * (1.0 - mix) + m_a * mix, 0.0, 1.0);
    return vec4(out_rgb, out_a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_key_mix_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::key_mix".to_string(),
        display_name: "Key Mix (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Mix two images using a mask".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "A".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "b_image".to_string(),
                label: "B".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "mask_image".to_string(),
                label: "Mask".to_string(),
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
        params: vec![ManifestParam {
            key: "invert_mask".to_string(),
            label: "Invert Mask".to_string(),
            ty: "Int".to_string(),
            default: serde_json::Value::from(0),
            min: Some(0.0),
            max: Some(1.0),
            step: Some(1.0),
            ui: Some("Checkbox".to_string()),
            options: vec![],
        }],
        kernel: r#"
    vec4 b = imageLoad(u_b_image, pixel);
    vec4 mask_tex = imageLoad(u_mask_image, pixel);
    float m = luminance(mask_tex);
    if (invert_mask != 0) {
        m = 1.0 - m;
    }
    vec3 out_rgb = color.rgb * (1.0 - m) + b.rgb * m;
    float out_a = color.a * (1.0 - m) + b.a * m;
    return vec4(out_rgb, out_a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_image_math_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::image_math".to_string(),
        display_name: "Image Math (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Apply math operations per-pixel on images".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "A".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "b_image".to_string(),
                label: "B".to_string(),
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
        params: vec![ManifestParam {
            key: "operation".to_string(),
            label: "Operation".to_string(),
            ty: "Int".to_string(),
            default: serde_json::Value::from(0),
            min: Some(0.0),
            max: Some(13.0),
            step: Some(1.0),
            ui: Some("Dropdown".to_string()),
            options: vec![
                "Add".to_string(),
                "Subtract".to_string(),
                "Multiply".to_string(),
                "Divide".to_string(),
                "Min".to_string(),
                "Max".to_string(),
                "Abs Diff".to_string(),
                "Screen".to_string(),
                "Power".to_string(),
                "Sqrt".to_string(),
                "Negate".to_string(),
                "Average".to_string(),
                "Mod".to_string(),
                "Step".to_string(),
            ],
        }],
        kernel: r#"
    vec4 b = imageLoad(u_b_image, pixel);
    vec3 out_rgb = color.rgb;

    for (int i = 0; i < 3; i++) {
        float a_val = (i == 0) ? color.r : ((i == 1) ? color.g : color.b);
        float b_val = (i == 0) ? b.r : ((i == 1) ? b.g : b.b);
        float result = a_val;

        if (operation == 0) {
            result = a_val + b_val;
        } else if (operation == 1) {
            result = a_val - b_val;
        } else if (operation == 2) {
            result = a_val * b_val;
        } else if (operation == 3) {
            if (b_val > 0.0001) {
                result = a_val / b_val;
            } else {
                result = 0.0;
            }
        } else if (operation == 4) {
            result = min(a_val, b_val);
        } else if (operation == 5) {
            result = max(a_val, b_val);
        } else if (operation == 6) {
            result = abs(a_val - b_val);
        } else if (operation == 7) {
            result = 1.0 - (1.0 - a_val) * (1.0 - b_val);
        } else if (operation == 8) {
            result = pow(a_val, b_val);
        } else if (operation == 9) {
            result = sqrt(max(a_val, 0.0));
        } else if (operation == 10) {
            result = 1.0 - a_val;
        } else if (operation == 11) {
            result = 0.5 * (a_val + b_val);
        } else if (operation == 12) {
            result = b_val != 0.0 ? mod(a_val, b_val) : 0.0;
        } else if (operation == 13) {
            result = (a_val >= b_val) ? 1.0 : 0.0;
        }

        if (i == 0) {
            out_rgb.r = result;
        } else if (i == 1) {
            out_rgb.g = result;
        } else {
            out_rgb.b = result;
        }
    }

    return vec4(out_rgb, color.a);
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_channel_shuffle_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::channel_shuffle".to_string(),
        display_name: "Channel Shuffle (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Shuffle RGBA channels".to_string(),
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
                key: "red_source".to_string(),
                label: "Red Source".to_string(),
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
            },
            ManifestParam {
                key: "green_source".to_string(),
                label: "Green Source".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(1),
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
            },
            ManifestParam {
                key: "blue_source".to_string(),
                label: "Blue Source".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(2),
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
            },
            ManifestParam {
                key: "alpha_source".to_string(),
                label: "Alpha Source".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(3),
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
            },
        ],
        kernel: r#"
    int r_idx = clamp(red_source, 0, 3);
    int g_idx = clamp(green_source, 0, 3);
    int b_idx = clamp(blue_source, 0, 3);
    int a_idx = clamp(alpha_source, 0, 3);
    float channels[4] = float[4](color.r, color.g, color.b, color.a);
    return vec4(
        channels[r_idx],
        channels[g_idx],
        channels[b_idx],
        channels[a_idx]
    );
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_copy_channels_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::copy_channels".to_string(),
        display_name: "Copy Channels (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Copy channels between two images".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "A".to_string(),
                ty: "Image".to_string(),
                optional: false,
            },
            ManifestPort {
                name: "b_image".to_string(),
                label: "B".to_string(),
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
                key: "red_from".to_string(),
                label: "Red".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(0),
                min: Some(0.0),
                max: Some(7.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "A Red".to_string(),
                    "A Green".to_string(),
                    "A Blue".to_string(),
                    "A Alpha".to_string(),
                    "B Red".to_string(),
                    "B Green".to_string(),
                    "B Blue".to_string(),
                    "B Alpha".to_string(),
                ],
            },
            ManifestParam {
                key: "green_from".to_string(),
                label: "Green".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(1),
                min: Some(0.0),
                max: Some(7.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "A Red".to_string(),
                    "A Green".to_string(),
                    "A Blue".to_string(),
                    "A Alpha".to_string(),
                    "B Red".to_string(),
                    "B Green".to_string(),
                    "B Blue".to_string(),
                    "B Alpha".to_string(),
                ],
            },
            ManifestParam {
                key: "blue_from".to_string(),
                label: "Blue".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(2),
                min: Some(0.0),
                max: Some(7.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "A Red".to_string(),
                    "A Green".to_string(),
                    "A Blue".to_string(),
                    "A Alpha".to_string(),
                    "B Red".to_string(),
                    "B Green".to_string(),
                    "B Blue".to_string(),
                    "B Alpha".to_string(),
                ],
            },
            ManifestParam {
                key: "alpha_from".to_string(),
                label: "Alpha".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(3),
                min: Some(0.0),
                max: Some(7.0),
                step: Some(1.0),
                ui: Some("Dropdown".to_string()),
                options: vec![
                    "A Red".to_string(),
                    "A Green".to_string(),
                    "A Blue".to_string(),
                    "A Alpha".to_string(),
                    "B Red".to_string(),
                    "B Green".to_string(),
                    "B Blue".to_string(),
                    "B Alpha".to_string(),
                ],
            },
        ],
        kernel: r#"
    vec4 b = imageLoad(u_b_image, pixel);
    int r_idx = clamp(red_from, 0, 7);
    int g_idx = clamp(green_from, 0, 7);
    int b_idx = clamp(blue_from, 0, 7);
    int a_idx = clamp(alpha_from, 0, 7);
    float all[8] = float[8](color.r, color.g, color.b, color.a, b.r, b.g, b.b, b.a);
    return vec4(
        all[r_idx],
        all[g_idx],
        all[b_idx],
        all[a_idx]
    );
"#
        .trim()
        .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transpile::glsl_to_wgsl;

    fn assert_manifest_transpiles(manifest: KernelManifest) {
        let glsl = manifest.build_glsl().expect("GLSL should build");
        let wgsl = glsl_to_wgsl(&glsl).expect("GLSL should transpile to WGSL");
        assert!(wgsl.contains("fn main"));
        assert!(!wgsl.is_empty());
    }

    #[test]
    fn test_blend_manifest_transpile() {
        assert_manifest_transpiles(builtin_blend_manifest());
    }

    #[test]
    fn test_alpha_over_manifest_transpile() {
        assert_manifest_transpiles(builtin_alpha_over_manifest());
    }

    #[test]
    fn test_merge_manifest_transpile() {
        assert_manifest_transpiles(builtin_merge_manifest());
    }

    #[test]
    fn test_key_mix_manifest_transpile() {
        assert_manifest_transpiles(builtin_key_mix_manifest());
    }

    #[test]
    fn test_image_math_manifest_transpile() {
        assert_manifest_transpiles(builtin_image_math_manifest());
    }

    #[test]
    fn test_channel_shuffle_manifest_transpile() {
        assert_manifest_transpiles(builtin_channel_shuffle_manifest());
    }

    #[test]
    fn test_copy_channels_manifest_transpile() {
        assert_manifest_transpiles(builtin_copy_channels_manifest());
    }
}
