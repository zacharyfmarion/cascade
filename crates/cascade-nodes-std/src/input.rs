use crate::transform::resize_nearest;
use cascade_core::error::CascadeError;
use cascade_core::exr::{self, ExrLayerKind, ExrMetadata};
use cascade_core::node::{EvalContext, Node, NodeFuture};
use cascade_core::types::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::any::Any;
use std::collections::HashMap;
use std::io::Cursor;

/// Minimum dimension (pixels) to avoid degenerate downscales.
const MIN_PREVIEW_EDGE: u32 = 600;

fn preview_downscale_size(width: u32, height: u32, scale: f32) -> Option<(u32, u32)> {
    if !scale.is_finite() || scale <= 0.0 || scale >= 1.0 || width == 0 || height == 0 {
        return None;
    }

    let min_scale =
        (MIN_PREVIEW_EDGE as f32 / width as f32).max(MIN_PREVIEW_EDGE as f32 / height as f32);
    let effective_scale = scale.max(min_scale).min(1.0);
    if effective_scale >= 1.0 {
        return None;
    }

    let new_w = ((width as f32 * effective_scale).round() as u32).clamp(1, width);
    let new_h = ((height as f32 * effective_scale).round() as u32).clamp(1, height);
    if new_w == width && new_h == height {
        None
    } else {
        Some((new_w, new_h))
    }
}

/// Downscale an image for preview rendering.
/// Returns the original if scale >= 1.0 or the image is already small.
fn preview_downscale(image: Image, scale: f32) -> Result<Image, CascadeError> {
    let Some((new_w, new_h)) = preview_downscale_size(image.width, image.height, scale) else {
        return Ok(image);
    };
    resize_nearest(&image, new_w, new_h)
}
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// Metadata about a loaded image sequence (frame count, range).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceInfo {
    pub frame_count: u64,
    pub first_frame: u64,
    pub last_frame: u64,
}

pub struct LoadImage {
    parsed: Mutex<ParsedImage>,
    original_bytes: Mutex<Option<Arc<Vec<u8>>>>,
    decode_cache: Mutex<HashMap<String, Arc<Image>>>,
}

/// What kind of image data is loaded.
enum ParsedImage {
    Empty,
    /// Standard raster image (PNG, JPEG, etc.) — already decoded.
    Standard(Image),
    /// Multi-layer EXR — metadata parsed, pixels decoded lazily.
    Exr {
        metadata: ExrMetadata,
    },
}

impl Default for LoadImage {
    fn default() -> Self {
        Self::new()
    }
}

impl LoadImage {
    pub fn new() -> Self {
        Self {
            parsed: Mutex::new(ParsedImage::Empty),
            original_bytes: Mutex::new(None),
            decode_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Load image data. Detects EXR via magic bytes; otherwise decodes as
    /// standard raster image. Returns the list of output port names that
    /// were removed (if the previous file had different layers).
    pub fn set_image_data(&self, bytes: &[u8]) -> Result<Vec<String>, CascadeError> {
        // Capture previous output port names for pruning
        let old_ports: Vec<String> = {
            let guard = self
                .parsed
                .lock()
                .map_err(|_| CascadeError::Other("Parsed mutex poisoned".into()))?;
            match &*guard {
                ParsedImage::Empty => vec![],
                ParsedImage::Standard(_) => vec!["image".to_string()],
                ParsedImage::Exr { metadata } => {
                    let mut ports = vec!["image".to_string()];
                    for layer in &metadata.layers {
                        if Some(&layer.port_name) != metadata.primary_layer_port.as_ref() {
                            ports.push(layer.port_name.clone());
                        }
                    }
                    ports
                }
            }
        };

        // Clear decode cache
        {
            let mut cache = self
                .decode_cache
                .lock()
                .map_err(|_| CascadeError::Other("Decode cache mutex poisoned".into()))?;
            cache.clear();
        }

        // Store raw bytes
        let bytes_arc = Arc::new(bytes.to_vec());
        {
            let mut guard = self
                .original_bytes
                .lock()
                .map_err(|_| CascadeError::Other("Bytes mutex poisoned".into()))?;
            *guard = Some(bytes_arc);
        }

        if exr::is_exr(bytes) {
            // EXR path: parse metadata only (no pixel decode)
            let metadata = exr::parse_exr_metadata(bytes)?;
            let mut guard = self
                .parsed
                .lock()
                .map_err(|_| CascadeError::Other("Parsed mutex poisoned".into()))?;
            *guard = ParsedImage::Exr { metadata };
        } else {
            // Standard raster path (existing behavior)
            let decoded = image::load_from_memory(bytes)
                .map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
            let rgba = decoded.to_rgba8();
            let (width, height) = rgba.dimensions();
            if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
                return Err(CascadeError::ImageTooLarge {
                    width,
                    height,
                    max: MAX_IMAGE_DIM,
                });
            }
            let raw = rgba.as_raw();
            let lut = srgb_to_linear_lut();
            let pixel_count = (width as usize) * (height as usize);
            let mut data = vec![0.0f32; pixel_count * 4];
            data.par_chunks_exact_mut(4)
                .enumerate()
                .for_each(|(i, out)| {
                    let idx = i * 4;
                    out[0] = lut[raw[idx] as usize];
                    out[1] = lut[raw[idx + 1] as usize];
                    out[2] = lut[raw[idx + 2] as usize];
                    out[3] = raw[idx + 3] as f32 / 255.0;
                });
            let image = Image::from_f32_data(width, height, data)?;
            let mut guard = self
                .parsed
                .lock()
                .map_err(|_| CascadeError::Other("Parsed mutex poisoned".into()))?;
            *guard = ParsedImage::Standard(image);
        }

        // Compute removed ports
        let new_ports: Vec<String> = {
            let guard = self
                .parsed
                .lock()
                .map_err(|_| CascadeError::Other("Parsed mutex poisoned".into()))?;
            match &*guard {
                ParsedImage::Empty => vec![],
                ParsedImage::Standard(_) => vec!["image".to_string()],
                ParsedImage::Exr { metadata } => {
                    let mut ports = vec!["image".to_string()];
                    for layer in &metadata.layers {
                        if Some(&layer.port_name) != metadata.primary_layer_port.as_ref() {
                            ports.push(layer.port_name.clone());
                        }
                    }
                    ports
                }
            }
        };

        let removed: Vec<String> = old_ports
            .into_iter()
            .filter(|p| !new_ports.contains(p))
            .collect();

        Ok(removed)
    }

    pub fn get_image_bytes(&self) -> Option<Vec<u8>> {
        self.original_bytes
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|arc| arc.as_ref().clone()))
    }
}

