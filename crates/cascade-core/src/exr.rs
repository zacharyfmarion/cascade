//! OpenEXR multi-layer support — metadata parsing and core types.
//!
//! This module provides types for describing EXR layer structure and a parser
//! that reads EXR headers without decoding pixel data. The resulting
//! [`ExrMetadata`] drives dynamic output port generation on the LoadImage node.

use crate::error::CascadeError;
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// How a layer maps to the Cascade type system.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExrLayerKind {
    /// ≥3 channels with recognizable RGBA-like names → `ValueType::Image`
    Rgba,
    /// 1 channel (depth, mist, AO, etc.) → `ValueType::Mask`
    Mask,
}

/// Which EXR channels map to which RGBA slot for a given layer.
#[derive(Clone, Debug)]
pub struct ExrChannelSet {
    /// EXR channel name mapped to R (e.g. "R", "diffuse.R")
    pub r: Option<String>,
    /// EXR channel name mapped to G
    pub g: Option<String>,
    /// EXR channel name mapped to B
    pub b: Option<String>,
    /// EXR channel name mapped to A (None → fill 1.0)
    pub a: Option<String>,
}

/// Metadata for one layer — NO pixel data.
#[derive(Clone, Debug)]
pub struct ExrLayerDescriptor {
    /// Original EXR layer name (e.g. "ViewLayer.Mist")
    pub layer_name: String,
    /// Sanitized stable port ID (e.g. "viewlayer_mist")
    pub port_name: String,
    /// Display label (e.g. "Mist")
    pub label: String,
    /// Whether this maps to Image (RGBA) or Mask (single-channel)
    pub kind: ExrLayerKind,
    /// Layer width in pixels
    pub width: u32,
    /// Layer height in pixels
    pub height: u32,
    /// Channel mapping for this layer
    pub channel_set: ExrChannelSet,
    /// Raw channel names in this layer (for debugging / display)
    pub raw_channel_names: Vec<String>,
}

/// Parsed EXR file manifest — everything needed to build dynamic outputs.
#[derive(Clone, Debug)]
pub struct ExrMetadata {
    /// Width of the primary (display) window
    pub primary_width: u32,
    /// Height of the primary (display) window
    pub primary_height: u32,
    /// All usable layers in the file
    pub layers: Vec<ExrLayerDescriptor>,
    /// `port_name` of the layer that maps to the default "image" output
    pub primary_layer_port: Option<String>,
}

// ---------------------------------------------------------------------------
// EXR detection
// ---------------------------------------------------------------------------

/// Magic bytes for OpenEXR files: 0x762f3101
const EXR_MAGIC: [u8; 4] = [0x76, 0x2f, 0x31, 0x01];

/// Returns `true` if the byte slice starts with the OpenEXR magic number.
pub fn is_exr(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0..4] == EXR_MAGIC
}

// ---------------------------------------------------------------------------
// Port name sanitization
// ---------------------------------------------------------------------------

/// Convert a raw EXR layer name to a stable, unique port name.
///
/// Rules: lowercase, non-alphanumeric → `_`, collapse runs of `_`, trim.
fn sanitize_port_name(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    // Collapse runs of underscores
    let mut result = String::with_capacity(sanitized.len());
    let mut prev_underscore = false;
    for c in sanitized.chars() {
        if c == '_' {
            if !prev_underscore {
                result.push(c);
            }
            prev_underscore = true;
        } else {
            result.push(c);
            prev_underscore = false;
        }
    }
    let trimmed = result.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "layer".to_string()
    } else {
        trimmed
    }
}

/// Ensure port names are unique by appending `_2`, `_3`, etc.
fn deduplicate_port_names(layers: &mut [ExrLayerDescriptor]) {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    for layer in layers.iter_mut() {
        let count = seen.entry(layer.port_name.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            layer.port_name = format!("{}_{}", layer.port_name, count);
        }
    }
}

/// Derive a short display label from a layer name.
///
/// Takes the last dot-separated segment: "ViewLayer.Combined" → "Combined"
fn derive_label(layer_name: &str) -> String {
    layer_name
        .rsplit('.')
        .next()
        .unwrap_or(layer_name)
        .to_string()
}

