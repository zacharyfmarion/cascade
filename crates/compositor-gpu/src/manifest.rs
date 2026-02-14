use compositor_core::types::{NodeSpec, ParamDefault, ParamSpec, PortSpec, UiHint, ValueType};
use serde::{Deserialize, Serialize};

use crate::template::{build_kernel_template, KernelParam, ParamType};

#[derive(Deserialize, Serialize, Clone)]
pub struct KernelManifest {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub description: String,
    pub inputs: Vec<ManifestPort>,
    pub outputs: Vec<ManifestPort>,
    pub params: Vec<ManifestParam>,
    pub kernel: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ManifestPort {
    pub name: String,
    pub label: String,
    pub ty: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ManifestParam {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub default: serde_json::Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub ui: Option<String>,
}

impl KernelManifest {
    pub fn to_node_spec(&self) -> Result<NodeSpec, String> {
        let inputs = self
            .inputs
            .iter()
            .map(|port| {
                let ty = parse_value_type(&port.ty)?;
                Ok(PortSpec {
                    name: port.name.clone(),
                    label: port.label.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let outputs = self
            .outputs
            .iter()
            .map(|port| {
                let ty = parse_value_type(&port.ty)?;
                Ok(PortSpec {
                    name: port.name.clone(),
                    label: port.label.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let params = self
            .params
            .iter()
            .map(|param| {
                let ty = parse_value_type(&param.ty)?;
                let default = parse_param_default(&param.default, &ty)?;
                let ui_hint = parse_ui_hint(param.ui.as_deref(), &ty);
                Ok(ParamSpec {
                    key: param.key.clone(),
                    label: param.label.clone(),
                    ty,
                    default,
                    min: param.min,
                    max: param.max,
                    step: param.step,
                    ui_hint,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(NodeSpec {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            category: self.category.clone(),
            description: self.description.clone(),
            inputs,
            outputs,
            params,
        })
    }

    pub fn build_glsl(&self) -> Result<String, String> {
        let image_inputs: Vec<String> = self
            .inputs
            .iter()
            .filter(|port| matches_image_type(&port.ty))
            .map(|port| port.name.clone())
            .collect();

        if image_inputs.is_empty() {
            return Err("Kernel manifest requires at least one image input".to_string());
        }

        let params = self
            .params
            .iter()
            .map(|param| {
                let ty = parse_param_type(&param.ty)?;
                Ok(KernelParam {
                    name: param.key.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let scalar_inputs = self
            .inputs
            .iter()
            .filter(|port| matches_scalar_type(&port.ty))
            .map(|port| {
                let ty = parse_param_type(&port.ty)?;
                Ok(KernelParam {
                    name: port.name.clone(),
                    ty,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let extra_images = image_inputs.into_iter().skip(1).collect::<Vec<_>>();
        Ok(build_kernel_template(
            &self.kernel,
            &params,
            &extra_images,
            &scalar_inputs,
        ))
    }
}

pub fn builtin_pixelate_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::pixelate".to_string(),
        display_name: "Pixelate (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Pixelate an image by snapping pixels to block centers".to_string(),
        inputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
        }],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
        }],
        params: vec![ManifestParam {
            key: "pixel_size".to_string(),
            label: "Pixel Size".to_string(),
            ty: "Int".to_string(),
            default: serde_json::Value::from(4),
            min: Some(1.0),
            max: Some(128.0),
            step: Some(1.0),
            ui: Some("NumberInput".to_string()),
        }],
        kernel: r#"
    ivec2 dims = imageSize(u_input);
    int block = max(pixel_size, 1);
    ivec2 block_origin = (pixel / block) * block + block / 2;
    block_origin = clamp(block_origin, ivec2(0), dims - 1);
    vec4 pixelated = imageLoad(u_input, block_origin);
    return pixelated;
"#
        .trim()
        .to_string(),
    }
}

pub fn builtin_dither_manifest() -> KernelManifest {
    KernelManifest {
        id: "gpu_kernel::dither".to_string(),
        display_name: "Dither (GPU)".to_string(),
        category: "GPU".to_string(),
        description: "Apply Bayer dithering to an image using a palette strip".to_string(),
        inputs: vec![
            ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
            },
            ManifestPort {
                name: "palette".to_string(),
                label: "Palette".to_string(),
                ty: "Image".to_string(),
            },
        ],
        outputs: vec![ManifestPort {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: "Image".to_string(),
        }],
        params: vec![
            ManifestParam {
                key: "dither_amount".to_string(),
                label: "Dither Amount".to_string(),
                ty: "Float".to_string(),
                default: serde_json::Value::from(1.0),
                min: Some(0.0),
                max: Some(1.0),
                step: Some(0.01),
                ui: Some("Slider".to_string()),
            },
            ManifestParam {
                key: "palette_size".to_string(),
                label: "Palette Size".to_string(),
                ty: "Int".to_string(),
                default: serde_json::Value::from(16),
                min: Some(1.0),
                max: Some(256.0),
                step: Some(1.0),
                ui: Some("NumberInput".to_string()),
            },
        ],
        kernel: r#"
    ivec2 pal_dims = imageSize(u_palette);
    int pal_count = min(pal_dims.x, palette_size);
    pal_count = max(pal_count, 1);

    float best_dist1 = 1e10;
    float best_dist2 = 1e10;
    vec3 best_col1 = vec3(0.0);
    vec3 best_col2 = vec3(0.0);

    for (int i = 0; i < pal_count; i++) {
        vec4 pal_color = imageLoad(u_palette, ivec2(i, 0));
        vec3 diff = color.rgb - pal_color.rgb;
        float dist = dot(diff, diff);
        if (dist < best_dist1) {
            best_dist2 = best_dist1;
            best_col2 = best_col1;
            best_dist1 = dist;
            best_col1 = pal_color.rgb;
        } else if (dist < best_dist2) {
            best_dist2 = dist;
            best_col2 = pal_color.rgb;
        }
    }

    float threshold = bayer8(pixel.x, pixel.y);
    float total_dist = best_dist1 + best_dist2;
    float ratio = (total_dist > 0.0001) ? best_dist1 / total_dist : 0.0;
    ratio = mix(round(ratio), ratio, dither_amount);
    vec3 result = (threshold < ratio) ? best_col2 : best_col1;
    return vec4(result, color.a);
"#
        .trim()
        .to_string(),
    }
}

fn parse_value_type(value: &str) -> Result<ValueType, String> {
    match value {
        "Image" => Ok(ValueType::Image),
        "Mask" => Ok(ValueType::Mask),
        "Float" => Ok(ValueType::Float),
        "Int" => Ok(ValueType::Int),
        "Bool" => Ok(ValueType::Bool),
        "Color" => Ok(ValueType::Color),
        other => Err(format!("Unsupported value type: {other}")),
    }
}

fn matches_image_type(value: &str) -> bool {
    matches!(value, "Image" | "Mask")
}

fn matches_scalar_type(value: &str) -> bool {
    matches!(value, "Float" | "Int" | "Bool")
}

fn parse_param_type(value: &str) -> Result<ParamType, String> {
    match value {
        "Float" => Ok(ParamType::Float),
        "Int" => Ok(ParamType::Int),
        "Bool" => Ok(ParamType::Bool),
        other => Err(format!("Unsupported param type: {other}")),
    }
}

fn parse_param_default(
    default: &serde_json::Value,
    ty: &ValueType,
) -> Result<ParamDefault, String> {
    match ty {
        ValueType::Float => default
            .as_f64()
            .map(ParamDefault::Float)
            .ok_or_else(|| "Expected float default".to_string()),
        ValueType::Int => default
            .as_i64()
            .map(ParamDefault::Int)
            .ok_or_else(|| "Expected int default".to_string()),
        ValueType::Bool => default
            .as_bool()
            .map(ParamDefault::Bool)
            .ok_or_else(|| "Expected bool default".to_string()),
        ValueType::Color => default
            .as_array()
            .and_then(|arr| {
                if arr.len() == 4 {
                    Some([
                        arr[0].as_f64()?,
                        arr[1].as_f64()?,
                        arr[2].as_f64()?,
                        arr[3].as_f64()?,
                    ])
                } else {
                    None
                }
            })
            .map(ParamDefault::Color)
            .ok_or_else(|| "Expected color default".to_string()),
        _ => Err("Unsupported param default type".to_string()),
    }
}

fn parse_ui_hint(ui: Option<&str>, ty: &ValueType) -> UiHint {
    match ui {
        Some("Slider") => UiHint::Slider,
        Some("NumberInput") => UiHint::NumberInput,
        Some("Checkbox") => UiHint::Checkbox,
        Some("ColorPicker") => UiHint::ColorPicker,
        Some("Dropdown") => UiHint::Dropdown(Vec::new()),
        Some("FilePicker") => UiHint::FilePicker,
        Some("Hidden") => UiHint::Hidden,
        _ => match ty {
            ValueType::Float => UiHint::Slider,
            ValueType::Int => UiHint::NumberInput,
            ValueType::Bool => UiHint::Checkbox,
            ValueType::Color => UiHint::ColorPicker,
            _ => UiHint::Hidden,
        },
    }
}
