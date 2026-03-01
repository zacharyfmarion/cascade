use compositor_gpu::KernelManifest;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::SerializableGraph;

// Version history:
// 1.0.0 - Initial format
// 1.1.0 - Viewer node input port renamed from "image" to "value" for universal value inspection
pub const CURRENT_FORMAT_VERSION: &str = "1.1.0";

#[derive(Serialize, Deserialize)]
pub struct CompositorDocument {
    pub compositor: DocumentHeader,
    pub project: ProjectMetadata,
    pub graph: SerializableGraph,
    #[serde(default)]
    pub assets: HashMap<String, AssetReference>,
    #[serde(default)]
    pub scripts: HashMap<String, ScriptEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<ViewState>,
}

#[derive(Serialize, Deserialize)]
pub struct DocumentHeader {
    pub format_version: String,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub modified_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectMetadata {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct AssetReference {
    #[serde(rename = "type")]
    pub asset_type: String,
    pub source: String,
    pub path: String,
    #[serde(default)]
    pub original_filename: String,
    #[serde(default)]
    pub hash: String,
}

#[derive(Serialize, Deserialize)]
pub struct ScriptEntry {
    pub manifest: KernelManifest,
}

#[derive(Serialize, Deserialize)]
pub struct ViewState {
    #[serde(default)]
    pub viewport: ViewportState,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub timeline: TimelineState,
}

#[derive(Serialize, Deserialize, Default)]
pub struct ViewportState {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

#[derive(Serialize, Deserialize, Default)]
pub struct TimelineState {
    #[serde(default)]
    pub current_frame: u64,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_true")]
    pub loop_playback: bool,
}

fn default_fps() -> u32 {
    24
}

fn default_true() -> bool {
    true
}