// ---------------------------------------------------------------------------
// Channel classification
// ---------------------------------------------------------------------------

/// Classify raw channel names (without layer prefix) into an ExrChannelSet + kind.
fn classify_channels(channel_names: &[String]) -> Option<(ExrLayerKind, ExrChannelSet)> {
    let names: Vec<&str> = channel_names.iter().map(|s| s.as_str()).collect();

    // Try RGBA mapping
    let has = |target: &str| -> Option<String> {
        names
            .iter()
            .find(|n| n.eq_ignore_ascii_case(target))
            .map(|s| s.to_string())
    };

    let r = has("R")
        .or_else(|| has("X"))
        .or_else(|| has("r"))
        .or_else(|| has("x"));
    let g = has("G")
        .or_else(|| has("Y").filter(|_| r.is_some()))
        .or_else(|| has("g"))
        .or_else(|| has("y").filter(|_| r.is_some()));
    let b = has("B")
        .or_else(|| has("Z").filter(|_| r.is_some() && g.is_some()))
        .or_else(|| has("b"))
        .or_else(|| has("z").filter(|_| r.is_some() && g.is_some()));
    let a = has("A").or_else(|| has("a"));

    // ≥3 channels with R,G,B → Rgba
    if r.is_some() && g.is_some() && b.is_some() {
        return Some((ExrLayerKind::Rgba, ExrChannelSet { r, g, b, a }));
    }

    // Single channel → Mask
    if names.len() == 1 {
        return Some((
            ExrLayerKind::Mask,
            ExrChannelSet {
                r: Some(names[0].to_string()),
                g: None,
                b: None,
                a: None,
            },
        ));
    }

    // Y only (luminance)
    if let Some(y) = has("Y") {
        if names.len() == 1 || (names.len() == 2 && a.is_some()) {
            if a.is_some() {
                // Y + A → Rgba (replicate Y to RGB)
                return Some((
                    ExrLayerKind::Rgba,
                    ExrChannelSet {
                        r: Some(y.clone()),
                        g: Some(y.clone()),
                        b: Some(y),
                        a,
                    },
                ));
            } else {
                // Y only → Mask
                return Some((
                    ExrLayerKind::Mask,
                    ExrChannelSet {
                        r: Some(y),
                        g: None,
                        b: None,
                        a: None,
                    },
                ));
            }
        }
    }

    // 2 channels that aren't Y+A — can't meaningfully map, treat first as mask
    if names.len() >= 2 && r.is_none() {
        return Some((
            ExrLayerKind::Mask,
            ExrChannelSet {
                r: Some(names[0].to_string()),
                g: None,
                b: None,
                a: None,
            },
        ));
    }

    None // Unsupported channel layout
}

// ---------------------------------------------------------------------------
// Metadata parsing
// ---------------------------------------------------------------------------

/// Parse EXR headers from raw bytes without decoding pixel data.
///
/// Returns an [`ExrMetadata`] describing all usable layers, or a
/// [`CascadeError`] if the file cannot be parsed.
pub fn parse_exr_metadata(bytes: &[u8]) -> Result<ExrMetadata, CascadeError> {
    use exr::prelude::*;

    let meta = MetaData::read_from_buffered(std::io::Cursor::new(bytes), false)
        .map_err(|e| CascadeError::ExrDecode(format!("Failed to read EXR metadata: {e}")))?;

    let mut layers = Vec::new();
    let mut primary_width = 0u32;
    let mut primary_height = 0u32;

    for (layer_idx, header) in meta.headers.iter().enumerate() {
        // Get layer dimensions from data window
        let data_window = header.shared_attributes.display_window;
        let w = (data_window.size.x()) as u32;
        let h = (data_window.size.y()) as u32;

        if layer_idx == 0 {
            primary_width = w;
            primary_height = h;
        }

        // Get layer name
        let layer_name = header
            .own_attributes
            .layer_name
            .as_ref()
            .map(|t| t.to_string())
            .unwrap_or_default();

        // Extract channel names (strip layer prefix if present)
        let raw_channel_names: Vec<String> = header
            .channels
            .list
            .iter()
            .map(|ch| {
                let full_name = ch.name.to_string();
                // Strip layer prefix: "diffuse.R" → "R" (if layer is "diffuse")
                if !layer_name.is_empty() {
                    if let Some(stripped) = full_name.strip_prefix(&layer_name) {
                        if let Some(stripped) = stripped.strip_prefix('.') {
                            return stripped.to_string();
                        }
                    }
                }
                // For the default layer (empty name), channel names are just "R", "G", etc.
                full_name
            })
            .collect();

        // Classify channels
        let (kind, channel_set) = match classify_channels(&raw_channel_names) {
            Some(result) => result,
            None => {
                // Unsupported channel layout — skip this layer (will be reported via toast)
                continue;
            }
        };

        let port_name = if layer_name.is_empty() {
            "image".to_string()
        } else {
            sanitize_port_name(&layer_name)
        };

        let label = if layer_name.is_empty() {
            "Image".to_string()
        } else {
            derive_label(&layer_name)
        };

        layers.push(ExrLayerDescriptor {
            layer_name,
            port_name,
            label,
            kind,
            width: w,
            height: h,
            channel_set,
            raw_channel_names,
        });
    }

    // Deduplicate port names
    deduplicate_port_names(&mut layers);

    // Determine primary layer
    let primary_layer_port = find_primary_layer(&layers);

    Ok(ExrMetadata {
        primary_width,
        primary_height,
        layers,
        primary_layer_port,
    })
}

