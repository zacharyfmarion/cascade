use cascade_core::error::CascadeError;
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use std::any::Any;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct ColorPaletteNode {
    loaded_file_data: Mutex<Option<Vec<u8>>>,
}

impl Default for ColorPaletteNode {
    fn default() -> Self {
        Self::new()
    }
}

impl ColorPaletteNode {
    pub fn new() -> Self {
        Self {
            loaded_file_data: Mutex::new(None),
        }
    }

    pub fn load_palette_data(&self, bytes: &[u8]) -> Result<Vec<[f64; 4]>, CascadeError> {
        {
            let mut guard = self
                .loaded_file_data
                .lock()
                .map_err(|_| CascadeError::Other("Palette mutex poisoned".to_string()))?;
            *guard = Some(bytes.to_vec());
        }

        let mut colors = if let Ok(text) = std::str::from_utf8(bytes) {
            if text.trim_start().starts_with("GIMP Palette") {
                parse_gpl(text)?
            } else {
                parse_image_palette(bytes)?
            }
        } else {
            parse_image_palette(bytes)?
        };

        sort_colors_perceptual(&mut colors);
        Ok(colors)
    }
}

/// GPL format: "GIMP Palette\nName: ...\n#\n R G B\tOptionalName\n..."
fn parse_gpl(text: &str) -> Result<Vec<[f64; 4]>, CascadeError> {
    let mut colors = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty()
            || trimmed.starts_with("GIMP Palette")
            || trimmed.starts_with("Name:")
            || trimmed.starts_with("Columns:")
            || trimmed.starts_with('#')
        {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 3 {
            let r = parts[0]
                .parse::<u8>()
                .map_err(|e| CascadeError::Other(format!("GPL parse error: {e}")))?;
            let g = parts[1]
                .parse::<u8>()
                .map_err(|e| CascadeError::Other(format!("GPL parse error: {e}")))?;
            let b = parts[2]
                .parse::<u8>()
                .map_err(|e| CascadeError::Other(format!("GPL parse error: {e}")))?;

            colors.push([
                srgb_byte_to_linear(r),
                srgb_byte_to_linear(g),
                srgb_byte_to_linear(b),
                1.0,
            ]);
        }
    }

    if colors.is_empty() {
        return Err(CascadeError::Other(
            "GPL file contains no valid colors".to_string(),
        ));
    }

    Ok(colors)
}

fn parse_image_palette(bytes: &[u8]) -> Result<Vec<[f64; 4]>, CascadeError> {
    let decoded =
        image::load_from_memory(bytes).map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());

    let mut seen = std::collections::HashSet::new();
    let mut colors = Vec::new();

    if height == 1 {
        for x in 0..width {
            let pixel = rgba.get_pixel(x, 0);
            let key = [pixel[0], pixel[1], pixel[2], pixel[3]];
            colors.push([
                srgb_byte_to_linear(key[0]),
                srgb_byte_to_linear(key[1]),
                srgb_byte_to_linear(key[2]),
                key[3] as f64 / 255.0,
            ]);
        }
    } else {
        for y in 0..height {
            for x in 0..width {
                let pixel = rgba.get_pixel(x, y);
                let key = [pixel[0], pixel[1], pixel[2], pixel[3]];
                if seen.insert(key) {
                    colors.push([
                        srgb_byte_to_linear(key[0]),
                        srgb_byte_to_linear(key[1]),
                        srgb_byte_to_linear(key[2]),
                        key[3] as f64 / 255.0,
                    ]);
                }
            }
        }
    }

    if colors.is_empty() {
        return Err(CascadeError::Other("Image contains no colors".to_string()));
    }

    colors.truncate(256);

    Ok(colors)
}

fn linear_to_srgb(v: f64) -> f64 {
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if (max - min).abs() < 1e-10 {
        return (0.0, 0.0, l);
    }

    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };

    let h = if (max - r).abs() < 1e-10 {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < 1e-10 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };

    (h / 6.0, s, l)
}

fn color_to_hsl(c: &[f64; 4]) -> (f64, f64, f64) {
    let (r, g, b) = (
        linear_to_srgb(c[0]),
        linear_to_srgb(c[1]),
        linear_to_srgb(c[2]),
    );
    rgb_to_hsl(r, g, b)
}

