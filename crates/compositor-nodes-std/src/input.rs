use compositor_core::error::CompositorError;
use compositor_core::node::{EvalContext, Node, NodeFuture};
use compositor_core::types::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::any::Any;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Metadata about a loaded image sequence (frame count, range).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceInfo {
    pub frame_count: u64,
    pub first_frame: u64,
    pub last_frame: u64,
}

pub struct LoadImage {
    image: Mutex<Option<Image>>,
    original_bytes: Mutex<Option<Vec<u8>>>,
}

impl LoadImage {
    pub fn new() -> Self {
        Self {
            image: Mutex::new(None),
            original_bytes: Mutex::new(None),
        }
    }

    pub fn set_image_data(&self, bytes: &[u8]) -> Result<(), CompositorError> {
        let decoded = image::load_from_memory(bytes)
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
            return Err(CompositorError::ImageTooLarge { width, height, max: MAX_IMAGE_DIM });
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
            .image
            .lock()
            .map_err(|_| CompositorError::Other("Image mutex poisoned".to_string()))?;
        *guard = Some(image);
        let mut bytes_guard = self
            .original_bytes
            .lock()
            .map_err(|_| CompositorError::Other("Image bytes mutex poisoned".to_string()))?;
        *bytes_guard = Some(bytes.to_vec());
        Ok(())
    }

    pub fn get_image_bytes(&self) -> Option<Vec<u8>> {
        self.original_bytes
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }
}

impl Node for LoadImage {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "load_image".to_string(),
            display_name: "Load Image".to_string(),
            category: "Input".to_string(),
            description: "Load an image from memory".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
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

    fn evaluate<'a>(&'a self, _ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let guard = self
                .image
                .lock()
                .map_err(|_| CompositorError::Other("Image mutex poisoned".to_string()))?;
            let image = guard
                .as_ref()
                .ok_or_else(|| CompositorError::MissingInput("image_data".to_string()))?;
            let mut outputs = HashMap::new();
            outputs.insert("image".to_string(), Value::Image(image.clone()));
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

const FRAME_CACHE_SIZE: usize = 32;

pub struct LoadImageSequence {
    directory: Mutex<Option<String>>,
    frame_cache: Mutex<FrameCache>,
}

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

impl LoadImageSequence {
    pub fn new() -> Self {
        Self {
            directory: Mutex::new(None),
            frame_cache: Mutex::new(FrameCache::new(FRAME_CACHE_SIZE)),
        }
    }

    pub fn set_info(&self, _info: SequenceInfo) -> Result<(), CompositorError> {
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;
        cache.clear();
        Ok(())
    }

    pub fn set_frame_data(&self, frame: u64, bytes: &[u8]) -> Result<(), CompositorError> {
        let decoded = image::load_from_memory(bytes)
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
            return Err(CompositorError::ImageTooLarge { width, height, max: MAX_IMAGE_DIM });
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
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;
        cache.insert(frame, image);
        Ok(())
    }

    pub fn set_directory(&self, dir: &str) -> Result<SequenceInfo, CompositorError> {
        let mut guard = self
            .directory
            .lock()
            .map_err(|_| CompositorError::Other("Directory mutex poisoned".to_string()))?;
        *guard = Some(dir.to_string());
        drop(guard);

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;
        cache.clear();
        drop(cache);

        let detected = detect_sequence_pattern(dir);
        self.get_sequence_info(&detected)
    }

    pub fn get_sequence_info(&self, pattern: &str) -> Result<SequenceInfo, CompositorError> {
        let dir_guard = self
            .directory
            .lock()
            .map_err(|_| CompositorError::Other("Directory mutex poisoned".to_string()))?;
        let dir = dir_guard
            .as_ref()
            .ok_or_else(|| CompositorError::MissingInput("directory".to_string()))?;

        let regex_pattern = build_frame_regex(pattern);
        let re = regex::Regex::new(&regex_pattern)
            .map_err(|e| CompositorError::Other(format!("Invalid pattern: {e}")))?;

        let mut frame_numbers: Vec<u64> = Vec::new();
        let entries = std::fs::read_dir(dir).map_err(|e| {
            CompositorError::Other(format!("Failed to read directory {}: {e}", dir))
        })?;

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
            last_frame: *frame_numbers.last().unwrap(),
        })
    }

    fn load_frame(&self, dir: &str, pattern: &str, frame: u64) -> Result<Image, CompositorError> {
        let padding = parse_frame_padding(pattern);
        let normalized = normalize_pattern(pattern);
        let filename = normalized.replace("{frame}", &format_frame_number(frame, padding));
        let path = std::path::Path::new(dir).join(&filename);
        let bytes = std::fs::read(&path).map_err(|e| {
            CompositorError::Other(format!("Failed to read frame {}: {}", path.display(), e))
        })?;
        let decoded = image::load_from_memory(&bytes)
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
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
        Ok(Image::from_f32_data(width, height, data)?)
    }
}