impl Node for LoadImage {
    fn spec(&self) -> NodeSpec {
        let mut outputs = vec![PortSpec {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: ValueType::Image,
            ..Default::default()
        }];

        // Add dynamic output ports for EXR layers
        if let Ok(guard) = self.parsed.lock() {
            if let ParsedImage::Exr { ref metadata } = *guard {
                for layer in &metadata.layers {
                    // Skip the primary layer (already mapped to "image")
                    if Some(&layer.port_name) == metadata.primary_layer_port.as_ref() {
                        continue;
                    }
                    outputs.push(PortSpec {
                        name: layer.port_name.clone(),
                        label: layer.label.clone(),
                        ty: match layer.kind {
                            ExrLayerKind::Rgba => ValueType::Image,
                            ExrLayerKind::Mask => ValueType::Mask,
                        },
                        ..Default::default()
                    });
                }
            }
        }

        NodeSpec {
            id: "load_image".to_string(),
            display_name: "Load Image".to_string(),
            category: "Input".to_string(),
            description: "Load an image or multi-layer EXR file".to_string(),
            inputs: vec![],
            outputs,
            params: vec![ParamSpec {
                key: "image_data".to_string(),
                label: "Image Data".to_string(),
                ty: ValueType::Image,
                default: ParamDefault::String(String::new()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Hidden,
                promotable: true,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let preview_scale = ctx.preview_scale;
            let guard = self
                .parsed
                .lock()
                .map_err(|_| CascadeError::Other("Parsed mutex poisoned".into()))?;

            match &*guard {
                ParsedImage::Empty => Err(CascadeError::MissingInput("image_data".to_string())),
                ParsedImage::Standard(image) => {
                    let scaled = preview_downscale(image.clone(), preview_scale)?;
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Image(scaled));
                    Ok(outputs)
                }
                ParsedImage::Exr { metadata } => {
                    // Drop the lock before decoding (decode_all_layers needs its own locks)
                    let meta = metadata.clone();
                    drop(guard);

                    if meta.primary_layer_port.is_none() {
                        return Err(CascadeError::ExrNoUsablePrimaryLayer);
                    }

                    // Collect all port names that need decoding
                    let all_ports: Vec<String> = {
                        let mut ports = Vec::new();
                        if let Some(ref p) = meta.primary_layer_port {
                            ports.push(p.clone());
                        }
                        for layer in &meta.layers {
                            if Some(&layer.port_name) != meta.primary_layer_port.as_ref() {
                                ports.push(layer.port_name.clone());
                            }
                        }
                        ports
                    };

                    // Check if all layers are already cached
                    let all_cached = {
                        let cache = self.decode_cache.lock().map_err(|_| {
                            CascadeError::Other("Decode cache mutex poisoned".into())
                        })?;
                        all_ports.iter().all(|p| cache.contains_key(p))
                    };

                    if !all_cached {
                        // Bulk decode all layers in a single file read
                        let bytes = {
                            let guard = self
                                .original_bytes
                                .lock()
                                .map_err(|_| CascadeError::Other("Bytes mutex poisoned".into()))?;
                            guard.as_ref().cloned().ok_or_else(|| {
                                CascadeError::MissingInput("No EXR data loaded".into())
                            })?
                        };

                        let port_refs: Vec<&str> = all_ports.iter().map(|s| s.as_str()).collect();
                        let decoded = exr::decode_all_layers(&bytes, &meta, Some(&port_refs))?;

                        // Populate cache atomically
                        let mut cache = self.decode_cache.lock().map_err(|_| {
                            CascadeError::Other("Decode cache mutex poisoned".into())
                        })?;
                        for (port_name, image) in decoded {
                            cache.entry(port_name).or_insert_with(|| Arc::new(image));
                        }
                    }

                    // Build outputs from cache
                    let cache = self
                        .decode_cache
                        .lock()
                        .map_err(|_| CascadeError::Other("Decode cache mutex poisoned".into()))?;
                    let mut outputs = HashMap::new();

                    if let Some(ref primary_port) = meta.primary_layer_port {
                        let img = cache.get(primary_port).ok_or_else(|| {
                            CascadeError::ExrDecode(format!(
                                "Primary layer '{}' not decoded",
                                primary_port
                            ))
                        })?;
                        outputs.insert(
                            "image".to_string(),
                            Value::Image(preview_downscale((**img).clone(), preview_scale)?),
                        );
                    }

                    for layer in &meta.layers {
                        if Some(&layer.port_name) == meta.primary_layer_port.as_ref() {
                            continue;
                        }
                        if let Some(img) = cache.get(&layer.port_name) {
                            outputs.insert(
                                layer.port_name.clone(),
                                Value::Image(preview_downscale((**img).clone(), preview_scale)?),
                            );
                        }
                    }

                    Ok(outputs)
                }
            }
        })
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

/// Shared decoder for standard raster images (PNG, JPEG, BMP, WebP).
/// Converts to f32 RGBA linear.
fn decode_standard_image(bytes: &[u8]) -> Result<Image, CascadeError> {
    let decoded =
        image::load_from_memory(bytes).map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
    decode_dynamic_image(decoded, 1.0)
}

fn decode_dynamic_image(
    decoded: image::DynamicImage,
    preview_scale: f32,
) -> Result<Image, CascadeError> {
    let width = decoded.width();
    let height = decoded.height();
    if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
        return Err(CascadeError::ImageTooLarge {
            width,
            height,
            max: MAX_IMAGE_DIM,
        });
    }

    // Preview renders are allowed to trade a tiny amount of sampling fidelity for
    // responsiveness: downsample the decoded u8 raster before the expensive f32
    // linear conversion, while full-resolution renders still preserve the normal path.
    let rgba = if let Some((new_w, new_h)) = preview_downscale_size(width, height, preview_scale) {
        decoded
            .resize_exact(new_w, new_h, image::imageops::FilterType::Nearest)
            .to_rgba8()
    } else {
        decoded.to_rgba8()
    };
    rgba8_to_linear_image(&rgba)
}

fn rgba8_to_linear_image(rgba: &image::RgbaImage) -> Result<Image, CascadeError> {
    let (width, height) = rgba.dimensions();
    if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
        return Err(CascadeError::ImageTooLarge {
            width,
            height,
            max: MAX_IMAGE_DIM,
        });
    }
    let raw = rgba.as_raw();
    let lut = srgb_to_linear_lut();
    let pixel_count = (width as usize) * (height as usize);
    let mut data = vec![0.0f32; pixel_count * 4];
    data.par_chunks_exact_mut(4)
        .enumerate()
        .for_each(|(i, out)| {
            let idx = i * 4;
            out[0] = lut[raw[idx] as usize];
            out[1] = lut[raw[idx + 1] as usize];
            out[2] = lut[raw[idx + 2] as usize];
            out[3] = raw[idx + 3] as f32 / 255.0;
        });
    Image::from_f32_data(width, height, data)
}

const FRAME_CACHE_SIZE: usize = 32;
const UPLOADED_FRAME_CACHE_SIZE: usize = 8;
const UPLOADED_FRAME_CACHE_BYTES: usize = 192 * 1024 * 1024;
const BATCH_FRAME_CACHE_BYTES: usize = 192 * 1024 * 1024;
const BATCH_THUMBNAIL_CACHE_BYTES: usize = 32 * 1024 * 1024;
const BATCH_THUMBNAIL_MAX_EDGE_LIMIT: u32 = 512;

pub struct LoadImageSequence {
    directory: Mutex<Option<String>>,
    frame_cache: Mutex<SeqFrameCache>,
    /// EXR metadata from the first frame (sets the interface for all frames)
    exr_metadata: Mutex<Option<ExrMetadata>>,
}

/// Cache that stores per-frame, per-port images for sequences.
struct SeqFrameCache {
    /// (frame_number, port_outputs) entries, LRU-ish eviction.
    entries: Vec<(u64, HashMap<String, Image>)>,
    max_size: usize,
}

impl SeqFrameCache {
    fn new(max_size: usize) -> Self {
        Self {
            entries: Vec::with_capacity(max_size),
            max_size,
        }
    }