/// Find the primary RGBA layer for the default "image" output.
///
/// Priority:
/// 1. Layer with empty name containing RGBA channels
/// 2. Layer named "Combined" or "rgba" with RGBA channels
/// 3. First layer with RGBA kind
fn find_primary_layer(layers: &[ExrLayerDescriptor]) -> Option<String> {
    // 1. Empty-name layer with RGBA
    if let Some(l) = layers
        .iter()
        .find(|l| l.layer_name.is_empty() && l.kind == ExrLayerKind::Rgba)
    {
        return Some(l.port_name.clone());
    }

    // 2. "Combined" or "rgba" named layer
    for name in &["combined", "rgba"] {
        if let Some(l) = layers
            .iter()
            .find(|l| l.layer_name.to_lowercase() == *name && l.kind == ExrLayerKind::Rgba)
        {
            return Some(l.port_name.clone());
        }
    }

    // 3. First RGBA layer
    if let Some(l) = layers.iter().find(|l| l.kind == ExrLayerKind::Rgba) {
        return Some(l.port_name.clone());
    }

    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_exr_magic_bytes() {
        assert!(is_exr(&[0x76, 0x2f, 0x31, 0x01, 0x00]));
        assert!(!is_exr(&[0x89, 0x50, 0x4e, 0x47])); // PNG
        assert!(!is_exr(&[0xff, 0xd8, 0xff])); // JPEG
        assert!(!is_exr(&[0x76, 0x2f])); // Too short
        assert!(!is_exr(&[]));
    }

    #[test]
    fn test_sanitize_port_name() {
        assert_eq!(
            sanitize_port_name("ViewLayer.Combined"),
            "viewlayer_combined"
        );
        assert_eq!(sanitize_port_name("diffuse"), "diffuse");
        assert_eq!(sanitize_port_name("Render Layer.Mist"), "render_layer_mist");
        assert_eq!(sanitize_port_name("   "), "layer");
        assert_eq!(sanitize_port_name("a..b"), "a_b");
        assert_eq!(sanitize_port_name("DEPTH"), "depth");
    }

    #[test]
    fn test_derive_label() {
        assert_eq!(derive_label("ViewLayer.Combined"), "Combined");
        assert_eq!(derive_label("diffuse"), "diffuse");
        assert_eq!(derive_label("Render.Layer.Mist"), "Mist");
        assert_eq!(derive_label(""), "");
    }

    #[test]
    fn test_classify_rgba_channels() {
        let channels = vec!["R".into(), "G".into(), "B".into(), "A".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Rgba);
        assert_eq!(set.r.as_deref(), Some("R"));
        assert_eq!(set.g.as_deref(), Some("G"));
        assert_eq!(set.b.as_deref(), Some("B"));
        assert_eq!(set.a.as_deref(), Some("A"));
    }

    #[test]
    fn test_classify_rgb_no_alpha() {
        let channels = vec!["R".into(), "G".into(), "B".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Rgba);
        assert!(set.a.is_none());
    }

    #[test]
    fn test_classify_xyz_normals() {
        let channels = vec!["X".into(), "Y".into(), "Z".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Rgba);
        assert_eq!(set.r.as_deref(), Some("X"));
        assert_eq!(set.g.as_deref(), Some("Y"));
        assert_eq!(set.b.as_deref(), Some("Z"));
    }

    #[test]
    fn test_classify_single_channel_depth() {
        let channels = vec!["Z".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Mask);
        assert_eq!(set.r.as_deref(), Some("Z"));
    }

    #[test]
    fn test_classify_y_luminance() {
        let channels = vec!["Y".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Mask);
        assert_eq!(set.r.as_deref(), Some("Y"));
    }

    #[test]
    fn test_classify_ya_luminance_alpha() {
        let channels = vec!["Y".into(), "A".into()];
        let (kind, set) = classify_channels(&channels).unwrap();
        assert_eq!(kind, ExrLayerKind::Rgba);
        assert_eq!(set.r.as_deref(), Some("Y"));
        assert_eq!(set.g.as_deref(), Some("Y"));
        assert_eq!(set.b.as_deref(), Some("Y"));
        assert_eq!(set.a.as_deref(), Some("A"));
    }

    #[test]
    fn test_deduplicate_port_names() {
        let mut layers = vec![
            ExrLayerDescriptor {
                layer_name: "a".into(),
                port_name: "depth".into(),
                label: "Depth".into(),
                kind: ExrLayerKind::Mask,
                width: 100,
                height: 100,
                channel_set: ExrChannelSet {
                    r: Some("Z".into()),
                    g: None,
                    b: None,
                    a: None,
                },
                raw_channel_names: vec!["Z".into()],
            },
            ExrLayerDescriptor {
                layer_name: "b".into(),
                port_name: "depth".into(),
                label: "Depth".into(),
                kind: ExrLayerKind::Mask,
                width: 100,
                height: 100,
                channel_set: ExrChannelSet {
                    r: Some("Z".into()),
                    g: None,
                    b: None,
                    a: None,
                },
                raw_channel_names: vec!["Z".into()],
            },
        ];
        deduplicate_port_names(&mut layers);
        assert_eq!(layers[0].port_name, "depth");
        assert_eq!(layers[1].port_name, "depth_2");
    }

    #[test]
    fn test_find_primary_layer_empty_name() {
        let layers = vec![
            ExrLayerDescriptor {
                layer_name: "".into(),
                port_name: "image".into(),
                label: "Image".into(),
                kind: ExrLayerKind::Rgba,
                width: 100,
                height: 100,
                channel_set: ExrChannelSet {
                    r: Some("R".into()),
                    g: Some("G".into()),
                    b: Some("B".into()),
                    a: Some("A".into()),
                },
                raw_channel_names: vec!["R".into(), "G".into(), "B".into(), "A".into()],
            },
            ExrLayerDescriptor {
                layer_name: "depth".into(),
                port_name: "depth".into(),
                label: "Depth".into(),
                kind: ExrLayerKind::Mask,
                width: 100,
                height: 100,
                channel_set: ExrChannelSet {
                    r: Some("Z".into()),
                    g: None,
                    b: None,
                    a: None,
                },
                raw_channel_names: vec!["Z".into()],
            },
        ];
        assert_eq!(find_primary_layer(&layers), Some("image".into()));
    }

    #[test]
    fn test_find_primary_layer_combined() {
        let layers = vec![ExrLayerDescriptor {
            layer_name: "Combined".into(),
            port_name: "combined".into(),
            label: "Combined".into(),
            kind: ExrLayerKind::Rgba,
            width: 100,
            height: 100,
            channel_set: ExrChannelSet {
                r: Some("R".into()),
                g: Some("G".into()),
                b: Some("B".into()),
                a: Some("A".into()),
            },
            raw_channel_names: vec!["R".into(), "G".into(), "B".into(), "A".into()],
        }];
        assert_eq!(find_primary_layer(&layers), Some("combined".into()));
    }
}
