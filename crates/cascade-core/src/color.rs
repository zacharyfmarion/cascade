use crate::error::CascadeError;
use crate::types::ColorSpaceId;
use rayon::prelude::*;
use std::sync::OnceLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ColorSpaceInfo {
    pub id: ColorSpaceId,
    pub family: String,
}

pub trait ColorProcessor: Send + Sync {
    fn apply(&self, pixels: &mut [f32]);
}

pub trait ColorManagement: Send + Sync {
    fn available_color_spaces(&self) -> Vec<ColorSpaceInfo>;
    fn available_displays(&self) -> Vec<String>;
    fn available_views(&self, display: &str) -> Vec<String>;
    fn working_space(&self) -> &ColorSpaceId;

    fn create_transform(
        &self,
        from: &ColorSpaceId,
        to: &ColorSpaceId,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError>;

    fn create_display_transform(
        &self,
        from: &ColorSpaceId,
        display: &str,
        view: &str,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError>;
}

#[derive(Clone)]
pub struct BuiltinColorManagement {
    working_space: ColorSpaceId,
}

impl BuiltinColorManagement {
    pub fn new() -> Self {
        Self {
            working_space: ColorSpaceId::default_working(),
        }
    }
}

impl Default for BuiltinColorManagement {
    fn default() -> Self {
        Self::new()
    }
}

impl ColorManagement for BuiltinColorManagement {
    fn available_color_spaces(&self) -> Vec<ColorSpaceInfo> {
        vec![
            ColorSpaceInfo {
                id: ColorSpaceId::new(ColorSpaceId::SRGB),
                family: "Display".to_string(),
            },
            ColorSpaceInfo {
                id: ColorSpaceId::new(ColorSpaceId::LINEAR_SRGB),
                family: "Scene".to_string(),
            },
        ]
    }

    fn available_displays(&self) -> Vec<String> {
        vec!["sRGB".to_string()]
    }

    fn available_views(&self, _display: &str) -> Vec<String> {
        vec!["Standard".to_string()]
    }

    fn working_space(&self) -> &ColorSpaceId {
        &self.working_space
    }

    fn create_transform(
        &self,
        from: &ColorSpaceId,
        to: &ColorSpaceId,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError> {
        let from_str = from.as_str();
        let to_str = to.as_str();
        match (from_str, to_str) {
            (ColorSpaceId::SRGB, ColorSpaceId::LINEAR_SRGB) => Ok(Box::new(SrgbToLinearProcessor)),
            (ColorSpaceId::LINEAR_SRGB, ColorSpaceId::SRGB) => Ok(Box::new(LinearToSrgbProcessor)),
            (a, b) if a == b => Ok(Box::new(NoopProcessor)),
            _ => Err(CascadeError::Other(format!(
                "Builtin color management cannot convert from '{from}' to '{to}'"
            ))),
        }
    }

    fn create_display_transform(
        &self,
        from: &ColorSpaceId,
        _display: &str,
        _view: &str,
    ) -> Result<Box<dyn ColorProcessor>, CascadeError> {
        self.create_transform(from, &ColorSpaceId::new(ColorSpaceId::SRGB))
    }
}

struct NoopProcessor;

impl ColorProcessor for NoopProcessor {
    fn apply(&self, _pixels: &mut [f32]) {}
}

struct SrgbToLinearProcessor;

impl ColorProcessor for SrgbToLinearProcessor {
    fn apply(&self, pixels: &mut [f32]) {
        pixels.par_chunks_exact_mut(4).for_each(|rgba| {
            for v in rgba.iter_mut().take(3) {
                let clamped = v.clamp(0.0, 1.0);
                *v = if clamped <= 0.04045 {
                    clamped / 12.92
                } else {
                    ((clamped + 0.055) / 1.055).powf(2.4)
                };
            }
        });
    }
}

struct LinearToSrgbProcessor;

impl ColorProcessor for LinearToSrgbProcessor {
    fn apply(&self, pixels: &mut [f32]) {
        let lut = linear_to_srgb_lut();
        pixels.par_chunks_exact_mut(4).for_each(|rgba| {
            for v in rgba.iter_mut().take(3) {
                let linear = v.clamp(0.0, 1.0);
                let lut_idx = (linear * 4095.0) as usize;
                *v = lut[lut_idx.min(4095)];
            }
        });
    }
}

fn linear_to_srgb_lut() -> &'static [f32; 4096] {
    static LUT: OnceLock<[f32; 4096]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut table = [0.0f32; 4096];
        for (i, entry) in table.iter_mut().enumerate() {
            let linear = i as f32 / 4095.0;
            let srgb = if linear <= 0.0031308 {
                linear * 12.92
            } else {
                1.055 * linear.powf(1.0 / 2.4) - 0.055
            };
            *entry = srgb;
        }
        table
    })
}