    fn get(&self, frame: u64) -> Option<&HashMap<String, Image>> {
        self.entries
            .iter()
            .find(|(f, _)| *f == frame)
            .map(|(_, outputs)| outputs)
    }

    fn insert(&mut self, frame: u64, outputs: HashMap<String, Image>) {
        if self.entries.iter().any(|(f, _)| *f == frame) {
            return;
        }
        if self.entries.len() >= self.max_size {
            self.entries.remove(0);
        }
        self.entries.push((frame, outputs));
    }

    fn insert_uploaded(&mut self, frame: u64, outputs: HashMap<String, Image>) {
        self.insert_uploaded_with_limits(
            frame,
            outputs,
            UPLOADED_FRAME_CACHE_SIZE,
            UPLOADED_FRAME_CACHE_BYTES,
        );
    }

    fn insert_uploaded_with_limits(
        &mut self,
        frame: u64,
        outputs: HashMap<String, Image>,
        max_frames: usize,
        max_bytes: usize,
    ) {
        self.entries.retain(|(f, _)| *f != frame);
        self.entries.push((frame, outputs));

        while self.entries.len() > 1
            && (self.entries.len() > max_frames || self.total_bytes() > max_bytes)
        {
            if let Some(idx) = self.entries.iter().position(|(f, _)| *f != frame) {
                self.entries.remove(idx);
            } else {
                break;
            }
        }
    }

    fn total_bytes(&self) -> usize {
        self.entries
            .iter()
            .map(|(_, outputs)| outputs.values().map(image_byte_size).sum::<usize>())
            .sum()
    }

    fn clear(&mut self) {
        self.entries.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

fn image_byte_size(image: &Image) -> usize {
    image.data.len() * std::mem::size_of::<f32>()
}

fn filename_stem(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string()
}

/// Simple single-image-per-frame cache used by LoadVideo and LoadImageBatch.
struct FrameCache {
    entries: Vec<(u64, Image)>,
    max_size: usize,
}

impl FrameCache {
    fn new(max_size: usize) -> Self {
        Self {
            entries: Vec::with_capacity(max_size),
            max_size,
        }
    }

    fn get(&self, frame: u64) -> Option<&Image> {
        self.entries
            .iter()
            .find(|(f, _)| *f == frame)
            .map(|(_, img)| img)
    }

    fn insert(&mut self, frame: u64, image: Image) {
        if self.entries.iter().any(|(f, _)| *f == frame) {
            return;
        }
        if self.entries.len() >= self.max_size {
            self.entries.remove(0);
        }
        self.entries.push((frame, image));
    }

    fn clear(&mut self) {
        self.entries.clear();
    }
}

impl Default for LoadImageSequence {
    fn default() -> Self {
        Self::new()
    }
}

impl LoadImageSequence {
    pub fn new() -> Self {
        Self {
            directory: Mutex::new(None),
            frame_cache: Mutex::new(SeqFrameCache::new(FRAME_CACHE_SIZE)),
            exr_metadata: Mutex::new(None),
        }
    }

    pub fn set_info(&self, _info: SequenceInfo) -> Result<(), CascadeError> {
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
        cache.clear();
        Ok(())
    }

    pub fn set_frame_data(&self, frame: u64, bytes: &[u8]) -> Result<Vec<String>, CascadeError> {
        {
            let cache = self
                .frame_cache
                .lock()
                .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
            if cache.get(frame).is_some() {
                return Ok(vec![]);
            }
        }

        // Collect old output port names before update
        let old_ports: Vec<String> = {
            let guard = self
                .exr_metadata
                .lock()
                .map_err(|_| CascadeError::Other("Metadata mutex poisoned".to_string()))?;
            match &*guard {
                Some(metadata) => metadata
                    .layers
                    .iter()
                    .filter(|l| metadata.primary_layer_port.as_ref() != Some(&l.port_name))
                    .map(|l| l.port_name.clone())
                    .collect(),
                None => vec![],
            }
        };

        let outputs = if exr::is_exr(bytes) {
            self.decode_frame_exr(bytes)?
        } else {
            let image = decode_standard_image(bytes)?;
            let mut map = HashMap::new();
            map.insert("image".to_string(), image);
            map
        };

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
        // Browser-backed sequences upload frame bytes from a worker-owned File
        // cache. Keep decoded f32 RGBA frames bounded by bytes instead of
        // mirroring the full compressed sequence in WASM memory.
        cache.insert_uploaded(frame, outputs);

        // Collect new output port names after update
        let new_ports: Vec<String> = {
            let guard = self
                .exr_metadata
                .lock()
                .map_err(|_| CascadeError::Other("Metadata mutex poisoned".to_string()))?;
            match &*guard {
                Some(metadata) => metadata
                    .layers
                    .iter()
                    .filter(|l| metadata.primary_layer_port.as_ref() != Some(&l.port_name))
                    .map(|l| l.port_name.clone())
                    .collect(),
                None => vec![],
            }
        };

        // Return ports that existed before but don't exist now
        let removed = old_ports
            .into_iter()
            .filter(|p| !new_ports.contains(p))
            .collect();
        Ok(removed)
    }

    pub fn set_directory(&self, dir: &str) -> Result<SequenceInfo, CascadeError> {
        let mut guard = self
            .directory
            .lock()
            .map_err(|_| CascadeError::Other("Directory mutex poisoned".to_string()))?;
        *guard = Some(dir.to_string());
        drop(guard);

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
        cache.clear();
        drop(cache);

        let detected = detect_sequence_pattern(dir);
        self.get_sequence_info(&detected)
    }

    pub fn get_sequence_info(&self, pattern: &str) -> Result<SequenceInfo, CascadeError> {
        let dir_guard = self
            .directory
            .lock()
            .map_err(|_| CascadeError::Other("Directory mutex poisoned".to_string()))?;
        let dir = dir_guard
            .as_ref()
            .ok_or_else(|| CascadeError::MissingInput("directory".to_string()))?;

        let regex_pattern = build_frame_regex(pattern);
        let re = regex::Regex::new(&regex_pattern)
            .map_err(|e| CascadeError::Other(format!("Invalid pattern: {e}")))?;

        let mut frame_numbers: Vec<u64> = Vec::new();
        let entries = std::fs::read_dir(dir)
            .map_err(|e| CascadeError::Other(format!("Failed to read directory {dir}: {e}")))?;

        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if let Some(caps) = re.captures(name) {
                    if let Some(m) = caps.get(1) {
                        if let Ok(num) = m.as_str().parse::<u64>() {
                            frame_numbers.push(num);
                        }
                    }
                }
            }
        }

        if frame_numbers.is_empty() {
            return Ok(SequenceInfo {
                frame_count: 0,
                first_frame: 0,
                last_frame: 0,
            });
        }

        frame_numbers.sort_unstable();
        Ok(SequenceInfo {
            frame_count: frame_numbers.len() as u64,
            first_frame: frame_numbers[0],
            last_frame: frame_numbers[frame_numbers.len() - 1],
        })
    }