fn sort_colors_perceptual(colors: &mut Vec<[f64; 4]>) {
    const SATURATION_THRESHOLD: f64 = 0.12;
    const HUE_BANDS: usize = 8;

    let mut chromatic: Vec<[f64; 4]> = Vec::new();
    let mut achromatic: Vec<[f64; 4]> = Vec::new();

    for &c in colors.iter() {
        let (_, s, _) = color_to_hsl(&c);
        if s < SATURATION_THRESHOLD {
            achromatic.push(c);
        } else {
            chromatic.push(c);
        }
    }

    let mut bands: Vec<Vec<[f64; 4]>> = (0..HUE_BANDS).map(|_| Vec::new()).collect();
    for c in chromatic {
        let (h, _, _) = color_to_hsl(&c);
        let band = ((h * HUE_BANDS as f64).floor() as usize).min(HUE_BANDS - 1);
        bands[band].push(c);
    }

    for band in &mut bands {
        band.sort_by(|a, b| {
            let (_, _, al) = color_to_hsl(a);
            let (_, _, bl) = color_to_hsl(b);
            bl.partial_cmp(&al).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    achromatic.sort_by(|a, b| {
        let (_, _, al) = color_to_hsl(a);
        let (_, _, bl) = color_to_hsl(b);
        bl.partial_cmp(&al).unwrap_or(std::cmp::Ordering::Equal)
    });

    colors.clear();
    for band in bands {
        colors.extend(band);
    }
    colors.extend(achromatic);
}

fn srgb_byte_to_linear(byte: u8) -> f64 {
    let v = byte as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn default_palette() -> Vec<[f64; 4]> {
    [
        [0u8, 0, 0],
        [255, 255, 255],
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
        [0, 255, 255],
        [255, 0, 255],
    ]
    .iter()
    .map(|[r, g, b]| {
        [
            srgb_byte_to_linear(*r),
            srgb_byte_to_linear(*g),
            srgb_byte_to_linear(*b),
            1.0,
        ]
    })
    .collect()
}

impl Node for ColorPaletteNode {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "color_palette".to_string(),
            display_name: "Color Palette".to_string(),
            category: "Color".to_string(),
            description: "Define a color palette. Outputs a 1×N palette strip image.".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "palette".to_string(),
                label: "Palette".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "colors".to_string(),
                label: "Colors".to_string(),
                ty: ValueType::Color,
                default: ParamDefault::ColorPalette(default_palette()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::ColorPalette,
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let colors = ctx.get_param_color_palette("colors")?;

            if colors.is_empty() {
                return Err(CascadeError::Other("Color palette is empty".to_string()));
            }

            let width = colors.len() as u32;
            let height = 1u32;
            let mut data = Vec::with_capacity(colors.len() * 4);
            for color in colors {
                data.push(color[0] as f32);
                data.push(color[1] as f32);
                data.push(color[2] as f32);
                data.push(color[3] as f32);
            }

            let image = Image::from_f32_data(width, height, data)?;
            let mut outputs = HashMap::new();
            outputs.insert("palette".to_string(), Value::Image(image));
            Ok(outputs)
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gpl() {
        let gpl = r#"GIMP Palette
Name: Test
Columns: 8
#
  0   0   0	Black
255 255 255	White
128  64  32	Brown
"#;
        let colors = parse_gpl(gpl).unwrap();
        assert_eq!(colors.len(), 3);
        assert!((colors[0][0]).abs() < 0.001);
        assert!((colors[0][1]).abs() < 0.001);
        assert!((colors[0][2]).abs() < 0.001);
        assert!((colors[0][3] - 1.0).abs() < 0.001);
        assert!((colors[1][0] - 1.0).abs() < 0.001);
        assert!((colors[1][1] - 1.0).abs() < 0.001);
        assert!((colors[1][2] - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_default_palette_not_empty() {
        let palette = default_palette();
        assert_eq!(palette.len(), 8);
    }

    #[test]
    fn test_srgb_byte_to_linear_boundaries() {
        assert!((srgb_byte_to_linear(0)).abs() < 0.0001);
        assert!((srgb_byte_to_linear(255) - 1.0).abs() < 0.0001);
    }

    #[test]
    fn test_sort_colors_perceptual() {
        let red = [
            srgb_byte_to_linear(255),
            srgb_byte_to_linear(0),
            srgb_byte_to_linear(0),
            1.0,
        ];
        let dark_red = [
            srgb_byte_to_linear(128),
            srgb_byte_to_linear(0),
            srgb_byte_to_linear(0),
            1.0,
        ];
        let green = [
            srgb_byte_to_linear(0),
            srgb_byte_to_linear(255),
            srgb_byte_to_linear(0),
            1.0,
        ];
        let blue = [
            srgb_byte_to_linear(0),
            srgb_byte_to_linear(0),
            srgb_byte_to_linear(255),
            1.0,
        ];
        let gray = [
            srgb_byte_to_linear(128),
            srgb_byte_to_linear(128),
            srgb_byte_to_linear(128),
            1.0,
        ];
        let white = [
            srgb_byte_to_linear(255),
            srgb_byte_to_linear(255),
            srgb_byte_to_linear(255),
            1.0,
        ];

        let mut colors = vec![gray, blue, dark_red, white, red, green];
        sort_colors_perceptual(&mut colors);

        let chromatic = &colors[..4];
        let achro = &colors[4..];

        for c in achro {
            let (_, s, _) = color_to_hsl(c);
            assert!(s < 0.12, "Achromatic colors should be at the end");
        }
        assert!(
            color_to_hsl(&achro[0]).2 > color_to_hsl(&achro[1]).2,
            "Achromatic colors should be sorted light to dark"
        );

        let red_idx = chromatic.iter().position(|c| *c == red).unwrap();
        let dark_red_idx = chromatic.iter().position(|c| *c == dark_red).unwrap();
        assert!(
            red_idx < dark_red_idx,
            "Within same hue band, lighter colors should come first"
        );

        let hue_bands: Vec<usize> = chromatic
            .iter()
            .map(|c| {
                let (h, _, _) = color_to_hsl(c);
                (h * 8.0).floor() as usize
            })
            .collect();
        for w in hue_bands.windows(2) {
            assert!(w[0] <= w[1], "Hue bands should be in order");
        }
    }
}
