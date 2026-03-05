//! OpenEXR multi-layer support — metadata parsing and core types.
//!
//! This module provides types for describing EXR layer structure and a parser
//! that reads EXR headers without decoding pixel data. The resulting
//! [`ExrMetadata`] drives dynamic output port generation on the LoadImage node.

use crate::error::CascadeError;
use crate::types::{Image, MAX_IMAGE_DIM};
use std::collections::{BTreeMap, HashMap};

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

/// Decode a specific EXR layer from raw bytes, returning an RGBA Image.
/// Uses the layer's channel_set mapping to produce f32 RGBA pixel data.
pub fn decode_exr_layer(
    bytes: &[u8],
    metadata: &ExrMetadata,
    port_name: &str,
) -> Result<Image, CascadeError> {
    use exr::prelude::*;

    // Find the layer descriptor
    let descriptor = metadata
        .layers
        .iter()
        .find(|l| l.port_name == port_name)
        .ok_or_else(|| {
            CascadeError::ExrDecode(format!("Layer port '{}' not found in metadata", port_name))
        })?;

    // Read the full image with all layers and channels
    let exr_image = read()
        .no_deep_data()
        .largest_resolution_level()
        .all_channels()
        .all_layers()
        .all_attributes()
        .from_buffered(std::io::Cursor::new(bytes))
        .map_err(|e| CascadeError::ExrDecode(e.to_string()))?;

    // Find matching layer in decoded data
    let layer = exr_image
        .layer_data
        .iter()
        .find(|l| {
            let name = l
                .attributes
                .layer_name
                .as_ref()
                .map(|n| n.to_string())
                .unwrap_or_default();
            // Match by original layer name
            name == descriptor.layer_name
        })
        .ok_or_else(|| {
            CascadeError::ExrDecode(format!(
                "Layer '{}' not found in EXR data",
                descriptor.layer_name
            ))
        })?;

    let size = layer.size;
    let width = size.0 as u32;
    let height = size.1 as u32;

    if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
        return Err(CascadeError::ExrLayerTooLarge {
            layer_name: descriptor.layer_name.clone(),
            width,
            height,
            max: MAX_IMAGE_DIM,
        });
    }

    let pixel_count = (width as usize) * (height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];

    // Build channel name to index map
    let channels = &layer.channel_data.list;

    // Helper: find channel data as f32 values.
    // Channel names in the decoded data use their FULL form (e.g. "BG.Depth.V")
    // while ExrChannelSet stores stripped suffixes (e.g. "V").  Try the full
    // prefixed name first, then fall back to the bare suffix for the default
    // (unnamed) layer whose channels have no prefix.
    let get_channel_f32 = |suffix: &str| -> Option<Vec<f32>> {
        let full_name = if descriptor.layer_name.is_empty() {
            suffix.to_string()
        } else {
            format!("{}.{}", descriptor.layer_name, suffix)
        };
        channels
            .iter()
            .find(|c| {
                let n = c.name.to_string();
                n == full_name || n == suffix
            })
            .map(|c| c.sample_data.values_as_f32().collect::<Vec<f32>>())
    };

    // Map channels to RGBA based on the channel set
    let r_data = descriptor
        .channel_set
        .r
        .as_ref()
        .and_then(|n| get_channel_f32(n));
    let g_data = descriptor
        .channel_set
        .g
        .as_ref()
        .and_then(|n| get_channel_f32(n));
    let b_data = descriptor
        .channel_set
        .b
        .as_ref()
        .and_then(|n| get_channel_f32(n));
    let a_data = descriptor
        .channel_set
        .a
        .as_ref()
        .and_then(|n| get_channel_f32(n));

    match descriptor.kind {
        ExrLayerKind::Rgba => {
            // Multi-channel layer: map channels to RGBA
            for i in 0..pixel_count {
                data[i * 4] = r_data.as_ref().map_or(0.0, |d| d[i]);
                data[i * 4 + 1] = g_data.as_ref().map_or(0.0, |d| d[i]);
                data[i * 4 + 2] = b_data.as_ref().map_or(0.0, |d| d[i]);
                data[i * 4 + 3] = a_data.as_ref().map_or(1.0, |d| d[i]);
            }
        }
        ExrLayerKind::Mask => {
            // Single-channel layer: replicate to RGB, A=1.0
            let ch_data = r_data
                .as_ref()
                .or(g_data.as_ref())
                .or(b_data.as_ref())
                .ok_or_else(|| {
                    CascadeError::ExrDecode(format!(
                        "No channel data found for mask layer '{}'",
                        descriptor.layer_name
                    ))
                })?;
            for i in 0..pixel_count {
                let v = ch_data[i];
                data[i * 4] = v;
                data[i * 4 + 1] = v;
                data[i * 4 + 2] = v;
                data[i * 4 + 3] = 1.0;
            }
        }
    }

    crate::types::Image::from_f32_data(width, height, data)
}