    /// Load a single frame from disk. Detects EXR and returns all layer outputs.
    fn load_frame(
        &self,
        dir: &str,
        pattern: &str,
        frame: u64,
    ) -> Result<HashMap<String, Image>, CascadeError> {
        let padding = parse_frame_padding(pattern);
        let normalized = normalize_pattern(pattern);
        let filename = normalized.replace("{frame}", &format_frame_number(frame, padding));
        let path = std::path::Path::new(dir).join(&filename);
        let bytes = std::fs::read(&path).map_err(|e| {
            CascadeError::Other(format!("Failed to read frame {}: {}", path.display(), e))
        })?;

        if exr::is_exr(&bytes) {
            self.decode_frame_exr(&bytes)
        } else {
            let image = decode_standard_image(&bytes)?;
            let mut map = HashMap::new();
            map.insert("image".to_string(), image);
            Ok(map)
        }
    }

    /// Decode an EXR frame, returning outputs per layer port.
    /// On first EXR frame, captures metadata for dynamic output ports.
    fn decode_frame_exr(&self, bytes: &[u8]) -> Result<HashMap<String, Image>, CascadeError> {
        let metadata = exr::parse_exr_metadata(bytes)?;

        // Capture metadata from first EXR frame for interface stability
        {
            let mut meta_guard = self
                .exr_metadata
                .lock()
                .map_err(|_| CascadeError::Other("EXR metadata mutex poisoned".into()))?;
            if meta_guard.is_none() {
                *meta_guard = Some(metadata.clone());
            }
        }

        // Bulk decode all layers in a single pass
        let mut outputs = exr::decode_all_layers(bytes, &metadata, None)?;

        // Remap primary layer to "image" output port
        if let Some(ref primary_port) = metadata.primary_layer_port {
            if let Some(img) = outputs.remove(primary_port) {
                outputs.insert("image".to_string(), img);
            }
        }

        // Fill in missing non-primary layers with black images
        for layer in &metadata.layers {
            if Some(&layer.port_name) == metadata.primary_layer_port.as_ref() {
                continue;
            }
            outputs
                .entry(layer.port_name.clone())
                .or_insert_with(|| Image::new(metadata.primary_width, metadata.primary_height));
        }

        Ok(outputs)
    }
}

impl Node for LoadImageSequence {
    fn spec(&self) -> NodeSpec {
        let mut outputs = vec![PortSpec {
            name: "image".to_string(),
            label: "Image".to_string(),
            ty: ValueType::Image,
            ..Default::default()
        }];

        // Add dynamic output ports from first EXR frame's metadata
        if let Ok(guard) = self.exr_metadata.lock() {
            if let Some(ref metadata) = *guard {
                for layer in &metadata.layers {
                    if Some(&layer.port_name) == metadata.primary_layer_port.as_ref() {
                        continue;
                    }
                    outputs.push(PortSpec {
                        name: layer.port_name.clone(),
                        label: layer.label.clone(),
                        ty: match layer.kind {
                            ExrLayerKind::Rgba => ValueType::Image,
                            ExrLayerKind::Mask => ValueType::Mask,
                        },
                        ..Default::default()
                    });
                }
            }
        }

        NodeSpec {
            id: "load_image_sequence".to_string(),
            display_name: "Load Image Sequence".to_string(),
            category: "Input".to_string(),
            description: "Load an image sequence from a directory".to_string(),
            inputs: vec![],
            outputs,
            params: vec![
                ParamSpec {
                    key: "directory".to_string(),
                    label: "Directory".to_string(),
                    ty: ValueType::String,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                    promotable: true,
                },
                ParamSpec {
                    key: "pattern".to_string(),
                    label: "Pattern".to_string(),
                    ty: ValueType::String,
                    default: ParamDefault::String("frame_{frame}.png".to_string()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                    promotable: true,
                },
            ],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let frame = ctx.frame_time.frame;

            let mut cache = self
                .frame_cache
                .lock()
                .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;

            // Check cache
            if let Some(frame_outputs) = cache.get(frame) {
                let mut outputs = HashMap::new();
                for (port, img) in frame_outputs {
                    outputs.insert(port.clone(), Value::Image(img.clone()));
                }
                return Ok(outputs);
            }

            let dir_guard = self
                .directory
                .lock()
                .map_err(|_| CascadeError::Other("Directory mutex poisoned".to_string()))?;

            let dir = match dir_guard.as_ref() {
                Some(d) => d.clone(),
                None => {
                    return Err(CascadeError::MissingInput(
                        "No frame data available. Select image sequence files.".to_string(),
                    ));
                }
            };
            drop(dir_guard);

            let pattern_param = ctx
                .get_param_string("pattern")
                .unwrap_or("frame_{frame}.png");

            let detected;
            let pattern = if pattern_param == "frame_{frame}.png" {
                detected = detect_sequence_pattern(&dir);
                &detected
            } else {
                pattern_param
            };

            let frame_images = self.load_frame(&dir, pattern, frame)?;
            let mut outputs = HashMap::new();
            for (port, img) in &frame_images {
                outputs.insert(port.clone(), Value::Image(img.clone()));
            }
            cache.insert(frame, frame_images);

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

pub fn detect_sequence_pattern(dir: &str) -> String {
    let image_exts = ["png", "jpg", "jpeg", "exr", "tif", "tiff", "bmp", "webp"];

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return "{frame:4}.png".to_string(),
    };

    let mut filenames: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let lower = name.to_lowercase();
            if image_exts.iter().any(|ext| lower.ends_with(ext)) {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    filenames.sort();

    if filenames.is_empty() {
        return "{frame:4}.png".to_string();
    }

    let sample = &filenames[0];
    let numeric_re = regex::Regex::new(r"\d+").expect("static regex is valid");
    let mut best_match: Option<regex::Match> = None;
    for m in numeric_re.find_iter(sample) {
        match &best_match {
            Some(prev) if m.as_str().len() >= prev.as_str().len() => best_match = Some(m),
            None => best_match = Some(m),
            _ => {}
        }
    }

    match best_match {
        Some(m) => {
            let padding = m.as_str().len();
            format!(
                "{}{{frame:{}}}{}",
                &sample[..m.start()],
                padding,
                &sample[m.end()..]
            )
        }
        None => "{frame:4}.png".to_string(),
    }
}

fn parse_frame_padding(pattern: &str) -> usize {
    if let Some(start) = pattern.find("{frame:") {
        let after = &pattern[start + 7..];
        if let Some(end) = after.find('}') {
            if let Ok(n) = after[..end].parse::<usize>() {
                return n;
            }
        }
    }
    if pattern.contains("{frame}") {
        return 4;
    }
    4
}

fn normalize_pattern(pattern: &str) -> String {
    if let Some(start) = pattern.find("{frame:") {
        let after = &pattern[start..];
        if let Some(end) = after.find('}') {
            let mut result = pattern[..start].to_string();
            result.push_str("{frame}");
            result.push_str(&pattern[start + end + 1..]);
            return result;
        }
    }
    pattern.to_string()
}

fn format_frame_number(frame: u64, padding: usize) -> String {
    format!("{frame:0>padding$}")
}

fn build_frame_regex(pattern: &str) -> String {
    let normalized = normalize_pattern(pattern);
    let escaped = regex::escape(&normalized);
    let with_capture = escaped.replace("\\{frame\\}", "(\\d+)");
    format!("^{with_capture}$")
}

type FrameLoader = Box<dyn Fn(u64) -> Result<Image, CascadeError> + Send>;

pub struct LoadVideo {
    frame_cache: Mutex<FrameCache>,
    frame_loader: Mutex<Option<FrameLoader>>,
}

impl Default for LoadVideo {
    fn default() -> Self {
        Self::new()
    }
}

impl LoadVideo {
    pub fn new() -> Self {
        Self {
            frame_cache: Mutex::new(FrameCache::new(FRAME_CACHE_SIZE)),
            frame_loader: Mutex::new(None),
        }
    }

    /// Set a closure that decodes a single frame on demand.
    /// The closure receives a frame index and returns the decoded Image
    /// (already converted to f32 linear).
    pub fn set_frame_loader(&self, loader: FrameLoader) -> Result<(), CascadeError> {
        let mut guard = self
            .frame_loader
            .lock()
            .map_err(|_| CascadeError::Other("Frame loader mutex poisoned".to_string()))?;
        *guard = Some(loader);

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
        cache.clear();

        Ok(())
    }
}

impl Node for LoadVideo {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "load_video".to_string(),
            display_name: "Load Video".to_string(),
            category: "Input".to_string(),
            description: "Load a video file".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![ParamSpec {
                key: "file_path".to_string(),
                label: "File Path".to_string(),
                ty: ValueType::String,
                default: ParamDefault::String(String::new()),
                min: None,
                max: None,
                step: None,
                ui_hint: UiHint::Hidden,
                promotable: false,
            }],
        }
    }

    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let frame = ctx.frame_time.frame;

            {
                let cache = self
                    .frame_cache
                    .lock()
                    .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;

                if let Some(image) = cache.get(frame) {
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Image(image.clone()));
                    return Ok(outputs);
                }
            }

            let loader_guard = self
                .frame_loader
                .lock()
                .map_err(|_| CascadeError::Other("Frame loader mutex poisoned".to_string()))?;

            let loader = loader_guard.as_ref().ok_or_else(|| {
                CascadeError::MissingInput(
                    "No frame data available. Load a video file.".to_string(),
                )
            })?;

            let image = loader(frame)?;

            let mut cache = self
                .frame_cache
                .lock()
                .map_err(|_| CascadeError::Other("Cache mutex poisoned".to_string()))?;
            cache.insert(frame, image.clone());

            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(image));
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

pub fn srgb_to_linear_lut() -> &'static [f32; 256] {
    static LUT: OnceLock<[f32; 256]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut table = [0.0f32; 256];
        for (i, entry) in table.iter_mut().enumerate() {
            let v = i as f32 / 255.0;
            let linear = if v <= 0.04045 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            };
            *entry = linear;
        }
        table
    })
}