impl Node for LoadImageSequence {
    fn spec(&self) -> NodeSpec {
        NodeSpec {
            id: "load_image_sequence".to_string(),
            display_name: "Load Image Sequence".to_string(),
            category: "Input".to_string(),
            description: "Load an image sequence from a directory".to_string(),
            inputs: vec![],
            outputs: vec![PortSpec {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: ValueType::Image,
                ..Default::default()
            }],
            params: vec![
                ParamSpec {
                    key: "directory".to_string(),
                    label: "Directory".to_string(),
                    ty: ValueType::Int,
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
                    ty: ValueType::Int,
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
                .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;

            if let Some(image) = cache.get(frame) {
                let mut outputs = HashMap::new();
                outputs.insert("image".to_string(), Value::Image(image.clone()));
                return Ok(outputs);
            }

            let dir_guard = self
                .directory
                .lock()
                .map_err(|_| CompositorError::Other("Directory mutex poisoned".to_string()))?;

            let dir = match dir_guard.as_ref() {
                Some(d) => d.clone(),
                None => {
                    return Err(CompositorError::MissingInput(
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

            let image = self.load_frame(&dir, pattern, frame)?;
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
    let numeric_re = regex::Regex::new(r"\d+").unwrap();
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
        None => format!("{{frame:4}}.png"),
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
    format!("{:0>width$}", frame, width = padding)
}

fn build_frame_regex(pattern: &str) -> String {
    let normalized = normalize_pattern(pattern);
    let escaped = regex::escape(&normalized);
    let with_capture = escaped.replace("\\{frame\\}", "(\\d+)");
    format!("^{}$", with_capture)
}

pub struct LoadVideo {
    frame_cache: Mutex<FrameCache>,
    frame_loader: Mutex<Option<Box<dyn Fn(u64) -> Result<Image, CompositorError> + Send>>>,
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
    pub fn set_frame_loader(
        &self,
        loader: Box<dyn Fn(u64) -> Result<Image, CompositorError> + Send>,
    ) -> Result<(), CompositorError> {
        let mut guard = self
            .frame_loader
            .lock()
            .map_err(|_| CompositorError::Other("Frame loader mutex poisoned".to_string()))?;
        *guard = Some(loader);

        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;
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
                    .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;

                if let Some(image) = cache.get(frame) {
                    let mut outputs = HashMap::new();
                    outputs.insert("image".to_string(), Value::Image(image.clone()));
                    return Ok(outputs);
                }
            }

            let loader_guard = self
                .frame_loader
                .lock()
                .map_err(|_| CompositorError::Other("Frame loader mutex poisoned".to_string()))?;

            let loader = loader_guard.as_ref().ok_or_else(|| {
                CompositorError::MissingInput(
                    "No frame data available. Load a video file.".to_string(),
                )
            })?;

            let image = loader(frame)?;

            let mut cache = self
                .frame_cache
                .lock()
                .map_err(|_| CompositorError::Other("Cache mutex poisoned".to_string()))?;
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
        for i in 0..256 {
            let v = i as f32 / 255.0;
            let linear = if v <= 0.04045 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            };
            table[i] = linear;
        }
        table
    })
}

pub struct LoadImageBatch {
    entries: Mutex<Vec<(String, Vec<u8>)>>,
    frame_cache: Mutex<FrameCache>,
}
impl LoadImageBatch {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            frame_cache: Mutex::new(FrameCache::new(FRAME_CACHE_SIZE)),
        }
    }
    pub fn clear(&self) -> Result<(), CompositorError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
        entries.clear();
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Batch cache mutex poisoned".to_string()))?;
        cache.clear();
        Ok(())
    }
    pub fn add_image(&self, filename: &str, bytes: &[u8]) -> Result<(), CompositorError> {
        // Validate that the bytes are a decodable image without full decode
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        let (width, height) = reader
            .into_dimensions()
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        if width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM {
            return Err(CompositorError::ImageTooLarge { width, height, max: MAX_IMAGE_DIM });
        }
        let stem = std::path::Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(filename)
            .to_string();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
        entries.push((stem, bytes.to_vec()));
        Ok(())
    }
    pub fn image_count(&self) -> Result<usize, CompositorError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
        Ok(entries.len())
    }

    pub fn filenames(&self) -> Result<Vec<String>, CompositorError> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
        Ok(entries.iter().map(|(stem, _)| stem.clone()).collect())
    }

    fn decode_frame(&self, index: usize) -> Result<Image, CompositorError> {
        // Check cache first
        {
            let cache = self
                .frame_cache
                .lock()
                .map_err(|_| CompositorError::Other("Batch cache mutex poisoned".to_string()))?;
            if let Some(img) = cache.get(index as u64) {
                return Ok(img.clone());
            }
        }

        // Cache miss - decode from raw bytes
        let bytes = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
            let (_, raw) = entries
                .get(index)
                .ok_or_else(|| CompositorError::MissingInput("Batch index out of range".to_string()))?;
            raw.clone()
        };

        let decoded = image::load_from_memory(&bytes)
            .map_err(|e| CompositorError::ImageDecode(e.to_string()))?;
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
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
        // Insert into cache
        let mut cache = self
            .frame_cache
            .lock()
            .map_err(|_| CompositorError::Other("Batch cache mutex poisoned".to_string()))?;
        cache.insert(index as u64, image.clone());

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
            params: vec![],
        }
    }
    fn evaluate<'a>(&'a self, ctx: &'a EvalContext<'a>) -> NodeFuture<'a> {
        Box::pin(async move {
            let frame = ctx.frame_time.frame as usize;
            let image = self.decode_frame(frame)?;

            let stem = {
                let entries = self
                    .entries
                    .lock()
                    .map_err(|_| CompositorError::Other("Batch entries mutex poisoned".to_string()))?;
                let (stem, _) = entries
                    .get(frame)
                    .ok_or_else(|| CompositorError::MissingInput("Batch index out of range".to_string()))?;
                stem.clone()
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