/// Decode multiple EXR layers in a single file-read pass.
///
/// Instead of calling [`decode_exr_layer`] N times (each of which decompresses
/// the entire file), this reads and decompresses the file **once** and extracts
/// all requested layers.  Pass `None` for `requested_ports` to decode every
/// layer described in `metadata`.
pub fn decode_all_layers(
    bytes: &[u8],
    metadata: &ExrMetadata,
    requested_ports: Option<&[&str]>,
) -> Result<HashMap<String, Image>, CascadeError> {
    use exr::prelude::*;

    // Determine which descriptors to decode
    let descriptors: Vec<&ExrLayerDescriptor> = metadata
        .layers
        .iter()
        .filter(|l| match &requested_ports {
            Some(ports) => ports.contains(&l.port_name.as_str()),
            None => true,
        })
        .collect();

    if descriptors.is_empty() {
        return Ok(HashMap::new());
    }

    // Single file read + decompress
    let exr_image = read()
        .no_deep_data()
        .largest_resolution_level()
        .all_channels()
        .all_layers()
        .all_attributes()
        .from_buffered(std::io::Cursor::new(bytes))
        .map_err(|e| CascadeError::ExrDecode(e.to_string()))?;

    let mut results = HashMap::with_capacity(descriptors.len());

    for descriptor in &descriptors {
        // Find matching layer in decoded data
        let layer = exr_image
            .layer_data
            .iter()
            .find(|l| {
                let name = l
                    .attributes
                    .layer_name
                    .as_ref()
                    .map(|n| n.to_string())
                    .unwrap_or_default();
                name == descriptor.layer_name
            })
            .ok_or_else(|| {
                CascadeError::ExrDecode(format!(
                    "Layer '{}' not found in EXR data",
                    descriptor.layer_name
                ))
            })?;

        let size = layer.size;
        let width = size.0 as u32;
        let height = size.1 as u32;

        if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
            return Err(CascadeError::ExrLayerTooLarge {
                layer_name: descriptor.layer_name.clone(),
                width,
                height,
                max: MAX_IMAGE_DIM,
            });
        }

        let pixel_count = (width as usize) * (height as usize);
        let mut data = vec![0.0f32; pixel_count * 4];

        let channels = &layer.channel_data.list;

        // Channel lookup: try full prefixed name first, then bare suffix
        let get_channel_f32 = |suffix: &str| -> Option<Vec<f32>> {
            let full_name = if descriptor.layer_name.is_empty() {
                suffix.to_string()
            } else {
                format!("{}.{}", descriptor.layer_name, suffix)
            };
            channels
                .iter()
                .find(|c| {
                    let n = c.name.to_string();
                    n == full_name || n == suffix
                })
                .map(|c| c.sample_data.values_as_f32().collect::<Vec<f32>>())
        };

        let r_data = descriptor
            .channel_set
            .r
            .as_ref()
            .and_then(|n| get_channel_f32(n));
        let g_data = descriptor
            .channel_set
            .g
            .as_ref()
            .and_then(|n| get_channel_f32(n));
        let b_data = descriptor
            .channel_set
            .b
            .as_ref()
            .and_then(|n| get_channel_f32(n));
        let a_data = descriptor
            .channel_set
            .a
            .as_ref()
            .and_then(|n| get_channel_f32(n));

        match descriptor.kind {
            ExrLayerKind::Rgba => {
                for i in 0..pixel_count {
                    data[i * 4] = r_data.as_ref().map_or(0.0, |d| d[i]);
                    data[i * 4 + 1] = g_data.as_ref().map_or(0.0, |d| d[i]);
                    data[i * 4 + 2] = b_data.as_ref().map_or(0.0, |d| d[i]);
                    data[i * 4 + 3] = a_data.as_ref().map_or(1.0, |d| d[i]);
                }
            }
            ExrLayerKind::Mask => {
                let ch_data = r_data
                    .as_ref()
                    .or(g_data.as_ref())
                    .or(b_data.as_ref())
                    .ok_or_else(|| {
                        CascadeError::ExrDecode(format!(
                            "No channel data found for mask layer '{}'",
                            descriptor.layer_name
                        ))
                    })?;
                for i in 0..pixel_count {
                    let v = ch_data[i];
                    data[i * 4] = v;
                    data[i * 4 + 1] = v;
                    data[i * 4 + 2] = v;
                    data[i * 4 + 3] = 1.0;
                }
            }
        }

        let image = crate::types::Image::from_f32_data(width, height, data)?;
        results.insert(descriptor.port_name.clone(), image);
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/// Map a user-facing compression name to the `exr` crate's `Compression` enum.
fn parse_compression(name: &str) -> exr::compression::Compression {
    match name.to_ascii_uppercase().as_str() {
        "PIZ" => exr::compression::Compression::PIZ,
        "ZIP" => exr::compression::Compression::ZIP16,
        "ZIPS" => exr::compression::Compression::ZIP1,
        "RLE" => exr::compression::Compression::RLE,
        "NONE" => exr::compression::Compression::Uncompressed,
        _ => exr::compression::Compression::ZIP16, // safe default
    }
}

/// Encode one or more named layers into an in-memory EXR file.
///
/// Each entry in `layers` is `(layer_name, image)`.  An empty layer name
/// becomes the unnamed primary layer.  All images are written as RGBA f32.
///
/// Returns the raw EXR bytes suitable for writing to disk or sending to the
/// frontend as `Value::Bytes`.
pub fn encode_multilayer_exr(
    layers: &[(&str, &Image)],
    compression: &str,
) -> Result<Vec<u8>, CascadeError> {
    use exr::prelude::*;
    use smallvec::SmallVec;

    if layers.is_empty() {
        return Err(CascadeError::Other("No layers to encode".to_string()));
    }

    let comp = parse_compression(compression);

    // Build each layer using AnyChannels<FlatSamples> for uniform typing.
    let mut exr_layers: SmallVec<[Layer<AnyChannels<FlatSamples>>; 2]> = SmallVec::new();

    let is_multilayer = layers.len() > 1;
    for &(name, image) in layers {
        let w = image.width as usize;
        let h = image.height as usize;
        let pixel_count = w * h;
        let data = &*image.data;

        // Deinterleave interleaved RGBA → planar per-channel vecs.
        let mut r_data = vec![0.0f32; pixel_count];
        let mut g_data = vec![0.0f32; pixel_count];
        let mut b_data = vec![0.0f32; pixel_count];
        let mut a_data = vec![0.0f32; pixel_count];

        for i in 0..pixel_count {
            r_data[i] = data[i * 4];
            g_data[i] = data[i * 4 + 1];
            b_data[i] = data[i * 4 + 2];
            a_data[i] = data[i * 4 + 3];
        }

        let mut channels = SmallVec::<[AnyChannel<FlatSamples>; 4]>::new();
        for (ch_name, ch_data, quantize) in [
            ("A", a_data, true),
            ("B", b_data, false),
            ("G", g_data, false),
            ("R", r_data, false),
        ] {
            channels.push(AnyChannel {
                name: Text::from(ch_name),
                sample_data: FlatSamples::F32(ch_data),
                quantize_linearly: quantize,
                sampling: Vec2(1, 1),
            });
        }

        let effective_name = if name.is_empty() && is_multilayer {
            "image"
        } else {
            name
        };
        let layer_name = if effective_name.is_empty() {
            None
        } else {
            Some(Text::from(effective_name))
        };

        let base_attributes = if effective_name.is_empty() {
            LayerAttributes::default()
        } else {
            LayerAttributes::named(Text::from(effective_name))
        };
        let layer = Layer {
            channel_data: AnyChannels { list: channels },
            attributes: LayerAttributes {
                layer_name,
                ..base_attributes
            },
            size: Vec2(w, h),
            encoding: Encoding {
                compression: comp,
                blocks: Blocks::ScanLines,
                line_order: LineOrder::Increasing,
            },
        };
        exr_layers.push(layer);
    }

    // Determine the display window from the first (primary) layer.
    let first_size = exr_layers[0].size;
    let display_window = IntegerBounds {
        position: Vec2(0, 0),
        size: first_size,
    };

    // Write to an in-memory buffer.
    let mut buf: Vec<u8> = Vec::new();
    let image = Image {
        attributes: ImageAttributes::new(display_window),
        layer_data: exr_layers,
    };
    image
        .write()
        .to_buffered(std::io::Cursor::new(&mut buf))
        .map_err(|e| CascadeError::Other(format!("EXR encode failed: {e}")))?;

    Ok(buf)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn make_test_image(width: u32, height: u32, data: Vec<f32>) -> Result<Image, CascadeError> {
        Image::from_f32_data(width, height, data)
    }

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

    #[test]
    fn test_encode_single_layer() -> Result<(), CascadeError> {
        let data = vec![0.0f32; 4 * 4 * 4];
        let image = make_test_image(4, 4, data)?;
        let layers: Vec<(&str, &Image)> = vec![("", &image)];
        let bytes = encode_multilayer_exr(&layers, "PIZ")?;
        assert!(is_exr(&bytes));
        assert!(!bytes.is_empty());
        Ok(())
    }

    #[test]
    fn test_encode_decode_round_trip() -> Result<(), CascadeError> {
        let mut data = Vec::with_capacity(4 * 4 * 4);
        for y in 0..4 {
            for x in 0..4 {
                let base = (y * 4 + x) as f32 * 0.01;
                data.extend([base, base + 0.1, base + 0.2, base + 0.3]);
            }
        }
        let image = make_test_image(4, 4, data.clone())?;
        let layers: Vec<(&str, &Image)> = vec![("", &image)];
        let bytes = encode_multilayer_exr(&layers, "PIZ")?;
        let metadata = parse_exr_metadata(&bytes)?;
        let decoded = decode_exr_layer(&bytes, &metadata, "image")?;
        assert_eq!(decoded.width, image.width);
        assert_eq!(decoded.height, image.height);
        let decoded_data = decoded.data.as_ref();
        for (decoded_value, original_value) in decoded_data.iter().zip(data.iter()) {
            assert!((decoded_value - original_value).abs() < 0.001);
        }
        Ok(())
    }

    #[test]
    fn test_encode_multilayer() -> Result<(), CascadeError> {
        let image_a = make_test_image(4, 4, vec![0.25; 4 * 4 * 4])?;
        let image_b = make_test_image(4, 4, vec![0.75; 4 * 4 * 4])?;
        let layers: Vec<(&str, &Image)> = vec![("", &image_a), ("mask", &image_b)];
        let bytes = encode_multilayer_exr(&layers, "ZIP")?;
        assert!(is_exr(&bytes));
        let metadata = parse_exr_metadata(&bytes)?;
        assert_eq!(metadata.layers.len(), 2);
        Ok(())
    }

    #[test]
    fn test_decode_named_layer_round_trip() -> Result<(), CascadeError> {
        // This tests the bug where prefixed channel names (e.g. "mask.R")
        // failed to match stripped suffixes ("R") during decode.
        let primary_data = vec![0.1f32; 4 * 4 * 4];
        let mask_data: Vec<f32> = (0..4 * 4)
            .flat_map(|i| {
                let v = i as f32 / 16.0;
                [v, v, v, 1.0]
            })
            .collect();
        let primary = make_test_image(4, 4, primary_data)?;
        let mask = make_test_image(4, 4, mask_data.clone())?;

        let bytes = encode_multilayer_exr(&[("", &primary), ("mask", &mask)], "ZIP")?;

        let metadata = parse_exr_metadata(&bytes)?;
        assert_eq!(metadata.layers.len(), 2);

        // Find the named "mask" layer port
        let mask_descriptor = metadata
            .layers
            .iter()
            .find(|l| l.layer_name == "mask")
            .expect("mask layer should exist in metadata");

        // Decode the named layer — this exercises the prefix-aware lookup
        let decoded = decode_exr_layer(&bytes, &metadata, &mask_descriptor.port_name)?;
        assert_eq!(decoded.width, 4);
        assert_eq!(decoded.height, 4);

        // Verify pixel values survived the round trip
        let dec = &*decoded.data;
        for i in 0..(4 * 4) {
            let expected_v = i as f32 / 16.0;
            assert!(
                (dec[i * 4] - expected_v).abs() < 0.001,
                "Pixel {i} R: expected {expected_v}, got {}",
                dec[i * 4]
            );
        }
        Ok(())
    }

    #[test]
    fn test_encode_empty_layers_error() {
        let result = encode_multilayer_exr(&[], "PIZ");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_compression() -> Result<(), CascadeError> {
        use exr::prelude::{read, ReadChannels, ReadLayers};

        let image = make_test_image(4, 4, vec![0.5; 4 * 4 * 4])?;
        let layers: Vec<(&str, &Image)> = vec![("", &image)];

        let cases = [
            ("PIZ", exr::compression::Compression::PIZ),
            ("ZIP", exr::compression::Compression::ZIP16),
            ("ZIPS", exr::compression::Compression::ZIP1),
            ("RLE", exr::compression::Compression::RLE),
            ("None", exr::compression::Compression::Uncompressed),
        ];

        for (name, expected) in cases {
            let bytes = encode_multilayer_exr(&layers, name)?;
            let exr_image = read()
                .no_deep_data()
                .largest_resolution_level()
                .all_channels()
                .all_layers()
                .all_attributes()
                .from_buffered(Cursor::new(&bytes))
                .map_err(|e| CascadeError::Other(format!("Failed to read EXR data: {e}")))?;
            let layer = exr_image
                .layer_data
                .first()
                .ok_or_else(|| CascadeError::Other("Missing EXR layer".to_string()))?;
            assert_eq!(layer.encoding.compression, expected);
        }

        Ok(())
    }

    #[test]
    fn test_decode_fixture_depth_layer() -> Result<(), CascadeError> {
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("apps/web/e2e/fixtures/test_multilayer.exr");
        if !fixture_path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(&fixture_path).map_err(|e| CascadeError::Other(e.to_string()))?;
        let metadata = parse_exr_metadata(&bytes)?;

        // Verify two layers: unnamed primary + named depth mask
        assert_eq!(metadata.layers.len(), 2);
        assert_eq!(metadata.layers[1].port_name, "depth");
        assert_eq!(metadata.layers[1].kind, ExrLayerKind::Mask);

        // Decode primary
        let primary = metadata
            .primary_layer_port
            .as_ref()
            .ok_or_else(|| CascadeError::Other("No primary".into()))?;
        let img = decode_exr_layer(&bytes, &metadata, primary)?;
        assert_eq!(img.width, 4);
        assert_eq!(img.height, 4);

        // Decode depth mask
        let mask = decode_exr_layer(&bytes, &metadata, "depth")?;
        assert_eq!(mask.width, 4);
        assert_eq!(mask.height, 4);
        // Depth values should be gradient 0..15/16
        assert!((mask.data[0] - 0.0).abs() < 0.001);
        Ok(())
    }

    #[test]
    fn test_decode_all_layers_round_trip() -> Result<(), CascadeError> {
        let primary_data: Vec<f32> = (0..4 * 4)
            .flat_map(|i| {
                let v = i as f32 / 16.0;
                [v, v + 0.01, v + 0.02, 1.0]
            })
            .collect();
        let mask_data: Vec<f32> = (0..4 * 4)
            .flat_map(|i| {
                let v = i as f32 / 16.0;
                [v, v, v, 1.0]
            })
            .collect();

        let primary = make_test_image(4, 4, primary_data.clone())?;
        let mask = make_test_image(4, 4, mask_data.clone())?;

        let bytes = encode_multilayer_exr(&[("", &primary), ("mask", &mask)], "ZIP")?;

        let metadata = parse_exr_metadata(&bytes)?;
        assert_eq!(metadata.layers.len(), 2);

        // Decode ALL layers in one pass
        let decoded = decode_all_layers(&bytes, &metadata, None)?;
        assert_eq!(decoded.len(), 2);

        // Verify primary layer
        let primary_port = metadata.primary_layer_port.as_ref().unwrap();
        let dec_primary = decoded
            .get(primary_port)
            .expect("primary should be in results");
        assert_eq!(dec_primary.width, 4);
        assert_eq!(dec_primary.height, 4);
        for i in 0..(4 * 4) {
            let expected = i as f32 / 16.0;
            assert!(
                (dec_primary.data[i * 4] - expected).abs() < 0.001,
                "Primary pixel {i}: expected {expected}, got {}",
                dec_primary.data[i * 4]
            );
        }

        // Verify mask layer
        let mask_desc = metadata
            .layers
            .iter()
            .find(|l| l.layer_name == "mask")
            .expect("mask layer should exist");
        let dec_mask = decoded
            .get(&mask_desc.port_name)
            .expect("mask should be in results");
        assert_eq!(dec_mask.width, 4);
        assert_eq!(dec_mask.height, 4);
        for i in 0..(4 * 4) {
            let expected = i as f32 / 16.0;
            assert!(
                (dec_mask.data[i * 4] - expected).abs() < 0.001,
                "Mask pixel {i}: expected {expected}, got {}",
                dec_mask.data[i * 4]
            );
        }

        Ok(())
    }

    #[test]
    fn test_decode_all_layers_filtered() -> Result<(), CascadeError> {
        let primary = make_test_image(4, 4, vec![0.25; 4 * 4 * 4])?;
        let mask = make_test_image(4, 4, vec![0.75; 4 * 4 * 4])?;

        let bytes = encode_multilayer_exr(&[("", &primary), ("mask", &mask)], "ZIP")?;

        let metadata = parse_exr_metadata(&bytes)?;
        let mask_desc = metadata
            .layers
            .iter()
            .find(|l| l.layer_name == "mask")
            .expect("mask layer should exist");

        // Decode only the mask layer
        let decoded = decode_all_layers(&bytes, &metadata, Some(&[mask_desc.port_name.as_str()]))?;
        assert_eq!(decoded.len(), 1);
        assert!(decoded.contains_key(&mask_desc.port_name));

        // The primary layer should NOT be in the results
        let primary_port = metadata.primary_layer_port.as_ref().unwrap();
        assert!(!decoded.contains_key(primary_port));

        Ok(())
    }

    #[test]
    fn test_decode_all_layers_empty_request() -> Result<(), CascadeError> {
        let img = make_test_image(4, 4, vec![0.5; 4 * 4 * 4])?;
        let bytes = encode_multilayer_exr(&[("", &img)], "ZIP")?;
        let metadata = parse_exr_metadata(&bytes)?;

        // Requesting no ports returns empty
        let decoded = decode_all_layers(&bytes, &metadata, Some(&[]))?;
        assert!(decoded.is_empty());

        Ok(())
    }

    #[test]
    fn test_decode_all_layers_fixture() -> Result<(), CascadeError> {
        let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("apps/web/e2e/fixtures/test_multilayer.exr");
        if !fixture_path.exists() {
            return Ok(());
        }
        let bytes = std::fs::read(&fixture_path).map_err(|e| CascadeError::Other(e.to_string()))?;
        let metadata = parse_exr_metadata(&bytes)?;

        // Decode all layers at once
        let decoded = decode_all_layers(&bytes, &metadata, None)?;
        assert_eq!(decoded.len(), metadata.layers.len());

        // Verify primary exists and has correct dimensions
        let primary_port = metadata
            .primary_layer_port
            .as_ref()
            .ok_or_else(|| CascadeError::Other("No primary".into()))?;
        let primary = decoded
            .get(primary_port)
            .ok_or_else(|| CascadeError::Other("Primary not decoded".into()))?;
        assert_eq!(primary.width, 4);
        assert_eq!(primary.height, 4);

        // Verify depth mask exists
        let depth = decoded
            .get("depth")
            .ok_or_else(|| CascadeError::Other("Depth not decoded".into()))?;
        assert_eq!(depth.width, 4);
        assert_eq!(depth.height, 4);
        // Depth gradient should start at 0
        assert!((depth.data[0] - 0.0).abs() < 0.001);

        // Cross-check: results should match individual decode_exr_layer calls
        let single_primary = decode_exr_layer(&bytes, &metadata, primary_port)?;
        for i in 0..single_primary.data.len() {
            assert!(
                (primary.data[i] - single_primary.data[i]).abs() < 0.001,
                "Primary mismatch at index {i}"
            );
        }

        Ok(())
    }
}