#[derive(Clone)]
struct BatchEntry {
    stem: String,
    source: BatchEntrySource,
}

#[derive(Clone)]
enum BatchEntrySource {
    Bytes(Vec<u8>),
    Path(PathBuf),
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct BatchFrameCacheKey {
    frame: u64,
    preview_bucket: u16,
}

struct BatchFrameCache {
    entries: Vec<(BatchFrameCacheKey, Image, usize)>,
    max_bytes: usize,
    current_bytes: usize,
}

impl BatchFrameCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_bytes,
            current_bytes: 0,
        }
    }

    fn get(&mut self, key: BatchFrameCacheKey) -> Option<Image> {
        let index = self
            .entries
            .iter()
            .position(|(entry_key, _, _)| *entry_key == key)?;
        let (entry_key, image, bytes) = self.entries.remove(index);
        let cloned = image.clone();
        self.entries.push((entry_key, image, bytes));
        Some(cloned)
    }

    fn insert(&mut self, key: BatchFrameCacheKey, image: Image) {
        if self
            .entries
            .iter()
            .any(|(entry_key, _, _)| *entry_key == key)
        {
            return;
        }
        let bytes = image_byte_size(&image);
        self.current_bytes = self.current_bytes.saturating_add(bytes);
        self.entries.push((key, image, bytes));
        while self.entries.len() > 1 && self.current_bytes > self.max_bytes {
            let (_, _, evicted_bytes) = self.entries.remove(0);
            self.current_bytes = self.current_bytes.saturating_sub(evicted_bytes);
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.current_bytes = 0;
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    fn current_bytes(&self) -> usize {
        self.current_bytes
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct BatchThumbnailCacheKey {
    index: usize,
    max_edge: u32,
}

struct BatchThumbnailCache {
    entries: Vec<(BatchThumbnailCacheKey, Vec<u8>, usize)>,
    max_bytes: usize,
    current_bytes: usize,
}

impl BatchThumbnailCache {
    fn new(max_bytes: usize) -> Self {
        Self {
            entries: Vec::new(),
            max_bytes,
            current_bytes: 0,
        }
    }

    fn get(&mut self, key: BatchThumbnailCacheKey) -> Option<Vec<u8>> {
        let index = self
            .entries
            .iter()
            .position(|(entry_key, _, _)| *entry_key == key)?;
        let (entry_key, bytes, byte_count) = self.entries.remove(index);
        let cloned = bytes.clone();
        self.entries.push((entry_key, bytes, byte_count));
        Some(cloned)
    }

    fn insert(&mut self, key: BatchThumbnailCacheKey, bytes: Vec<u8>) {
        if self
            .entries
            .iter()
            .any(|(entry_key, _, _)| *entry_key == key)
        {
            return;
        }
        let byte_count = bytes.len();
        self.current_bytes = self.current_bytes.saturating_add(byte_count);
        self.entries.push((key, bytes, byte_count));
        while self.entries.len() > 1 && self.current_bytes > self.max_bytes {
            let (_, _, evicted_bytes) = self.entries.remove(0);
            self.current_bytes = self.current_bytes.saturating_sub(evicted_bytes);
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.current_bytes = 0;
    }
}

fn preview_scale_bucket(preview_scale: f32) -> u16 {
    if !preview_scale.is_finite() || preview_scale <= 0.0 || preview_scale >= 1.0 {
        1000
    } else {
        ((preview_scale * 1000.0).round() as u16).clamp(1, 999)
    }
}

pub struct LoadImageBatch {
    entries: Mutex<Vec<BatchEntry>>,
    frame_cache: Mutex<BatchFrameCache>,
    thumbnail_cache: Mutex<BatchThumbnailCache>,
}
impl Default for LoadImageBatch {
    fn default() -> Self {
        Self::new()
    }
}

impl LoadImageBatch {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            frame_cache: Mutex::new(BatchFrameCache::new(BATCH_FRAME_CACHE_BYTES)),
            thumbnail_cache: Mutex::new(BatchThumbnailCache::new(BATCH_THUMBNAIL_CACHE_BYTES)),
        }
    }
    pub fn clear(&self) -> Result<(), CascadeError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        entries.clear();
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch cache mutex poisoned".to_string()))?;
        cache.clear();
        let mut thumbnail_cache = self
            .thumbnail_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch thumbnail cache mutex poisoned".to_string()))?;
        thumbnail_cache.clear();
        Ok(())
    }
    pub fn add_image(&self, filename: &str, bytes: &[u8]) -> Result<(), CascadeError> {
        // Validate embedded bytes without a full pixel decode.
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| CascadeError::ImageDecode(e.to_string()))?;
        if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
            return Err(CascadeError::ImageTooLarge {
                width,
                height,
                max: MAX_IMAGE_DIM,
            });
        }
        let stem = filename_stem(filename);
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        entries.push(BatchEntry {
            stem,
            source: BatchEntrySource::Bytes(bytes.to_vec()),
        });
        Ok(())
    }

    pub fn add_image_path(
        &self,
        filename: &str,
        path: impl Into<PathBuf>,
    ) -> Result<(), CascadeError> {
        let path = path.into();
        if !path.is_file() {
            return Err(CascadeError::MissingInput(format!(
                "Batch image file not found: {}",
                path.display()
            )));
        }
        let stem = filename_stem(filename);
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        entries.push(BatchEntry {
            stem,
            source: BatchEntrySource::Path(path),
        });
        Ok(())
    }

    pub fn set_image_paths(&self, paths: Vec<(String, PathBuf)>) -> Result<(), CascadeError> {
        let mut next_entries = Vec::with_capacity(paths.len());
        for (filename, path) in paths {
            if !path.is_file() {
                return Err(CascadeError::MissingInput(format!(
                    "Batch image file not found: {}",
                    path.display()
                )));
            }
            next_entries.push(BatchEntry {
                stem: filename_stem(&filename),
                source: BatchEntrySource::Path(path),
            });
        }

        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        *entries = next_entries;
        drop(entries);

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch cache mutex poisoned".to_string()))?;
        cache.clear();
        drop(cache);

        let mut thumbnail_cache = self
            .thumbnail_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch thumbnail cache mutex poisoned".to_string()))?;
        thumbnail_cache.clear();
        Ok(())
    }

    pub fn image_count(&self) -> Result<usize, CascadeError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        Ok(entries.len())
    }

    pub fn filenames(&self) -> Result<Vec<String>, CascadeError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
        Ok(entries.iter().map(|entry| entry.stem.clone()).collect())
    }

    pub fn image_bytes(&self, index: usize) -> Result<Vec<u8>, CascadeError> {
        let source = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
            entries
                .get(index)
                .ok_or_else(|| CascadeError::MissingInput("Batch index out of range".to_string()))?
                .source
                .clone()
        };
        match source {
            BatchEntrySource::Bytes(bytes) => Ok(bytes),
            BatchEntrySource::Path(path) => std::fs::read(&path)
                .map_err(|e| CascadeError::ImageDecode(format!("{}: {e}", path.display()))),
        }
    }

    pub fn thumbnail_png(&self, index: usize, max_edge: u32) -> Result<Vec<u8>, CascadeError> {
        let max_edge = max_edge.clamp(1, BATCH_THUMBNAIL_MAX_EDGE_LIMIT);
        let key = BatchThumbnailCacheKey { index, max_edge };
        {
            let mut cache = self.thumbnail_cache.lock().map_err(|_| {
                CascadeError::Other("Batch thumbnail cache mutex poisoned".to_string())
            })?;
            if let Some(bytes) = cache.get(key) {
                return Ok(bytes);
            }
        }

        let source = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
            entries
                .get(index)
                .ok_or_else(|| CascadeError::MissingInput("Batch index out of range".to_string()))?
                .source
                .clone()
        };

        let decoded = match source {
            BatchEntrySource::Bytes(bytes) => image::load_from_memory(&bytes)
                .map_err(|e| CascadeError::ImageDecode(e.to_string()))?,
            BatchEntrySource::Path(path) => image::open(&path)
                .map_err(|e| CascadeError::ImageDecode(format!("{}: {e}", path.display())))?,
        };
        let thumbnail = decoded.thumbnail(max_edge, max_edge).to_rgba8();
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(thumbnail)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .map_err(|e| CascadeError::ImageDecode(e.to_string()))?;

        let mut cache = self
            .thumbnail_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch thumbnail cache mutex poisoned".to_string()))?;
        cache.insert(key, bytes.clone());
        Ok(bytes)
    }

    fn decode_frame(&self, index: usize, preview_scale: f32) -> Result<Image, CascadeError> {
        let key = BatchFrameCacheKey {
            frame: index as u64,
            preview_bucket: preview_scale_bucket(preview_scale),
        };
        {
            let mut cache = self
                .frame_cache
                .lock()
                .map_err(|_| CascadeError::Other("Batch cache mutex poisoned".to_string()))?;
            if let Some(img) = cache.get(key) {
                return Ok(img);
            }
        }

        let source = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
            entries
                .get(index)
                .ok_or_else(|| CascadeError::MissingInput("Batch index out of range".to_string()))?
                .source
                .clone()
        };

        let decoded = match source {
            BatchEntrySource::Bytes(bytes) => image::load_from_memory(&bytes)
                .map_err(|e| CascadeError::ImageDecode(e.to_string()))?,
            BatchEntrySource::Path(path) => image::open(&path)
                .map_err(|e| CascadeError::ImageDecode(format!("{}: {e}", path.display())))?,
        };
        let image = decode_dynamic_image(decoded, preview_scale)?;
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CascadeError::Other("Batch cache mutex poisoned".to_string()))?;
        cache.insert(key, image.clone());

        Ok(image)
    }
}
impl Node for LoadImageBatch {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "load_image_batch".to_string(),
            display_name: "Load Image Batch".to_string(),
            category: "Input".to_string(),
            description: "Load a batch of images for processing".to_string(),
            inputs: vec![],
            outputs: vec![
                PortSpec {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: ValueType::Image,
                    ..Default::default()
                },
                PortSpec {
                    name: "filename".to_string(),
                    label: "Filename".to_string(),
                    ty: ValueType::String,
                    ..Default::default()
                },
            ],
            params: vec![
                ParamSpec {
                    key: "directory".to_string(),
                    label: "Directory".to_string(),
                    ty: ValueType::String,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                    promotable: true,
                },
                ParamSpec {
                    key: "files".to_string(),
                    label: "Files".to_string(),
                    ty: ValueType::String,
                    default: ParamDefault::String(String::new()),
                    min: None,
                    max: None,
                    step: None,
                    ui_hint: UiHint::Hidden,
                    promotable: true,
                },
            ],
        }
    }
    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let frame = ctx.frame_time.frame as usize;
            let image = self.decode_frame(frame, ctx.preview_scale)?;

            let stem = {
                let entries = self
                    .entries
                    .lock()
                    .map_err(|_| CascadeError::Other("Batch entries mutex poisoned".to_string()))?;
                let entry = entries.get(frame).ok_or_else(|| {
                    CascadeError::MissingInput("Batch index out of range".to_string())
                })?;
                entry.stem.clone()
            };
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(image));
            outputs.insert("filename".to_string(), Value::String(stem));
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
    use std::collections::HashMap;
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn png_bytes(rgba: [u8; 4]) -> Vec<u8> {
        let image = ::image::RgbaImage::from_pixel(1, 1, ::image::Rgba(rgba));
        let mut bytes = Vec::new();
        ::image::DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), ::image::ImageFormat::Png)
            .expect("test PNG should encode");
        bytes
    }

    fn png_bytes_with_size(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let image = ::image::RgbaImage::from_pixel(width, height, ::image::Rgba(rgba));
        let mut bytes = Vec::new();
        ::image::DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut bytes), ::image::ImageFormat::Png)
            .expect("test PNG should encode");
        bytes
    }

    fn image_outputs(width: u32, height: u32, value: f32) -> HashMap<String, Image> {
        let data = vec![value; width as usize * height as usize * 4];
        let image = Image::from_f32_data(width, height, data).expect("test image should build");
        HashMap::from([("image".to_string(), image)])
    }

    fn temp_png_path(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cascade-load-image-batch-{stamp}-{}-{name}",
            std::process::id()
        ))
    }

    #[test]
    fn preview_downscale_keeps_small_images_full_size() {
        assert_eq!(preview_downscale_size(200, 150, 0.25), None);
    }

    #[test]
    fn preview_downscale_clamps_effective_scale_to_min_edge() {
        assert_eq!(preview_downscale_size(1200, 900, 0.25), Some((800, 600)));
    }

    #[test]
    fn preview_downscale_preserves_requested_scale_for_large_images() {
        assert_eq!(preview_downscale_size(4096, 3072, 0.25), Some((1024, 768)));
    }

    #[test]
    fn preview_downscale_preserves_aspect_for_narrow_images() {
        assert_eq!(preview_downscale_size(400, 100, 0.25), None);
    }

    #[test]
    fn load_image_sequence_asset_params_are_strings() {
        let spec = LoadImageSequence::new().spec();
        let directory = spec
            .params
            .iter()
            .find(|param| param.key == "directory")
            .expect("directory param should exist");
        let pattern = spec
            .params
            .iter()
            .find(|param| param.key == "pattern")
            .expect("pattern param should exist");

        assert_eq!(directory.ty, ValueType::String);
        assert!(matches!(
            &directory.default,
            ParamDefault::String(value) if value.is_empty()
        ));
        assert_eq!(pattern.ty, ValueType::String);
        assert!(matches!(
            &pattern.default,
            ParamDefault::String(value) if value == "frame_{frame}.png"
        ));
    }

    #[test]
    fn uploaded_sequence_frame_data_keeps_multiple_decoded_frames() {
        let node = LoadImageSequence::new();
        let first = png_bytes([255, 0, 0, 255]);
        let second = png_bytes([0, 255, 0, 255]);

        node.set_frame_data(1, &first)
            .expect("first uploaded frame should decode");
        node.set_frame_data(2, &second)
            .expect("second uploaded frame should decode");

        let cache = node
            .frame_cache
            .lock()
            .expect("test cache lock should succeed");
        assert_eq!(cache.len(), 2);
        assert!(cache.get(1).is_some());
        assert!(cache.get(2).is_some());
    }

    #[test]
    fn uploaded_sequence_cache_evicts_old_frames_by_frame_limit() {
        let mut cache = SeqFrameCache::new(FRAME_CACHE_SIZE);
        cache.insert_uploaded_with_limits(1, image_outputs(1, 1, 0.1), 2, usize::MAX);
        cache.insert_uploaded_with_limits(2, image_outputs(1, 1, 0.2), 2, usize::MAX);
        cache.insert_uploaded_with_limits(3, image_outputs(1, 1, 0.3), 2, usize::MAX);

        assert_eq!(cache.len(), 2);
        assert!(cache.get(1).is_none());
        assert!(cache.get(2).is_some());
        assert!(cache.get(3).is_some());
    }

    #[test]
    fn uploaded_sequence_cache_evicts_old_frames_by_byte_budget() {
        let mut cache = SeqFrameCache::new(FRAME_CACHE_SIZE);
        let one_frame_bytes = image_outputs(2, 1, 0.1)
            .values()
            .map(image_byte_size)
            .sum::<usize>();

        cache.insert_uploaded_with_limits(1, image_outputs(2, 1, 0.1), 8, one_frame_bytes * 2);
        cache.insert_uploaded_with_limits(2, image_outputs(2, 1, 0.2), 8, one_frame_bytes * 2);
        cache.insert_uploaded_with_limits(3, image_outputs(2, 1, 0.3), 8, one_frame_bytes * 2);

        assert_eq!(cache.len(), 2);
        assert!(cache.get(1).is_none());
        assert!(cache.get(2).is_some());
        assert!(cache.get(3).is_some());
    }

    #[test]
    fn uploaded_sequence_cache_keeps_current_frame_over_budget() {
        let mut cache = SeqFrameCache::new(FRAME_CACHE_SIZE);
        cache.insert_uploaded_with_limits(1, image_outputs(4, 4, 0.1), 8, 1);

        assert_eq!(cache.len(), 1);
        assert!(cache.get(1).is_some());
    }

    #[test]
    fn directory_sequence_cache_uses_count_limit() {
        let mut cache = SeqFrameCache::new(2);
        cache.insert(1, image_outputs(1, 1, 0.1));
        cache.insert(2, image_outputs(1, 1, 0.2));
        cache.insert(3, image_outputs(1, 1, 0.3));

        assert_eq!(cache.len(), 2);
        assert!(cache.get(1).is_none());
        assert!(cache.get(2).is_some());
        assert!(cache.get(3).is_some());
    }

    #[test]
    fn load_image_batch_decodes_path_backed_entries_lazily() {
        let path = temp_png_path("lazy.png");
        fs::write(&path, png_bytes([12, 34, 56, 255])).expect("test PNG should write");

        let node = LoadImageBatch::new();
        node.add_image_path("lazy.png", &path)
            .expect("path entry should register");

        assert_eq!(node.image_count().expect("count"), 1);
        assert_eq!(
            node.filenames().expect("filenames"),
            vec!["lazy".to_string()]
        );

        let image = node.decode_frame(0, 1.0).expect("path entry should decode");
        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);

        fs::remove_file(path).expect("test PNG should clean up");
    }

    #[test]
    fn load_image_batch_preview_scale_downscales_decoded_frame() {
        let node = LoadImageBatch::new();
        let bytes = png_bytes_with_size(1200, 900, [12, 34, 56, 255]);
        node.add_image("large.png", &bytes)
            .expect("batch image should register");

        let image = node
            .decode_frame(0, 0.25)
            .expect("preview frame should decode");

        assert_eq!((image.width, image.height), (800, 600));
    }

    #[test]
    fn batch_frame_cache_evicts_old_entries_by_byte_budget() {
        let mut cache = BatchFrameCache::new(
            image_byte_size(&Image::from_f32_data(2, 1, vec![0.0; 8]).expect("image")) * 2,
        );
        let first = Image::from_f32_data(2, 1, vec![0.1; 8]).expect("first image");
        let second = Image::from_f32_data(2, 1, vec![0.2; 8]).expect("second image");
        let third = Image::from_f32_data(2, 1, vec![0.3; 8]).expect("third image");

        cache.insert(
            BatchFrameCacheKey {
                frame: 1,
                preview_bucket: 1000,
            },
            first,
        );
        cache.insert(
            BatchFrameCacheKey {
                frame: 2,
                preview_bucket: 1000,
            },
            second,
        );
        cache.insert(
            BatchFrameCacheKey {
                frame: 3,
                preview_bucket: 1000,
            },
            third,
        );

        assert_eq!(cache.len(), 2);
        assert!(cache
            .get(BatchFrameCacheKey {
                frame: 1,
                preview_bucket: 1000,
            })
            .is_none());
        assert!(cache.current_bytes() <= cache.max_bytes);
    }

    #[test]
    fn load_image_batch_thumbnail_png_respects_max_edge() {
        let node = LoadImageBatch::new();
        let bytes = png_bytes_with_size(8, 4, [90, 80, 70, 255]);
        node.add_image("wide.png", &bytes)
            .expect("batch image should register");

        let thumbnail = node.thumbnail_png(0, 2).expect("thumbnail should encode");
        let decoded = ::image::load_from_memory(&thumbnail)
            .expect("thumbnail should decode")
            .to_rgba8();

        assert!(decoded.width() <= 2);
        assert!(decoded.height() <= 2);
    }

    #[test]
    fn load_image_batch_path_entries_do_not_copy_file_bytes_on_add() {
        let path = temp_png_path("removed.png");
        fs::write(&path, png_bytes([255, 0, 0, 255])).expect("test PNG should write");

        let node = LoadImageBatch::new();
        node.add_image_path("removed.png", &path)
            .expect("path entry should register before file removal");
        fs::remove_file(&path).expect("test PNG should remove");

        let error = node
            .decode_frame(0, 1.0)
            .expect_err("path-backed entry should read from disk lazily");
        assert!(error.to_string().contains("removed.png"));
    }
}
