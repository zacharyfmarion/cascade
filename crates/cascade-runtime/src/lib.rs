#[cfg(not(target_arch = "wasm32"))]
pub mod ai_provider;
mod builtin_groups;
pub mod document;
pub mod migrations;

#[cfg(not(target_arch = "wasm32"))]
use crate::ai_provider::NativeAiProvider;
use cascade_core::ai::AiProvider;
use cascade_core::color::{BuiltinColorManagement, ColorManagement};
use cascade_core::error::CascadeError;
use cascade_core::eval::Evaluator;
use cascade_core::graph::{Graph, InstanceAwareSpecProvider, NodeId};
use cascade_core::group::{
    CustomNodeInfo, GroupDefinition, InternalConnection, InternalNode, NodePackage,
    SerializableInternalGraph,
};
use cascade_core::node::{Node, NodeRegistry};
pub use cascade_core::types::{
    Format, FrameTime, Image, NodeSpec, ParamDefault, ParamValue, PortSpec, RuntimeSurface,
    UiNodeSpec, Value, ValueType,
};
use cascade_gpu::kernel_node::GpuKernelNode;
use cascade_gpu::{
    gpu_script_passthrough_manifest, register_gpu_nodes, GpuContext, KernelManifest,
};
use cascade_nodes_std::group::InternalOutputEvalRequest;
use cascade_nodes_std::input::LoadImage as InputLoadImage;
pub use cascade_nodes_std::SequenceInfo;
use cascade_nodes_std::{
    register_standard_nodes, ColorPaletteNode, GpuScriptDraftNode, GroupNode, LoadImageSequence,
    Viewer,
};
#[cfg(all(feature = "video", target_os = "macos"))]
use cascade_nodes_std::{srgb_to_linear_lut, LoadVideo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use uuid::Uuid;

pub use document::*;

const GPU_SCRIPT_MANIFEST_PARAM_KEY: &str = "__script_manifest";

fn serialize_gpu_script_manifest(manifest: &KernelManifest) -> Result<String, String> {
    serde_json::to_string(manifest).map_err(|e| e.to_string())
}

fn register_gpu_script_draft(
    registry: &mut Arc<NodeRegistry>,
    type_id: &str,
    manifest: &KernelManifest,
) -> Result<NodeSpec, String> {
    let spec = manifest.to_node_spec()?;
    let spec_for_factory = spec.clone();
    Arc::make_mut(registry).register_or_replace(type_id, move || {
        Arc::new(GpuScriptDraftNode::with_spec(spec_for_factory.clone()))
    });
    Ok(spec)
}

fn param_default_to_value(default: &ParamDefault) -> ParamValue {
    match default {
        ParamDefault::Float(value) => ParamValue::Float(*value),
        ParamDefault::Int(value) => ParamValue::Int(*value),
        ParamDefault::Bool(value) => ParamValue::Bool(*value),
        ParamDefault::Color(value) => ParamValue::Color(*value),
        ParamDefault::ColorRamp(value) => ParamValue::ColorRamp(value.clone()),
        ParamDefault::ColorPalette(value) => ParamValue::ColorPalette(value.clone()),
        ParamDefault::CurvePoints(value) => ParamValue::CurvePoints(value.clone()),
        ParamDefault::String(value) => ParamValue::String(value.clone()),
    }
}

fn param_value_to_runtime_value(value: &ParamValue) -> Value {
    match value {
        ParamValue::Float(value) => Value::Float(*value as f32),
        ParamValue::Int(value) => Value::Int(*value as i32),
        ParamValue::Bool(value) => Value::Bool(*value),
        ParamValue::Color(value) => Value::Color([
            value[0] as f32,
            value[1] as f32,
            value[2] as f32,
            value[3] as f32,
        ]),
        ParamValue::String(value) => Value::String(value.clone()),
        _ => Value::None,
    }
}

fn param_default_to_runtime_value(default: &ParamDefault) -> Value {
    param_value_to_runtime_value(&param_default_to_value(default))
}

fn extract_gpu_script_manifest(
    type_id: &str,
    params: &HashMap<String, ParamValue>,
) -> Option<KernelManifest> {
    let ParamValue::String(manifest_json) = params.get(GPU_SCRIPT_MANIFEST_PARAM_KEY)? else {
        return None;
    };
    let mut manifest: KernelManifest = serde_json::from_str(manifest_json).ok()?;
    manifest.id = type_id.to_string();
    Some(manifest)
}

pub struct Engine {
    graph: Graph,
    registry: Arc<NodeRegistry>,
    nodes: HashMap<NodeId, Arc<dyn Node>>,
    evaluator: Evaluator,
    gpu_context: Option<Arc<GpuContext>>,
    color_management: Box<dyn ColorManagement>,
    ai_provider: Option<Arc<dyn AiProvider>>,
    group_definitions: HashMap<String, Arc<GroupDefinition>>,
    uuid_map: HashMap<String, NodeId>,
    kernel_manifests: HashMap<String, KernelManifest>,
    pub active_job: Option<Arc<RenderJob>>,
    last_timings: HashMap<String, f64>,
    active_display: String,
    active_view: String,
    project_format: Format,
}

#[derive(Serialize, Deserialize)]
pub struct SerializableGraph {
    pub nodes: Vec<SerializableNode>,
    pub connections: Vec<SerializableConnection>,
    #[serde(default)]
    pub group_definitions: Vec<GroupDefinition>,
}

#[derive(Serialize, Deserialize)]
pub struct SerializableNode {
    pub id: String,
    pub type_id: String,
    pub params: HashMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub input_defaults: HashMap<String, ParamValue>,
    pub position: (f64, f64),
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub muted: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SerializableConnection {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupResult {
    pub group_definition_id: String,
    pub group_node_id: String,
    pub removed_node_ids: Vec<String>,
    pub new_spec: NodeSpec,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UngroupResult {
    pub restored_nodes: Vec<RestoredNode>,
    pub removed_group_node_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredNode {
    pub id: String,
    pub type_id: String,
    pub position: (f64, f64),
    pub params: HashMap<String, ParamValue>,
    pub input_defaults: HashMap<String, ParamValue>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrunedConnection {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInterfaceChange {
    pub new_spec: NodeSpec,
    pub removed_output_ports: Vec<String>,
    pub pruned_connections: Vec<PrunedConnection>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupInternalGraph {
    pub group_def_id: String,
    pub name: String,
    pub nodes: Vec<InternalGraphNode>,
    pub connections: Vec<InternalGraphConnection>,
    pub inputs: Vec<PortSpec>,
    pub outputs: Vec<PortSpec>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalGraphNode {
    pub id: String,
    pub type_id: String,
    pub params: HashMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub muted: bool,
    pub position: (f64, f64),
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub input_defaults: HashMap<String, ParamValue>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalGraphConnection {
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
}

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameRange {
    pub start: u64,
    pub end: u64,
    pub step: u64,
}

pub struct RenderJob {
    pub id: String,
    pub cancelled: Arc<AtomicBool>,
    pub current_frame: Arc<AtomicU64>,
    pub total_frames: u64,
    pub completed: Arc<AtomicBool>,
    pub error: Arc<std::sync::Mutex<Option<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub job_id: String,
    pub current_frame: u64,
    pub total_frames: u64,
    pub completed: bool,
    pub error: Option<String>,
}

impl Engine {
    pub fn new() -> Self {
        let mut registry = NodeRegistry::new();
        register_standard_nodes(&mut registry);
        let gpu_context = match GpuContext::new() {
            Ok(context) => {
                let shared = Arc::new(context);
                register_gpu_nodes(&mut registry, shared.clone());
                Some(shared)
            }
            Err(err) => {
                eprintln!("[cascade-runtime] GPU init failed: {err}");
                None
            }
        };
        let mut engine = Self {
            graph: Graph::new(),
            registry: Arc::new(registry),
            nodes: HashMap::new(),
            evaluator: Evaluator::new(),
            gpu_context,
            color_management: Box::new(BuiltinColorManagement::new()),
            ai_provider: None,
            group_definitions: HashMap::new(),
            uuid_map: HashMap::new(),
            kernel_manifests: HashMap::new(),
            active_job: None,
            last_timings: HashMap::new(),
            active_display: "sRGB".to_string(),
            active_view: "Standard".to_string(),
            project_format: Format::hd(),
        };
        builtin_groups::register_builtin_groups(&mut engine);
        if let Some(kernels_dir) = find_kernels_dir() {
            let path = kernels_dir.to_string_lossy();
            if let Err(err) = engine.load_kernels_from_dir(&path) {
                eprintln!("[cascade-runtime] Failed to load kernels from {path}: {err}");
            }
        }
        engine
    }

    #[cfg(feature = "ocio")]
    pub fn load_ocio_config(&mut self, path: &str) -> Result<(), CascadeError> {
        let ocio = cascade_ocio::OcioColorManagement::from_file(path)?;
        self.color_management = Box::new(ocio);
        self.sync_active_display_view();
        self.evaluator = Evaluator::new();
        Ok(())
    }

    #[cfg(feature = "ocio")]
    pub fn load_ocio_from_env(&mut self) -> Result<(), CascadeError> {
        let ocio = cascade_ocio::OcioColorManagement::from_env()?;
        self.color_management = Box::new(ocio);
        self.sync_active_display_view();
        self.evaluator = Evaluator::new();
        Ok(())
    }

    pub fn reset_color_management(&mut self) {
        self.color_management = Box::new(cascade_core::color::BuiltinColorManagement::new());
        self.active_display = "sRGB".to_string();
        self.active_view = "Standard".to_string();
        self.evaluator = Evaluator::new();
    }

    #[cfg(feature = "ocio")]
    fn sync_active_display_view(&mut self) {
        let displays = self.color_management.available_displays();
        let display = displays
            .iter()
            .find(|d| d.to_lowercase().contains("srgb"))
            .or(displays.first());

        if let Some(display) = display {
            self.active_display = display.clone();
            let views = self.color_management.available_views(display);
            let view = views
                .iter()
                .find(|v| v.to_lowercase().contains("un-tone-mapped"))
                .or_else(|| views.iter().find(|v| v.to_lowercase().contains("untone")))
                .or(views.first());

            if let Some(view) = view {
                self.active_view = view.clone();
            }
        }
    }

    pub fn color_management(&self) -> &dyn ColorManagement {
        self.color_management.as_ref()
    }

    pub fn available_color_spaces(&self) -> Vec<cascade_core::color::ColorSpaceInfo> {
        self.color_management.available_color_spaces()
    }

    pub fn available_displays(&self) -> Vec<String> {
        self.color_management.available_displays()
    }

    pub fn available_views(&self, display: &str) -> Vec<String> {
        self.color_management.available_views(display)
    }

    pub fn working_space(&self) -> String {
        self.color_management.working_space().to_string()
    }

    pub fn active_display(&self) -> &str {
        &self.active_display
    }

    pub fn active_view(&self) -> &str {
        &self.active_view
    }

    pub fn set_active_display_view(&mut self, display: String, view: String) {
        self.active_display = display;
        self.active_view = view;
        self.evaluator = Evaluator::new();
    }

    pub fn set_project_format(&mut self, width: u32, height: u32) {
        self.project_format = Format::from_dimensions(width, height);
        self.evaluator = Evaluator::new();
    }

    pub fn set_ai_api_key(&mut self, provider: &str, _key: &str) -> Result<(), CascadeError> {
        match provider {
            #[cfg(not(target_arch = "wasm32"))]
            "replicate" | "native" => {
                let ai = Arc::new(NativeAiProvider::new());
                ai.set_api_key(_key.to_string());
                let ai_provider: Arc<dyn AiProvider> = ai;
                self.ai_provider = Some(ai_provider);
                Ok(())
            }
            _ => Err(CascadeError::Other(format!(
                "Unknown AI provider: {provider}"
            ))),
        }
    }

    pub fn is_ai_configured(&self) -> bool {
        self.ai_provider
            .as_ref()
            .is_some_and(|provider| provider.is_configured())
    }

    pub fn register_gpu_kernel(&mut self, manifest_json: &str) -> Result<NodeSpec, String> {
        let manifest: KernelManifest =
            serde_json::from_str(manifest_json).map_err(|e| e.to_string())?;
        let gpu_context = self
            .gpu_context
            .clone()
            .ok_or_else(|| "GPU not available".to_string())?;
        let validation_node = GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone())?;
        let spec = validation_node.spec();
        let manifest_id = manifest.id.clone();
        self.kernel_manifests
            .insert(manifest_id.clone(), manifest.clone());
        let manifest_for_factory = manifest.clone();
        Arc::make_mut(&mut self.registry).register(&manifest_id, move || {
            // SAFETY: manifest was validated by from_manifest() on line 341.
            // NodeRegistry::register requires infallible Fn() -> Arc<dyn Node>.
            Arc::new(
                GpuKernelNode::from_manifest(manifest_for_factory.clone(), gpu_context.clone())
                    .expect("GPU node factory: manifest was pre-validated"),
            )
        });
        Ok(spec)
    }

    pub fn register_group(&mut self, def: GroupDefinition) -> Result<NodeSpec, String> {
        let arc_def = Arc::new(def);
        let interface = GroupNode::derive_interface(&arc_def, &self.registry)?;
        let spec = GroupNode::build_spec(&arc_def, &interface);
        Arc::make_mut(&mut self.registry).register_spec(&spec.id, spec.clone());
        self.group_definitions.insert(spec.id.clone(), arc_def);
        Ok(spec)
    }

    fn collect_group_deps(
        &self,
        group_def_id: &str,
        collected: &mut Vec<GroupDefinition>,
        visited: &mut HashSet<String>,
    ) {
        if !visited.insert(group_def_id.to_string()) {
            return;
        }
        if let Some(def) = self.group_definitions.get(group_def_id) {
            for node in &def.internal_graph.nodes {
                if node.type_id.starts_with("group::") {
                    self.collect_group_deps(&node.type_id, collected, visited);
                }
            }
            collected.push(def.as_ref().clone());
        }
    }

    pub fn export_group_as_package(&self, group_def_id: &str) -> Result<String, CascadeError> {
        if !self.group_definitions.contains_key(group_def_id) {
            return Err(CascadeError::Other(format!(
                "Group definition not found: {group_def_id}"
            )));
        }

        let mut collected = Vec::new();
        let mut visited = HashSet::new();
        self.collect_group_deps(group_def_id, &mut collected, &mut visited);

        let package = NodePackage {
            version: 2,
            cascade_version: env!("CARGO_PKG_VERSION").to_string(),
            exported_at: String::new(),
            nodes: collected,
        };
        serde_json::to_string_pretty(&package)
            .map_err(|e| CascadeError::Other(format!("Serialization failed: {e}")))
    }

    pub fn import_custom_nodes(&mut self, json: &str) -> Result<Vec<NodeSpec>, CascadeError> {
        let package: NodePackage = serde_json::from_str(json)
            .map_err(|e| CascadeError::Other(format!("Invalid node package: {e}")))?;

        let mut id_remap: HashMap<String, String> = HashMap::new();
        let mut imported_specs: Vec<NodeSpec> = Vec::new();

        for mut def in package.nodes {
            let original_id = def.id.clone();
            let new_id = format!("group::imported_{}", Uuid::new_v4());
            def.id = new_id.clone();
            def.is_builtin = false;
            id_remap.insert(original_id, new_id);

            for node in &mut def.internal_graph.nodes {
                if let Some(remapped) = id_remap.get(&node.type_id) {
                    node.type_id = remapped.clone();
                }
            }

            let spec = self.register_group(def).map_err(CascadeError::Other)?;
            imported_specs.push(spec);
        }

        Ok(imported_specs)
    }

    pub fn register_group_definition_json(&mut self, json: &str) -> Result<NodeSpec, CascadeError> {
        let mut def: GroupDefinition = serde_json::from_str(json)
            .map_err(|e| CascadeError::Other(format!("Invalid group definition: {e}")))?;
        def.is_builtin = false;
        let id = def.id.clone();
        let spec = self.register_group(def).map_err(CascadeError::Other)?;
        self.refresh_group_instances(&id)?;
        Ok(spec)
    }

    pub fn load_custom_nodes_from_dir(&mut self, dir: &Path) -> Result<usize, CascadeError> {
        if !dir.exists() {
            return Ok(0);
        }
        let mut total = 0usize;
        let entries = fs::read_dir(dir)
            .map_err(|e| CascadeError::Other(format!("Failed to read dir: {e}")))?;
        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    eprintln!("[cascade-runtime] Skipping dir entry: {err}");
                    continue;
                }
            };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("compnode") {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(contents) => match self.import_custom_nodes(&contents) {
                    Ok(specs) => {
                        total += specs.len();
                        eprintln!(
                            "[cascade-runtime] Loaded {} custom node(s) from {}",
                            specs.len(),
                            path.display()
                        );
                    }
                    Err(err) => {
                        eprintln!(
                            "[cascade-runtime] Failed to import {}: {err}",
                            path.display()
                        );
                    }
                },
                Err(err) => {
                    eprintln!("[cascade-runtime] Failed to read {}: {err}", path.display());
                }
            }
        }
        Ok(total)
    }

    pub fn list_custom_nodes(&self) -> Vec<CustomNodeInfo> {
        self.group_definitions
            .values()
            .filter(|def| !def.is_builtin)
            .map(|def| CustomNodeInfo {
                id: def.id.clone(),
                name: def.name.clone(),
                category: def.category.clone(),
                description: def.description.clone(),
                node_count: 1,
                file_path: String::new(),
            })
            .collect()
    }

    pub fn remove_custom_node(&mut self, group_def_id: &str) -> Result<(), CascadeError> {
        if self.group_definitions.remove(group_def_id).is_none() {
            return Err(CascadeError::Other(format!(
                "Custom node not found: {group_def_id}"
            )));
        }
        Ok(())
    }

    pub fn create_group_from_nodes(
        &mut self,
        node_ids: &[&str],
        name: &str,
    ) -> Result<CreateGroupResult, CascadeError> {
        if node_ids.is_empty() {
            return Err(CascadeError::Other(
                "No nodes selected for grouping".to_string(),
            ));
        }

        let mut selected_ids = Vec::new();
        let mut selected_set = HashSet::new();
        for node_id in node_ids {
            let id = self.parse_node_id(node_id)?;
            if selected_set.insert(id) {
                selected_ids.push(id);
            }
        }

        struct SelectedNodeInfo {
            id: NodeId,
            type_id: String,
            params: HashMap<String, ParamValue>,
            input_defaults: HashMap<String, ParamValue>,
            position: (f64, f64),
            muted: bool,
        }

        let mut selected_nodes = Vec::new();
        let mut centroid_x = 0.0;
        let mut centroid_y = 0.0;
        for id in &selected_ids {
            let instance = self
                .graph
                .nodes
                .get(*id)
                .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
            centroid_x += instance.position.0;
            centroid_y += instance.position.1;
            selected_nodes.push(SelectedNodeInfo {
                id: instance.id,
                type_id: instance.type_id.clone(),
                params: instance.params.clone(),
                input_defaults: instance.input_defaults.clone(),
                position: instance.position,
                muted: instance.muted,
            });
        }
        let count = selected_nodes.len() as f64;
        let centroid = if count > 0.0 {
            (centroid_x / count, centroid_y / count)
        } else {
            (0.0, 0.0)
        };

        struct IncomingBoundary {
            external_from: NodeId,
            external_from_port: String,
            internal_to: String,
            internal_to_port: String,
            port_name: String,
        }

        struct OutgoingBoundary {
            external_to: NodeId,
            external_to_port: String,
            internal_from: String,
            internal_from_port: String,
            port_name: String,
        }

        let mut internal_connections = Vec::new();
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();
        let mut input_name_counts: HashMap<String, usize> = HashMap::new();
        let mut output_name_counts: HashMap<String, usize> = HashMap::new();

        for conn in self.graph.connections() {
            let from_selected = selected_set.contains(&conn.from_node);
            let to_selected = selected_set.contains(&conn.to_node);
            if from_selected && to_selected {
                internal_connections.push(InternalConnection {
                    from_node: format_node_id(&self.graph, conn.from_node),
                    from_port: conn.from_port.clone(),
                    to_node: format_node_id(&self.graph, conn.to_node),
                    to_port: conn.to_port.clone(),
                });
            } else if !from_selected && to_selected {
                let to_instance = self
                    .graph
                    .nodes
                    .get(conn.to_node)
                    .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
                let to_spec = self
                    .registry
                    .get_spec(&to_instance.type_id)
                    .ok_or_else(|| {
                        CascadeError::Other(format!("Unknown node type: {}", to_instance.type_id))
                    })?;
                let _input_port = to_spec
                    .all_inputs()
                    .iter()
                    .find(|p| p.name == conn.to_port)
                    .ok_or(CascadeError::PortNotFound {
                        node_type: to_instance.type_id.clone(),
                        port_name: conn.to_port.clone(),
                    })?;
                let port_name = unique_port_name(&conn.to_port, &mut input_name_counts);
                incoming.push(IncomingBoundary {
                    external_from: conn.from_node,
                    external_from_port: conn.from_port.clone(),
                    internal_to: format_node_id(&self.graph, conn.to_node),
                    internal_to_port: conn.to_port.clone(),
                    port_name: port_name.clone(),
                });
            } else if from_selected && !to_selected {
                let from_instance = self
                    .graph
                    .nodes
                    .get(conn.from_node)
                    .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
                let from_spec =
                    self.registry
                        .get_spec(&from_instance.type_id)
                        .ok_or_else(|| {
                            CascadeError::Other(format!(
                                "Unknown node type: {}",
                                from_instance.type_id
                            ))
                        })?;
                let _output_port = from_spec
                    .outputs
                    .iter()
                    .find(|p| p.name == conn.from_port)
                    .ok_or(CascadeError::PortNotFound {
                        node_type: from_instance.type_id.clone(),
                        port_name: conn.from_port.clone(),
                    })?;
                let port_name = unique_port_name(&conn.from_port, &mut output_name_counts);
                outgoing.push(OutgoingBoundary {
                    external_to: conn.to_node,
                    external_to_port: conn.to_port.clone(),
                    internal_from: format_node_id(&self.graph, conn.from_node),
                    internal_from_port: conn.from_port.clone(),
                    port_name: port_name.clone(),
                });
            }
        }

        let mut internal_nodes = Vec::new();
        let mut min_x = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut avg_y = 0.0;
        for instance in &selected_nodes {
            let offset_x = instance.position.0 - centroid.0;
            let offset_y = instance.position.1 - centroid.1;
            if offset_x < min_x {
                min_x = offset_x;
            }
            if offset_x > max_x {
                max_x = offset_x;
            }
            avg_y += offset_y;
            let image_data = if instance.type_id == "load_image" {
                self.nodes
                    .get(&instance.id)
                    .and_then(|node_arc| node_arc.as_any().downcast_ref::<InputLoadImage>())
                    .and_then(|load_node| load_node.get_image_bytes())
            } else {
                None
            };
            internal_nodes.push(InternalNode {
                id: format_node_id(&self.graph, instance.id),
                type_id: instance.type_id.clone(),
                params: instance.params.clone(),
                muted: instance.muted,
                position: (offset_x, offset_y),
                image_data,
                input_defaults: instance.input_defaults.clone(),
            });
        }
        avg_y /= count;
        let node_width = 200.0;
        let padding = 100.0;

        internal_nodes.push(InternalNode {
            id: "gi".to_string(),
            type_id: "group_input".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (min_x - node_width - padding, avg_y),
            image_data: None,
            input_defaults: HashMap::new(),
        });

        internal_nodes.push(InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: HashMap::new(),
            muted: false,
            position: (max_x + node_width + padding, avg_y),
            image_data: None,
            input_defaults: HashMap::new(),
        });

        for boundary in &incoming {
            internal_connections.push(InternalConnection {
                from_node: "gi".to_string(),
                from_port: boundary.port_name.clone(),
                to_node: boundary.internal_to.clone(),
                to_port: boundary.internal_to_port.clone(),
            });
        }
        for boundary in &outgoing {
            internal_connections.push(InternalConnection {
                from_node: boundary.internal_from.clone(),
                from_port: boundary.internal_from_port.clone(),
                to_node: "go".to_string(),
                to_port: boundary.port_name.clone(),
            });
        }

        let group_definition_id = format!("group::user_{}", Uuid::new_v4());
        let definition = GroupDefinition {
            id: group_definition_id.clone(),
            name: name.to_string(),
            category: "User".to_string(),
            description: "User-defined group".to_string(),
            internal_graph: SerializableInternalGraph {
                nodes: internal_nodes,
                connections: internal_connections,
            },
            promotions: Vec::new(),
            is_builtin: false,
            explicit_inputs: None,
            explicit_outputs: None,
        };

        let new_spec = self
            .register_group(definition)
            .map_err(CascadeError::Other)?;

        let removed_node_ids: Vec<String> = selected_ids
            .iter()
            .map(|id| format_node_id(&self.graph, *id))
            .collect();
        for id in &selected_ids {
            self.remove_node_internal(*id);
        }

        let (group_node_id, _) = self.add_node(&group_definition_id, centroid.0, centroid.1)?;
        let group_id = self.parse_node_id(&group_node_id)?;

        for boundary in &incoming {
            self.graph.connect(
                &self.registry,
                boundary.external_from,
                &boundary.external_from_port,
                group_id,
                &boundary.port_name,
            )?;
        }
        for boundary in &outgoing {
            self.graph.connect(
                &self.registry,
                group_id,
                &boundary.port_name,
                boundary.external_to,
                &boundary.external_to_port,
            )?;
        }

        Ok(CreateGroupResult {
            group_definition_id,
            group_node_id,
            removed_node_ids,
            new_spec,
        })
    }

    pub fn ungroup_node(&mut self, group_node_id: &str) -> Result<UngroupResult, CascadeError> {
        let group_id = self.parse_node_id(group_node_id)?;
        let group_instance = self
            .graph
            .nodes
            .get(group_id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let group_type_id = group_instance.type_id.clone();
        let group_def = self
            .group_definitions
            .get(&group_type_id)
            .cloned()
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;

        let group_position = group_instance.position;

        struct ExternalConnection {
            from_node: NodeId,
            from_port: String,
            to_node: NodeId,
            to_port: String,
        }

        let mut incoming_external = Vec::new();
        let mut outgoing_external = Vec::new();
        for conn in self.graph.connections() {
            if conn.to_node == group_id {
                incoming_external.push(ExternalConnection {
                    from_node: conn.from_node,
                    from_port: conn.from_port.clone(),
                    to_node: conn.to_node,
                    to_port: conn.to_port.clone(),
                });
            } else if conn.from_node == group_id {
                outgoing_external.push(ExternalConnection {
                    from_node: conn.from_node,
                    from_port: conn.from_port.clone(),
                    to_node: conn.to_node,
                    to_port: conn.to_port.clone(),
                });
            }
        }

        self.remove_node_internal(group_id);

        let (group_input_id, group_output_id) = find_group_nodes(group_def.as_ref())?;

        let mut input_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut output_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for conn in &group_def.internal_graph.connections {
            if conn.from_node == group_input_id {
                input_map
                    .entry(conn.from_port.clone())
                    .or_default()
                    .push((conn.to_node.clone(), conn.to_port.clone()));
            }
            if conn.to_node == group_output_id {
                output_map
                    .entry(conn.to_port.clone())
                    .or_default()
                    .push((conn.from_node.clone(), conn.from_port.clone()));
            }
        }

        let mut id_map: HashMap<String, NodeId> = HashMap::new();
        let mut restored_nodes = Vec::new();

        for internal in &group_def.internal_graph.nodes {
            if internal.type_id == "group_input" || internal.type_id == "group_output" {
                continue;
            }

            let (offset_x, offset_y) = if internal.position != (0.0, 0.0) {
                internal.position
            } else {
                let ox = match internal.params.get("__group_offset_x") {
                    Some(ParamValue::Float(v)) => *v,
                    _ => 0.0,
                };
                let oy = match internal.params.get("__group_offset_y") {
                    Some(ParamValue::Float(v)) => *v,
                    _ => 0.0,
                };
                (ox, oy)
            };
            let position = (group_position.0 + offset_x, group_position.1 + offset_y);

            let (new_id_str, _) = self.add_node(&internal.type_id, position.0, position.1)?;
            let new_id = self.parse_node_id(&new_id_str)?;

            let mut params = internal.params.clone();
            params.remove("__group_offset_x");
            params.remove("__group_offset_y");
            for (key, value) in &params {
                self.graph.set_param(new_id, key, value.clone());
            }

            for (key, value) in &internal.input_defaults {
                self.graph.set_input_default(new_id, key, value.clone());
            }
            id_map.insert(internal.id.clone(), new_id);
            restored_nodes.push(RestoredNode {
                id: new_id_str,
                type_id: internal.type_id.clone(),
                position,
                params,
                input_defaults: internal.input_defaults.clone(),
            });
        }

        for conn in &group_def.internal_graph.connections {
            if conn.from_node == group_input_id || conn.to_node == group_output_id {
                continue;
            }
            if conn.from_node == group_output_id || conn.to_node == group_input_id {
                continue;
            }
            let from_id = id_map
                .get(&conn.from_node)
                .copied()
                .ok_or_else(|| CascadeError::Other("Internal node not restored".to_string()))?;
            let to_id = id_map
                .get(&conn.to_node)
                .copied()
                .ok_or_else(|| CascadeError::Other("Internal node not restored".to_string()))?;
            self.graph.connect(
                &self.registry,
                from_id,
                &conn.from_port,
                to_id,
                &conn.to_port,
            )?;
        }

        for conn in &incoming_external {
            if let Some(targets) = input_map.get(&conn.to_port) {
                for (internal_id, internal_port) in targets {
                    if let Some(new_id) = id_map.get(internal_id) {
                        self.graph.connect(
                            &self.registry,
                            conn.from_node,
                            &conn.from_port,
                            *new_id,
                            internal_port,
                        )?;
                    }
                }
            }
        }

        for conn in &outgoing_external {
            if let Some(sources) = output_map.get(&conn.from_port) {
                for (internal_id, internal_port) in sources {
                    if let Some(new_id) = id_map.get(internal_id) {
                        self.graph.connect(
                            &self.registry,
                            *new_id,
                            internal_port,
                            conn.to_node,
                            &conn.to_port,
                        )?;
                    }
                }
            }
        }

        Ok(UngroupResult {
            restored_nodes,
            removed_group_node_id: group_node_id.to_string(),
        })
    }

    pub fn get_group_internal_graph(
        &self,
        group_node_id: &str,
    ) -> Result<GroupInternalGraph, CascadeError> {
        let group_id = self.parse_node_id(group_node_id)?;
        let group_instance = self
            .graph
            .nodes
            .get(group_id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let group_def = self
            .group_definitions
            .get(&group_instance.type_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let interface =
            GroupNode::derive_interface(group_def, &self.registry).map_err(CascadeError::Other)?;

        let mut nodes = Vec::new();
        for internal in &group_def.internal_graph.nodes {
            let (offset_x, offset_y) = if internal.position != (0.0, 0.0) {
                internal.position
            } else {
                let ox = match internal.params.get("__group_offset_x") {
                    Some(ParamValue::Float(v)) => *v,
                    _ => 0.0,
                };
                let oy = match internal.params.get("__group_offset_y") {
                    Some(ParamValue::Float(v)) => *v,
                    _ => 0.0,
                };
                (ox, oy)
            };
            let mut params = internal.params.clone();
            params.remove("__group_offset_x");
            params.remove("__group_offset_y");
            nodes.push(InternalGraphNode {
                id: internal.id.clone(),
                type_id: internal.type_id.clone(),
                params,
                muted: internal.muted,
                position: (offset_x, offset_y),
                input_defaults: internal.input_defaults.clone(),
            });
        }

        let connections = group_def
            .internal_graph
            .connections
            .iter()
            .map(|c| InternalGraphConnection {
                from_node: c.from_node.clone(),
                from_port: c.from_port.clone(),
                to_node: c.to_node.clone(),
                to_port: c.to_port.clone(),
            })
            .collect();

        Ok(GroupInternalGraph {
            group_def_id: group_def.id.clone(),
            name: group_def.name.clone(),
            nodes,
            connections,
            inputs: interface.inputs,
            outputs: interface.outputs,
        })
    }

    pub fn update_group_interface(
        &mut self,
        group_def_id: &str,
        inputs: Vec<PortSpec>,
        outputs: Vec<PortSpec>,
    ) -> Result<NodeSpec, CascadeError> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();
        let (group_input_id, group_output_id) = find_group_nodes(&updated_def)?;

        let input_names: HashSet<String> = inputs.iter().map(|p| p.name.clone()).collect();
        let output_names: HashSet<String> = outputs.iter().map(|p| p.name.clone()).collect();

        updated_def.internal_graph.connections.retain(|conn| {
            if conn.from_node == group_input_id {
                return input_names.contains(&conn.from_port);
            }
            if conn.to_node == group_output_id {
                return output_names.contains(&conn.to_port);
            }
            true
        });

        updated_def.explicit_inputs = Some(inputs);
        updated_def.explicit_outputs = Some(outputs);

        let spec = self
            .register_group(updated_def)
            .map_err(CascadeError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;

        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, node)| node.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
        }

        Ok(spec)
    }

    pub fn rename_group(
        &mut self,
        group_def_id: &str,
        new_name: &str,
    ) -> Result<NodeSpec, CascadeError> {
        let existing = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated = (*existing.as_ref()).clone();
        updated.name = new_name.to_string();
        let spec = self.register_group(updated).map_err(CascadeError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, node)| node.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();
        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
        }

        Ok(spec)
    }

    pub fn add_internal_connection(
        &mut self,
        group_def_id: &str,
        from_node: &str,
        from_port: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<NodeSpec, CascadeError> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();

        let (group_input_id, group_output_id) = find_group_nodes(&updated_def)?;

        let from_internal = updated_def
            .internal_graph
            .nodes
            .iter()
            .find(|node| node.id == from_node)
            .ok_or_else(|| CascadeError::Other(format!("Internal node not found: {from_node}")))?;
        let to_internal = updated_def
            .internal_graph
            .nodes
            .iter()
            .find(|node| node.id == to_node)
            .ok_or_else(|| CascadeError::Other(format!("Internal node not found: {to_node}")))?;

        updated_def
            .internal_graph
            .connections
            .retain(|conn| !(conn.to_node == to_node && conn.to_port == to_port));

        updated_def
            .internal_graph
            .connections
            .push(InternalConnection {
                from_node: from_node.to_string(),
                from_port: from_port.to_string(),
                to_node: to_node.to_string(),
                to_port: to_port.to_string(),
            });

        let interface = GroupNode::derive_interface(&updated_def, &self.registry)
            .map_err(CascadeError::Other)?;

        let from_port_spec = if from_node == group_input_id {
            interface
                .inputs
                .iter()
                .find(|port| port.name == from_port)
                .ok_or_else(|| CascadeError::PortNotFound {
                    node_type: from_internal.type_id.clone(),
                    port_name: from_port.to_string(),
                })?
        } else {
            let from_spec = self
                .registry
                .get_spec(&from_internal.type_id)
                .ok_or_else(|| {
                    CascadeError::InvalidConnection(format!(
                        "Unknown node type: {}",
                        from_internal.type_id
                    ))
                })?;
            from_spec
                .outputs
                .iter()
                .find(|port| port.name == from_port)
                .ok_or_else(|| CascadeError::PortNotFound {
                    node_type: from_internal.type_id.clone(),
                    port_name: from_port.to_string(),
                })?
        };

        let to_port_spec = if to_node == group_output_id {
            interface
                .outputs
                .iter()
                .find(|port| port.name == to_port)
                .cloned()
                .ok_or_else(|| CascadeError::PortNotFound {
                    node_type: to_internal.type_id.clone(),
                    port_name: to_port.to_string(),
                })?
        } else {
            let to_spec = self
                .registry
                .get_spec(&to_internal.type_id)
                .ok_or_else(|| {
                    CascadeError::InvalidConnection(format!(
                        "Unknown node type: {}",
                        to_internal.type_id
                    ))
                })?;
            to_spec
                .all_inputs()
                .into_iter()
                .find(|port| port.name == to_port)
                .ok_or_else(|| CascadeError::PortNotFound {
                    node_type: to_internal.type_id.clone(),
                    port_name: to_port.to_string(),
                })?
        };

        if !cascade_core::graph::types_compatible(&from_port_spec.ty, &to_port_spec.ty) {
            return Err(CascadeError::TypeMismatch {
                expected: format!("{:?}", to_port_spec.ty),
                got: format!("{:?}", from_port_spec.ty),
            });
        }

        let spec = self
            .register_group(updated_def)
            .map_err(CascadeError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;

        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, node)| node.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
        }

        Ok(spec)
    }

    pub fn remove_internal_connection(
        &mut self,
        group_def_id: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<NodeSpec, CascadeError> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();

        updated_def
            .internal_graph
            .connections
            .retain(|conn| !(conn.to_node == to_node && conn.to_port == to_port));

        let spec = self
            .register_group(updated_def)
            .map_err(CascadeError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;

        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, node)| node.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
        }

        Ok(spec)
    }

    fn default_params_for_type(&self, type_id: &str) -> HashMap<String, ParamValue> {
        self.registry
            .get_spec(type_id)
            .map(|spec| {
                spec.params
                    .iter()
                    .map(|param| (param.key.clone(), param_default_to_value(&param.default)))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn default_input_defaults_for_type(&self, type_id: &str) -> HashMap<String, ParamValue> {
        self.registry
            .get_spec(type_id)
            .map(|spec| {
                spec.inputs
                    .iter()
                    .filter_map(|port| {
                        port.default
                            .as_ref()
                            .map(|value| (port.name.clone(), param_default_to_value(value)))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn prepare_internal_type(
        &mut self,
        requested_type_id: &str,
    ) -> Result<(String, HashMap<String, ParamValue>), CascadeError> {
        if requested_type_id == "gpu_script" {
            let type_id = format!("gpu_script::{}", Uuid::new_v4());
            let mut params = HashMap::new();
            if let Some(gpu_context) = self.gpu_context.clone() {
                let manifest = gpu_script_passthrough_manifest(&type_id);
                match GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone()) {
                    Ok(_) => {
                        let manifest_for_factory = manifest.clone();
                        let gpu_ctx = gpu_context.clone();
                        Arc::make_mut(&mut self.registry).register_or_replace(
                            &type_id,
                            move || {
                                Arc::new(
                                    GpuKernelNode::from_manifest(
                                        manifest_for_factory.clone(),
                                        gpu_ctx.clone(),
                                    )
                                    .expect("GPU node factory: manifest was pre-validated"),
                                )
                            },
                        );
                        let manifest_json = serialize_gpu_script_manifest(&manifest)
                            .map_err(CascadeError::Other)?;
                        self.kernel_manifests.insert(type_id.clone(), manifest);
                        params.insert(
                            GPU_SCRIPT_MANIFEST_PARAM_KEY.to_string(),
                            ParamValue::String(manifest_json),
                        );
                    }
                    Err(_) => {
                        register_gpu_script_draft(&mut self.registry, &type_id, &manifest)
                            .map_err(CascadeError::Other)?;
                        let manifest_json = serialize_gpu_script_manifest(&manifest)
                            .map_err(CascadeError::Other)?;
                        self.kernel_manifests.insert(type_id.clone(), manifest);
                        params.insert(
                            GPU_SCRIPT_MANIFEST_PARAM_KEY.to_string(),
                            ParamValue::String(manifest_json),
                        );
                    }
                }
            } else {
                let manifest = gpu_script_passthrough_manifest(&type_id);
                register_gpu_script_draft(&mut self.registry, &type_id, &manifest)
                    .map_err(CascadeError::Other)?;
                let manifest_json =
                    serialize_gpu_script_manifest(&manifest).map_err(CascadeError::Other)?;
                self.kernel_manifests.insert(type_id.clone(), manifest);
                params.insert(
                    GPU_SCRIPT_MANIFEST_PARAM_KEY.to_string(),
                    ParamValue::String(manifest_json),
                );
            }
            return Ok((type_id, params));
        }

        if self.registry.get_spec(requested_type_id).is_none()
            && !self.group_definitions.contains_key(requested_type_id)
        {
            return Err(CascadeError::Other(format!(
                "Unknown node type: {requested_type_id}"
            )));
        }

        Ok((requested_type_id.to_string(), HashMap::new()))
    }

    fn refresh_group_instances(&mut self, group_def_id: &str) -> Result<(), CascadeError> {
        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, node)| node.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();
        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
            self.graph.mark_dirty(node_id);
        }
        Ok(())
    }

    pub fn add_internal_node(
        &mut self,
        group_def_id: &str,
        type_id: &str,
        x: f64,
        y: f64,
    ) -> Result<InternalGraphNode, CascadeError> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();
        let (actual_type_id, prepared_params) = self.prepare_internal_type(type_id)?;
        let mut params = self.default_params_for_type(&actual_type_id);
        params.extend(prepared_params);
        let input_defaults = self.default_input_defaults_for_type(&actual_type_id);
        let node_id = format!("n_{}", Uuid::new_v4().simple());

        updated_def.internal_graph.nodes.push(InternalNode {
            id: node_id.clone(),
            type_id: actual_type_id.clone(),
            params: params.clone(),
            muted: false,
            position: (x, y),
            image_data: None,
            input_defaults: input_defaults.clone(),
        });

        self.register_group(updated_def)
            .map_err(CascadeError::Other)?;
        self.refresh_group_instances(group_def_id)?;

        Ok(InternalGraphNode {
            id: node_id,
            type_id: actual_type_id,
            params,
            muted: false,
            position: (x, y),
            input_defaults,
        })
    }

    pub fn remove_internal_node(
        &mut self,
        group_def_id: &str,
        node_id: &str,
    ) -> Result<NodeSpec, CascadeError> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();
        let (group_input_id, group_output_id) = find_group_nodes(&updated_def)?;
        if node_id == group_input_id || node_id == group_output_id {
            return Err(CascadeError::Other(
                "Cannot remove group boundary nodes".to_string(),
            ));
        }
        let before = updated_def.internal_graph.nodes.len();
        updated_def
            .internal_graph
            .nodes
            .retain(|node| node.id != node_id);
        if updated_def.internal_graph.nodes.len() == before {
            return Err(CascadeError::Other(format!(
                "Internal node not found: {node_id}"
            )));
        }
        updated_def
            .internal_graph
            .connections
            .retain(|conn| conn.from_node != node_id && conn.to_node != node_id);
        let spec = self
            .register_group(updated_def)
            .map_err(CascadeError::Other)?;
        self.refresh_group_instances(group_def_id)?;
        Ok(spec)
    }

    fn update_internal_node<F>(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        update: F,
    ) -> Result<NodeSpec, CascadeError>
    where
        F: FnOnce(&mut InternalNode),
    {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CascadeError::Other("Group definition not found".to_string()))?;
        let mut updated_def = (*existing_def.as_ref()).clone();
        let node = updated_def
            .internal_graph
            .nodes
            .iter_mut()
            .find(|node| node.id == node_id)
            .ok_or_else(|| CascadeError::Other(format!("Internal node not found: {node_id}")))?;
        update(node);
        let spec = self
            .register_group(updated_def)
            .map_err(CascadeError::Other)?;
        self.refresh_group_instances(group_def_id)?;
        Ok(spec)
    }

    pub fn set_internal_param(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        key: &str,
        value: ParamValue,
    ) -> Result<NodeSpec, CascadeError> {
        self.update_internal_node(group_def_id, node_id, |node| {
            node.params.insert(key.to_string(), value);
        })
    }

    pub fn set_internal_input_default(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        port_name: &str,
        value: ParamValue,
    ) -> Result<NodeSpec, CascadeError> {
        self.update_internal_node(group_def_id, node_id, |node| {
            node.input_defaults.insert(port_name.to_string(), value);
        })
    }

    pub fn set_internal_position(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        x: f64,
        y: f64,
    ) -> Result<NodeSpec, CascadeError> {
        self.update_internal_node(group_def_id, node_id, |node| {
            node.position = (x, y);
        })
    }

    pub fn set_internal_muted(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        muted: bool,
    ) -> Result<NodeSpec, CascadeError> {
        self.update_internal_node(group_def_id, node_id, |node| {
            node.muted = muted;
        })
    }

    pub fn compile_internal_script_node(
        &mut self,
        group_def_id: &str,
        node_id: &str,
        manifest_json: &str,
    ) -> Result<NodeSpec, String> {
        let existing_def = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| "Group definition not found".to_string())?;
        let mut updated_def = (*existing_def.as_ref()).clone();
        let internal = updated_def
            .internal_graph
            .nodes
            .iter_mut()
            .find(|node| node.id == node_id)
            .ok_or_else(|| format!("Internal node not found: {node_id}"))?;
        if !internal.type_id.starts_with("gpu_script") {
            return Err("Node is not a GPU Script node".to_string());
        }
        let mut manifest: KernelManifest =
            serde_json::from_str(manifest_json).map_err(|e| e.to_string())?;
        manifest.id = internal.type_id.clone();
        let manifest_json = serialize_gpu_script_manifest(&manifest)?;
        let spec = if let Some(gpu_context) = self.gpu_context.clone() {
            let compiled_node =
                GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone())?;
            let spec = compiled_node.spec();
            let manifest_for_factory = manifest.clone();
            let gpu_ctx = gpu_context.clone();
            Arc::make_mut(&mut self.registry).register_or_replace(&internal.type_id, move || {
                Arc::new(
                    GpuKernelNode::from_manifest(manifest_for_factory.clone(), gpu_ctx.clone())
                        .expect("GPU node factory: manifest was pre-validated"),
                )
            });
            spec
        } else {
            register_gpu_script_draft(&mut self.registry, &internal.type_id, &manifest)?
        };
        self.kernel_manifests
            .insert(internal.type_id.clone(), manifest);
        internal.params.insert(
            GPU_SCRIPT_MANIFEST_PARAM_KEY.to_string(),
            ParamValue::String(manifest_json),
        );
        self.register_group(updated_def)
            .map_err(|e| e.to_string())?;
        self.refresh_group_instances(group_def_id)
            .map_err(|e| e.to_string())?;
        Ok(spec)
    }

    pub fn compile_script_node(
        &mut self,
        node_id: &str,
        manifest_json: &str,
    ) -> Result<NodeSpec, String> {
        let id = self.parse_node_id(node_id).map_err(|e| e.to_string())?;

        let manifest: KernelManifest =
            serde_json::from_str(manifest_json).map_err(|e| e.to_string())?;

        let graph_node = self
            .graph
            .nodes
            .get(id)
            .ok_or_else(|| "Node not found".to_string())?;
        let type_id = graph_node.type_id.clone();

        if !type_id.starts_with("gpu_script") {
            return Err("Node is not a GPU Script node".to_string());
        }

        let mut manifest = manifest;
        manifest.id = type_id.clone();
        let manifest_json = serialize_gpu_script_manifest(&manifest)?;

        let spec = if let Some(gpu_context) = self.gpu_context.clone() {
            let compiled_node =
                GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone())?;
            let spec = compiled_node.spec();
            let manifest_for_factory = manifest.clone();
            let gpu_ctx = gpu_context.clone();
            Arc::make_mut(&mut self.registry).register_or_replace(&type_id, move || {
                // SAFETY: manifest was validated by from_manifest() above.
                // NodeRegistry::register_or_replace requires infallible Fn() -> Arc<dyn Node>.
                Arc::new(
                    GpuKernelNode::from_manifest(manifest_for_factory.clone(), gpu_ctx.clone())
                        .expect("GPU node factory: manifest was pre-validated"),
                )
            });
            self.nodes.insert(id, Arc::new(compiled_node));
            spec
        } else {
            let spec = register_gpu_script_draft(&mut self.registry, &type_id, &manifest)?;
            self.nodes
                .insert(id, Arc::new(GpuScriptDraftNode::with_spec(spec.clone())));
            spec
        };
        self.kernel_manifests
            .insert(type_id.clone(), manifest.clone());

        self.graph.prune_connections_for_node(id, &self.registry);
        self.graph.set_param(
            id,
            GPU_SCRIPT_MANIFEST_PARAM_KEY,
            ParamValue::String(manifest_json),
        );

        self.graph.mark_dirty(id);

        Ok(spec)
    }

    pub fn load_kernels_from_dir(&mut self, dir_path: &str) -> Result<Vec<NodeSpec>, String> {
        let dir = Path::new(dir_path);
        let mut specs = Vec::new();
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    eprintln!("[cascade-runtime] Failed to read kernel entry: {err}");
                    continue;
                }
            };
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let manifest_json = match fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(err) => {
                    eprintln!(
                        "[cascade-runtime] Failed to read kernel file {}: {err}",
                        path.display()
                    );
                    continue;
                }
            };
            match self.register_gpu_kernel(&manifest_json) {
                Ok(spec) => specs.push(spec),
                Err(err) => {
                    eprintln!(
                        "[cascade-runtime] Failed to register kernel {}: {err}",
                        path.display()
                    );
                }
            }
        }
        Ok(specs)
    }

    pub fn list_node_types(&self) -> Vec<NodeSpec> {
        self.registry
            .list_specs()
            .into_iter()
            .filter(|spec| !spec.id.starts_with("gpu_script::"))
            .map(|spec| {
                let mut spec = spec.clone();
                spec.inputs = spec.all_inputs();
                spec
            })
            .collect()
    }

    pub fn get_node_spec(&self, node_id: &str) -> Result<NodeSpec, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self.nodes.get(&id).ok_or(CascadeError::NodeNotFound(id))?;
        Ok(node.spec())
    }

    pub fn gpu_context(&self) -> Option<Arc<GpuContext>> {
        self.gpu_context.clone()
    }

    pub fn register_uuid_for_node(&mut self, node_id: NodeId) -> String {
        let uuid = self
            .graph
            .nodes
            .get(node_id)
            .map(|node| node.uuid.clone())
            .unwrap_or_default();
        if !uuid.is_empty() {
            self.uuid_map.insert(uuid.clone(), node_id);
        }
        uuid
    }

    pub fn parse_node_id(&self, id: &str) -> Result<NodeId, CascadeError> {
        parse_node_id_from_map(&self.uuid_map, id)
    }

    pub fn remove_node_internal(&mut self, node_id: NodeId) {
        if let Some(instance) = self.graph.nodes.get(node_id) {
            self.uuid_map.remove(&instance.uuid);
        }
        self.graph.remove_node(node_id);
        self.nodes.remove(&node_id);
    }

    /// Returns `(node_uuid, actual_type_id)`. For most nodes, `actual_type_id` equals the
    /// requested `type_id`. For `gpu_script` nodes, it's the generated unique ID like
    /// `gpu_script::<uuid>`.
    pub fn add_node(
        &mut self,
        type_id: &str,
        x: f64,
        y: f64,
    ) -> Result<(String, String), CascadeError> {
        if let Some(def) = self.group_definitions.get(type_id) {
            let node_id = self.graph.add_node(type_id);
            self.graph.set_position(node_id, x, y);
            let group_node = GroupNode::from_definition(def.clone(), &self.registry)
                .map_err(CascadeError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            let uuid = self.register_uuid_for_node(node_id);
            return Ok((uuid, type_id.to_string()));
        }

        let (actual_type_id, prepared_node, manifest_to_store) = if type_id == "gpu_script" {
            let uuid = format!("gpu_script::{}", Uuid::new_v4());
            if let Some(gpu_context) = self.gpu_context.clone() {
                let manifest = gpu_script_passthrough_manifest(&uuid);
                match GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone()) {
                    Ok(compiled_node) => {
                        let manifest_for_factory = manifest.clone();
                        let gpu_ctx = gpu_context.clone();
                        Arc::make_mut(&mut self.registry).register_or_replace(&uuid, move || {
                            Arc::new(
                                GpuKernelNode::from_manifest(
                                    manifest_for_factory.clone(),
                                    gpu_ctx.clone(),
                                )
                                .expect("GPU node factory: manifest was pre-validated"),
                            )
                        });
                        (
                            uuid,
                            Some(Arc::new(compiled_node) as Arc<dyn Node>),
                            Some(manifest),
                        )
                    }
                    Err(_) => {
                        register_gpu_script_draft(&mut self.registry, &uuid, &manifest)
                            .map_err(CascadeError::Other)?;
                        (
                            uuid,
                            Some(Arc::new(GpuScriptDraftNode::with_spec(
                                manifest.to_node_spec().map_err(CascadeError::Other)?,
                            )) as Arc<dyn Node>),
                            Some(manifest),
                        )
                    }
                }
            } else {
                let manifest = gpu_script_passthrough_manifest(&uuid);
                let spec = register_gpu_script_draft(&mut self.registry, &uuid, &manifest)
                    .map_err(CascadeError::Other)?;
                (
                    uuid,
                    Some(Arc::new(GpuScriptDraftNode::with_spec(spec)) as Arc<dyn Node>),
                    Some(manifest),
                )
            }
        } else {
            (type_id.to_string(), None, None)
        };

        let node_id = self.graph.add_node(&actual_type_id);
        self.graph.set_position(node_id, x, y);
        let node = if let Some(node) = prepared_node {
            node
        } else {
            self.registry.create(&actual_type_id).ok_or_else(|| {
                CascadeError::Other(format!("Unknown node type: {actual_type_id}"))
            })?
        };
        self.nodes.insert(node_id, node);
        if let Some(manifest) = manifest_to_store {
            let manifest_json =
                serialize_gpu_script_manifest(&manifest).map_err(CascadeError::Other)?;
            self.kernel_manifests
                .insert(actual_type_id.clone(), manifest.clone());
            self.graph.set_param(
                node_id,
                GPU_SCRIPT_MANIFEST_PARAM_KEY,
                ParamValue::String(manifest_json),
            );
        }
        let uuid = self.register_uuid_for_node(node_id);
        Ok((uuid, actual_type_id))
    }

    pub fn remove_node(&mut self, node_id: &str) -> Result<(), CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.remove_node_internal(id);
        Ok(())
    }

    pub fn connect(
        &mut self,
        from_node: &str,
        from_port: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<(), CascadeError> {
        let from_id = self.parse_node_id(from_node)?;
        let to_id = self.parse_node_id(to_node)?;
        self.graph
            .connect(&self.registry, from_id, from_port, to_id, to_port)
    }

    pub fn disconnect(&mut self, to_node: &str, to_port: &str) -> Result<(), CascadeError> {
        let id = self.parse_node_id(to_node)?;
        self.graph.disconnect(id, to_port);
        Ok(())
    }

    pub fn set_param(
        &mut self,
        node_id: &str,
        key: &str,
        value: ParamValue,
    ) -> Result<(), CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_param(id, key, value);
        Ok(())
    }

    pub fn set_input_default(
        &mut self,
        node_id: &str,
        port_name: &str,
        value: ParamValue,
    ) -> Result<(), CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_input_default(id, port_name, value);
        Ok(())
    }

    pub fn set_position(&mut self, node_id: &str, x: f64, y: f64) -> Result<(), CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_position(id, x, y);
        Ok(())
    }

    pub fn set_muted(&mut self, node_id: &str, muted: bool) -> Result<(), CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_muted(id, muted);
        Ok(())
    }

    pub fn load_image_data(
        &mut self,
        node_id: &str,
        data: &[u8],
    ) -> Result<NodeInterfaceChange, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let load_node = node
            .as_any()
            .downcast_ref::<InputLoadImage>()
            .ok_or_else(|| CascadeError::Other("Node is not LoadImage".to_string()))?;
        let removed = load_node.set_image_data(data)?;
        self.graph.mark_dirty(id);

        // Get the updated spec (includes dynamic ports)
        let new_spec = node.spec();

        // Prune connections that reference removed ports
        let spec_provider = InstanceAwareSpecProvider {
            registry: &self.registry,
            instances: &self.nodes,
        };
        let pruned = self.graph.prune_connections_for_node(id, &spec_provider);
        let pruned_connections = pruned
            .into_iter()
            .map(|pc| PrunedConnection {
                from_node: format_node_id(&self.graph, pc.from_node),
                from_port: pc.from_port,
                to_node: format_node_id(&self.graph, pc.to_node),
                to_port: pc.to_port,
            })
            .collect();

        Ok(NodeInterfaceChange {
            new_spec,
            removed_output_ports: removed,
            pruned_connections,
        })
    }

    pub fn get_image_data(&self, node_id: &str) -> Result<Vec<u8>, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let load_node = node
            .as_any()
            .downcast_ref::<InputLoadImage>()
            .ok_or_else(|| CascadeError::Other("Node is not LoadImage".to_string()))?;
        cascade_nodes_std::input::LoadImage::get_image_bytes(load_node)
            .ok_or_else(|| CascadeError::Other("No image data available".to_string()))
    }

    pub fn load_palette_data(
        &mut self,
        node_id: &str,
        data: &[u8],
    ) -> Result<Vec<[f64; 4]>, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let palette_node = node
            .as_any()
            .downcast_ref::<ColorPaletteNode>()
            .ok_or_else(|| CascadeError::Other("Node is not ColorPaletteNode".to_string()))?;
        let colors = palette_node.load_palette_data(data)?;
        self.graph
            .set_param(id, "colors", ParamValue::ColorPalette(colors.clone()));
        self.graph.mark_dirty(id);
        Ok(colors)
    }

    pub fn set_sequence_directory(
        &mut self,
        node_id: &str,
        directory: &str,
    ) -> Result<SequenceInfo, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let seq_node = node
            .as_any()
            .downcast_ref::<LoadImageSequence>()
            .ok_or_else(|| CascadeError::Other("Node is not LoadImageSequence".to_string()))?;
        let info = seq_node.set_directory(directory)?;
        self.graph.mark_dirty(id);
        Ok(info)
    }

    pub fn get_sequence_info(
        &self,
        node_id: &str,
        pattern: &str,
    ) -> Result<SequenceInfo, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let seq_node = node
            .as_any()
            .downcast_ref::<LoadImageSequence>()
            .ok_or_else(|| CascadeError::Other("Node is not LoadImageSequence".to_string()))?;
        seq_node.get_sequence_info(pattern)
    }

    #[cfg(all(feature = "video", target_os = "macos"))]
    pub fn load_video_file(
        &mut self,
        node_id: &str,
        path: &str,
    ) -> Result<cascade_video::VideoInfo, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let video_node = node
            .as_any()
            .downcast_ref::<LoadVideo>()
            .ok_or_else(|| CascadeError::Other("Node is not LoadVideo".to_string()))?;

        let decoder =
            Arc::new(cascade_video::VideoDecoder::new(path).map_err(CascadeError::Other)?);
        let info = decoder.info().clone();

        let lut = srgb_to_linear_lut();
        let decoder_ref = Arc::clone(&decoder);
        let frame_loader: Box<dyn Fn(u64) -> Result<Image, CascadeError> + Send> =
            Box::new(move |frame_index: u64| {
                let frame = decoder_ref
                    .decode_frame_linear(frame_index, lut)
                    .map_err(CascadeError::Other)?
                    .ok_or_else(|| {
                        CascadeError::Other(format!("No frame at index {frame_index}"))
                    })?;

                Image::from_f32_data(frame.width, frame.height, frame.data)
            });

        video_node.set_frame_loader(frame_loader)?;

        self.graph.mark_dirty(id);
        Ok(info)
    }

    fn normalize_preview_scale(preview_scale: f32) -> f32 {
        if !preview_scale.is_finite() || preview_scale <= 0.0 || preview_scale > 1.0 {
            1.0
        } else {
            preview_scale
        }
    }

    fn evaluate_viewer_scaled(
        &mut self,
        viewer_id: NodeId,
        frame: u64,
        preview_scale: f32,
    ) -> Result<cascade_core::eval::EvalResult, CascadeError> {
        let cm = self.color_management.as_ref();
        pollster::block_on(self.evaluator.evaluate(
            &mut self.graph,
            &self.registry,
            &self.nodes,
            viewer_id,
            "display",
            FrameTime { frame },
            cm,
            self.ai_provider.as_deref(),
            &self.project_format,
            &HashMap::new(),
            Self::normalize_preview_scale(preview_scale),
        ))
    }

    fn image_to_render_result(&self, image: &Image) -> RenderResult {
        let pixels = Viewer::image_to_rgba8_with_display(
            image,
            self.color_management.as_ref(),
            &self.active_display,
            &self.active_view,
        );
        RenderResult {
            width: image.width,
            height: image.height,
            pixels,
        }
    }

    fn render_viewers_scaled(
        &mut self,
        viewer_ids: Vec<NodeId>,
        frame: u64,
        preview_scale: f32,
    ) -> Vec<(String, RenderResult)> {
        let mut results = Vec::new();
        let mut merged_timings = HashMap::new();

        for viewer_id in viewer_ids {
            let viewer_id_str = format_node_id(&self.graph, viewer_id);
            if let Ok(eval_result) = self.evaluate_viewer_scaled(viewer_id, frame, preview_scale) {
                for (node_id, duration) in eval_result.node_timings {
                    merged_timings.insert(
                        format_node_id(&self.graph, node_id),
                        duration.as_secs_f64() * 1000.0,
                    );
                }
                if let Value::Image(image) = eval_result.value {
                    results.push((viewer_id_str, self.image_to_render_result(&image)));
                }
            }
        }

        self.last_timings = merged_timings;
        results
    }

    pub fn render_viewer(
        &mut self,
        viewer_node_id: &str,
        frame: u64,
    ) -> Result<RenderResult, CascadeError> {
        self.render_viewer_scaled(viewer_node_id, frame, 1.0)
    }

    pub fn render_viewer_scaled(
        &mut self,
        viewer_node_id: &str,
        frame: u64,
        preview_scale: f32,
    ) -> Result<RenderResult, CascadeError> {
        let id = self.parse_node_id(viewer_node_id)?;
        let eval_result = self.evaluate_viewer_scaled(id, frame, preview_scale)?;
        self.last_timings = eval_result
            .node_timings
            .into_iter()
            .map(|(node_id, duration)| {
                (
                    format_node_id(&self.graph, node_id),
                    duration.as_secs_f64() * 1000.0,
                )
            })
            .collect();
        match eval_result.value {
            Value::Image(image) => Ok(self.image_to_render_result(&image)),
            _ => Err(CascadeError::Other(
                "Viewer output is not an image".to_string(),
            )),
        }
    }

    pub fn render_internal_viewer(
        &mut self,
        group_node_id: &str,
        internal_viewer_id: &str,
        frame: u64,
    ) -> Result<RenderResult, CascadeError> {
        self.render_internal_viewer_scaled(group_node_id, internal_viewer_id, frame, 1.0)
    }

    pub fn render_internal_viewer_scaled(
        &mut self,
        group_node_id: &str,
        internal_viewer_id: &str,
        frame: u64,
        preview_scale: f32,
    ) -> Result<RenderResult, CascadeError> {
        let group_id = self.parse_node_id(group_node_id)?;
        let group_instance = self
            .graph
            .nodes
            .get(group_id)
            .cloned()
            .ok_or(CascadeError::NodeNotFound(group_id))?;
        let group_node_arc = self
            .nodes
            .get(&group_id)
            .cloned()
            .ok_or_else(|| CascadeError::Other("Group node instance not found".to_string()))?;
        let group_node = group_node_arc
            .as_any()
            .downcast_ref::<GroupNode>()
            .ok_or_else(|| CascadeError::Other("Node is not a group".to_string()))?;
        let group_spec = self
            .registry
            .get_spec(&group_instance.type_id)
            .cloned()
            .ok_or_else(|| {
                CascadeError::InvalidConnection(format!(
                    "Unknown node type: {}",
                    group_instance.type_id
                ))
            })?;

        let frame_time = FrameTime { frame };
        let mut inputs = HashMap::new();
        for input in group_spec.all_inputs() {
            if let Some((up_node, up_port)) = self.graph.get_upstream(group_id, &input.name) {
                let eval_result = pollster::block_on(self.evaluator.evaluate(
                    &mut self.graph,
                    &self.registry,
                    &self.nodes,
                    up_node,
                    &up_port,
                    frame_time,
                    self.color_management.as_ref(),
                    self.ai_provider.as_deref(),
                    &self.project_format,
                    &HashMap::new(),
                    preview_scale,
                ))?;
                inputs.insert(input.name.clone(), eval_result.value);
            } else if let Some(value) = group_instance.input_defaults.get(&input.name) {
                inputs.insert(input.name.clone(), param_value_to_runtime_value(value));
            } else if let Some(default) = &input.default {
                inputs.insert(input.name.clone(), param_default_to_runtime_value(default));
            }
        }

        let mut params: HashMap<String, ParamValue> = group_spec
            .params
            .iter()
            .map(|param| (param.key.clone(), param_default_to_value(&param.default)))
            .collect();
        params.extend(group_instance.params.clone());

        let eval_result = pollster::block_on(group_node.evaluate_internal_output(
            InternalOutputEvalRequest {
                internal_node_id: internal_viewer_id,
                output_port: "display",
                inputs,
                params,
                frame_time,
                color_management: self.color_management.as_ref(),
                ai_provider: self.ai_provider.as_deref(),
                project_format: &self.project_format,
                preview_scale,
            },
        ))?;

        self.last_timings.clear();
        match eval_result.value {
            Value::Image(image) => Ok(self.image_to_render_result(&image)),
            _ => Err(CascadeError::Other(
                "Viewer output is not an image".to_string(),
            )),
        }
    }

    pub fn evaluate_node(
        &mut self,
        node_id: &str,
        frame: u64,
    ) -> Result<cascade_core::eval::EvalResult, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        let cm = self.color_management.as_ref();
        pollster::block_on(self.evaluator.evaluate(
            &mut self.graph,
            &self.registry,
            &self.nodes,
            id,
            "display",
            FrameTime { frame },
            cm,
            self.ai_provider.as_deref(),
            &self.project_format,
            &HashMap::new(),
            1.0,
        ))
    }

    pub fn render_export(
        &mut self,
        node_id: &str,
        frame: u64,
    ) -> Result<(String, Vec<u8>), CascadeError> {
        let id = self.parse_node_id(node_id)?;

        let instance = self
            .graph
            .nodes
            .get(id)
            .ok_or_else(|| CascadeError::Other("Node not found".to_string()))?;
        let format = match instance.params.get("format") {
            Some(ParamValue::Int(v)) => *v,
            _ => 0,
        };

        let cm = self.color_management.as_ref();
        let eval_result = pollster::block_on(self.evaluator.evaluate(
            &mut self.graph,
            &self.registry,
            &self.nodes,
            id,
            "display",
            FrameTime { frame },
            cm,
            self.ai_provider.as_deref(),
            &self.project_format,
            &HashMap::new(),
            1.0,
        ))?;
        match eval_result.value {
            Value::Image(image) => {
                let rgba8 = Viewer::image_to_rgba8_with_display(
                    &image,
                    cm,
                    &self.active_display,
                    &self.active_view,
                );
                let mut buf = Vec::new();
                let extension;

                if format == 1 {
                    extension = "jpg".to_string();
                    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
                        .ok_or_else(|| {
                            CascadeError::Other("Failed to create image buffer".to_string())
                        })?;
                    let rgb_img = image::DynamicImage::ImageRgba8(img).into_rgb8();
                    let mut cursor = std::io::Cursor::new(&mut buf);
                    rgb_img
                        .write_to(&mut cursor, image::ImageFormat::Jpeg)
                        .map_err(|e| CascadeError::Other(format!("JPEG encode failed: {e}")))?;
                } else {
                    extension = "png".to_string();
                    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
                        .ok_or_else(|| {
                            CascadeError::Other("Failed to create image buffer".to_string())
                        })?;
                    let mut cursor = std::io::Cursor::new(&mut buf);
                    img.write_to(&mut cursor, image::ImageFormat::Png)
                        .map_err(|e| CascadeError::Other(format!("PNG encode failed: {e}")))?;
                }

                Ok((extension, buf))
            }
            _ => Err(CascadeError::Other(
                "Export node output is not an image".to_string(),
            )),
        }
    }

    pub fn set_param_and_render_viewers(
        &mut self,
        node_id: &str,
        key: &str,
        value: ParamValue,
        frame: u64,
    ) -> Result<Vec<(String, RenderResult)>, CascadeError> {
        self.set_param_and_render_viewers_scaled(node_id, key, value, frame, 1.0)
    }

    pub fn set_param_and_render_viewers_scaled(
        &mut self,
        node_id: &str,
        key: &str,
        value: ParamValue,
        frame: u64,
        preview_scale: f32,
    ) -> Result<Vec<(String, RenderResult)>, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_param(id, key, value);
        let viewer_ids = self.graph.get_affected_viewers(id);
        Ok(self.render_viewers_scaled(viewer_ids, frame, preview_scale))
    }

    pub fn set_input_default_and_render_viewers(
        &mut self,
        node_id: &str,
        port_name: &str,
        value: ParamValue,
        frame: u64,
    ) -> Result<Vec<(String, RenderResult)>, CascadeError> {
        self.set_input_default_and_render_viewers_scaled(node_id, port_name, value, frame, 1.0)
    }

    pub fn set_input_default_and_render_viewers_scaled(
        &mut self,
        node_id: &str,
        port_name: &str,
        value: ParamValue,
        frame: u64,
        preview_scale: f32,
    ) -> Result<Vec<(String, RenderResult)>, CascadeError> {
        let id = self.parse_node_id(node_id)?;
        self.graph.set_input_default(id, port_name, value);
        let viewer_ids = self.graph.get_affected_viewers(id);
        Ok(self.render_viewers_scaled(viewer_ids, frame, preview_scale))
    }

    pub fn get_last_render_timings(&self) -> &HashMap<String, f64> {
        &self.last_timings
    }

    pub fn start_render_sequence(&mut self, node_id: &str) -> Result<String, CascadeError> {
        if self
            .active_job
            .as_ref()
            .is_some_and(|j| !j.completed.load(Ordering::Acquire))
        {
            return Err(CascadeError::Other(
                "A render job is already running".to_string(),
            ));
        }

        let export_id = self.parse_node_id(node_id)?;
        let instance = self
            .graph
            .nodes
            .get(export_id)
            .ok_or_else(|| CascadeError::Other("Export node not found".to_string()))?;

        let output_dir = match instance.params.get("output_dir") {
            Some(ParamValue::String(s)) => s.clone(),
            _ => return Err(CascadeError::Other("Output directory not set".to_string())),
        };

        // Validate output directory exists and is writable before spawning
        let output_path = std::path::Path::new(&output_dir);
        if !output_path.is_dir() {
            return Err(CascadeError::Other(format!(
                "Output directory does not exist: {output_dir}"
            )));
        }

        let start = match instance.params.get("start_frame") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 0,
        };
        let end = match instance.params.get("end_frame") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 100,
        };
        let step = match instance.params.get("step") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 1,
        };
        let range = FrameRange { start, end, step };

        let format = match instance.params.get("format") {
            Some(ParamValue::Int(v)) => *v,
            _ => 0,
        };

        if range.step == 0 {
            return Err(CascadeError::Other("Step must be > 0".to_string()));
        }
        let total_frames = (range.end - range.start) / range.step + 1;

        let job_id = format!("job_{}", uuid::Uuid::new_v4());
        let job = Arc::new(RenderJob {
            id: job_id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            current_frame: Arc::new(AtomicU64::new(0)),
            total_frames,
            completed: Arc::new(AtomicBool::new(false)),
            error: Arc::new(std::sync::Mutex::new(None)),
        });
        self.active_job = Some(job.clone());

        // Snapshot the graph state for the background thread
        let mut render_graph = self.graph.clone();
        let render_nodes = self.nodes.clone();
        let render_registry = Arc::clone(&self.registry);
        let mut render_evaluator = Evaluator::new();

        let ext = if format == 1 { "jpg" } else { "png" }.to_string();
        let padding = std::cmp::max(4, (range.end as f64).log10().ceil() as usize + 1);
        let render_cm = Box::new(BuiltinColorManagement::new());
        let ai_provider = self.ai_provider.clone();
        let render_project_format = self.project_format.clone();

        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let cm = render_cm.as_ref();
                let mut frame = range.start;
                while frame <= range.end {
                    if job.cancelled.load(Ordering::Relaxed) {
                        break;
                    }

                    job.current_frame.store(frame, Ordering::Relaxed);

                    match pollster::block_on(render_evaluator.evaluate(
                        &mut render_graph,
                        &render_registry,
                        &render_nodes,
                        export_id,
                        "display",
                        FrameTime { frame },
                        cm,
                        ai_provider.as_deref(),
                        &render_project_format,
                        &HashMap::new(),
                        1.0,
                    )) {
                        Ok(eval_result) => {
                            if let Value::Image(image) = eval_result.value {
                                let rgba8 = Viewer::image_to_rgba8(&image, cm);
                                let filename = format!("{frame:0>padding$}.{ext}");
                                let path = std::path::Path::new(&output_dir).join(&filename);

                                let encode_result = if format == 1 {
                                    let img = image::RgbaImage::from_raw(
                                        image.width,
                                        image.height,
                                        rgba8,
                                    )
                                    .ok_or_else(|| "Failed to create image buffer".to_string());
                                    match img {
                                        Ok(img) => {
                                            let rgb_img =
                                                image::DynamicImage::ImageRgba8(img).into_rgb8();
                                            rgb_img.save(&path).map_err(|e| e.to_string())
                                        }
                                        Err(e) => Err(e),
                                    }
                                } else {
                                    let img = image::RgbaImage::from_raw(
                                        image.width,
                                        image.height,
                                        rgba8,
                                    )
                                    .ok_or_else(|| "Failed to create image buffer".to_string());
                                    match img {
                                        Ok(img) => img.save(&path).map_err(|e| e.to_string()),
                                        Err(e) => Err(e),
                                    }
                                };

                                if let Err(e) = encode_result {
                                    let mut err_guard =
                                        job.error.lock().unwrap_or_else(|e| e.into_inner());
                                    *err_guard =
                                        Some(format!("Frame {frame} encode/write failed: {e}"));
                                    return;
                                }
                            } else {
                                let mut err_guard =
                                    job.error.lock().unwrap_or_else(|e| e.into_inner());
                                *err_guard = Some(format!("Frame {frame} output is not an image"));
                                return;
                            }
                        }
                        Err(e) => {
                            let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                            *err_guard = Some(format!("Frame {frame} evaluation failed: {e}"));
                            return;
                        }
                    }

                    frame += range.step;
                }
            }));

            // Handle panics — convert to error message
            if let Err(panic_info) = result {
                let msg = if let Some(s) = panic_info.downcast_ref::<String>() {
                    format!("Render thread panicked: {s}")
                } else if let Some(s) = panic_info.downcast_ref::<&str>() {
                    format!("Render thread panicked: {s}")
                } else {
                    "Render thread panicked with unknown error".to_string()
                };
                let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                *err_guard = Some(msg);
            }

            // Signal completion with Release ordering so error is visible first
            job.completed.store(true, Ordering::Release);
        });

        Ok(job_id)
    }

    #[cfg(all(feature = "video", target_os = "macos"))]
    pub fn start_render_video(&mut self, node_id: &str) -> Result<String, CascadeError> {
        if self
            .active_job
            .as_ref()
            .is_some_and(|j| !j.completed.load(Ordering::Acquire))
        {
            return Err(CascadeError::Other(
                "A render job is already running".to_string(),
            ));
        }

        let export_id = self.parse_node_id(node_id)?;
        let instance = self
            .graph
            .nodes
            .get(export_id)
            .ok_or_else(|| CascadeError::Other("Export node not found".to_string()))?;

        let output_path = match instance.params.get("output_path") {
            Some(ParamValue::String(s)) => s.clone(),
            _ => return Err(CascadeError::Other("Output path not set".to_string())),
        };

        let start = match instance.params.get("start_frame") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 0,
        };
        let end = match instance.params.get("end_frame") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 100,
        };
        let step = match instance.params.get("step") {
            Some(ParamValue::Int(v)) => *v as u64,
            _ => 1,
        };
        let range = FrameRange { start, end, step };

        let codec_idx = match instance.params.get("codec") {
            Some(ParamValue::Int(v)) => *v,
            _ => 0,
        };
        let crf = match instance.params.get("quality") {
            Some(ParamValue::Int(v)) => *v as u32,
            _ => 23,
        };
        let fps = match instance.params.get("fps") {
            Some(ParamValue::Int(v)) => *v as u32,
            _ => 24,
        };

        if range.step == 0 {
            return Err(CascadeError::Other("Step must be > 0".to_string()));
        }
        let total_frames = (range.end - range.start) / range.step + 1;

        let job_id = format!("job_{}", uuid::Uuid::new_v4());
        let job = Arc::new(RenderJob {
            id: job_id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            current_frame: Arc::new(AtomicU64::new(0)),
            total_frames,
            completed: Arc::new(AtomicBool::new(false)),
            error: Arc::new(std::sync::Mutex::new(None)),
        });
        self.active_job = Some(job.clone());

        let mut render_graph = self.graph.clone();
        let render_nodes = self.nodes.clone();
        let render_registry = Arc::clone(&self.registry);
        let mut render_evaluator = Evaluator::new();
        let render_cm = Box::new(BuiltinColorManagement::new());
        let ai_provider = self.ai_provider.clone();
        let render_project_format = self.project_format.clone();

        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let cm = render_cm.as_ref();

                let first_frame_result = pollster::block_on(render_evaluator.evaluate(
                    &mut render_graph,
                    &render_registry,
                    &render_nodes,
                    export_id,
                    "display",
                    FrameTime { frame: range.start },
                    cm,
                    ai_provider.as_deref(),
                    &render_project_format,
                    &HashMap::new(),
                    1.0,
                ));

                let (width, height) = match &first_frame_result {
                    Ok(eval_result) => match &eval_result.value {
                        Value::Image(image) => (image.width, image.height),
                        _ => {
                            let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                            *err_guard = Some("First frame output is not an image".to_string());
                            return;
                        }
                    },
                    Err(e) => {
                        let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                        *err_guard = Some(format!("First frame evaluation failed: {e}"));
                        return;
                    }
                };

                let codec = cascade_video::VideoCodec::from_index(codec_idx);
                let config = cascade_video::VideoEncoderConfig {
                    width,
                    height,
                    fps,
                    codec,
                    crf,
                };

                let mut encoder = match cascade_video::VideoEncoder::new(&output_path, config) {
                    Ok(enc) => enc,
                    Err(e) => {
                        let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                        *err_guard = Some(format!("Failed to create video encoder: {e}"));
                        return;
                    }
                };

                if let Ok(eval_result) = first_frame_result {
                    if let Value::Image(image) = eval_result.value {
                        let rgba8 = Viewer::image_to_rgba8(&image, cm);
                        job.current_frame.store(range.start, Ordering::Relaxed);
                        if let Err(e) = encoder.encode_frame(&rgba8) {
                            let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                            *err_guard = Some(format!("Frame {} encode failed: {e}", range.start));
                            return;
                        }
                    }
                }

                let mut frame = range.start + range.step;
                while frame <= range.end {
                    if job.cancelled.load(Ordering::Relaxed) {
                        break;
                    }

                    job.current_frame.store(frame, Ordering::Relaxed);

                    match pollster::block_on(render_evaluator.evaluate(
                        &mut render_graph,
                        &render_registry,
                        &render_nodes,
                        export_id,
                        "display",
                        FrameTime { frame },
                        cm,
                        ai_provider.as_deref(),
                        &render_project_format,
                        &HashMap::new(),
                        1.0,
                    )) {
                        Ok(eval_result) => {
                            if let Value::Image(image) = eval_result.value {
                                let rgba8 = Viewer::image_to_rgba8(&image, cm);
                                if let Err(e) = encoder.encode_frame(&rgba8) {
                                    let mut err_guard =
                                        job.error.lock().unwrap_or_else(|e| e.into_inner());
                                    *err_guard =
                                        Some(format!("Frame {} encode failed: {e}", frame));
                                    return;
                                }
                            } else {
                                let mut err_guard =
                                    job.error.lock().unwrap_or_else(|e| e.into_inner());
                                *err_guard =
                                    Some(format!("Frame {} output is not an image", frame));
                                return;
                            }
                        }
                        Err(e) => {
                            let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                            *err_guard = Some(format!("Frame {} evaluation failed: {}", frame, e));
                            return;
                        }
                    }

                    frame += range.step;
                }

                if !job.cancelled.load(Ordering::Relaxed) {
                    if let Err(e) = encoder.finish() {
                        let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                        *err_guard = Some(format!("Failed to finalize video: {e}"));
                    }
                }
            }));

            if let Err(panic_info) = result {
                let msg = if let Some(s) = panic_info.downcast_ref::<String>() {
                    format!("Render thread panicked: {}", s)
                } else if let Some(s) = panic_info.downcast_ref::<&str>() {
                    format!("Render thread panicked: {}", s)
                } else {
                    "Render thread panicked with unknown error".to_string()
                };
                let mut err_guard = job.error.lock().unwrap_or_else(|e| e.into_inner());
                *err_guard = Some(msg);
            }

            job.completed.store(true, Ordering::Release);
        });

        Ok(job_id)
    }

    pub fn cancel_job(&self) {
        if let Some(ref job) = self.active_job {
            job.cancelled.store(true, Ordering::Relaxed);
        }
    }

    pub fn get_job_progress(&self) -> Option<JobProgress> {
        self.active_job.as_ref().map(|job| {
            let completed = job.completed.load(Ordering::Acquire);
            let error = job.error.lock().ok().and_then(|guard| guard.clone());
            JobProgress {
                job_id: job.id.clone(),
                current_frame: job.current_frame.load(Ordering::Relaxed),
                total_frames: job.total_frames,
                completed,
                error,
            }
        })
    }

    pub fn export_graph(&self) -> SerializableGraph {
        let nodes = self
            .graph
            .nodes
            .values()
            .map(|node| SerializableNode {
                id: format_node_id(&self.graph, node.id),
                type_id: node.type_id.clone(),
                params: node.params.clone(),
                input_defaults: node.input_defaults.clone(),
                position: node.position,
                muted: node.muted,
            })
            .collect();
        let connections = self
            .graph
            .connections()
            .map(|c| SerializableConnection {
                from_node: format_node_id(&self.graph, c.from_node),
                from_port: c.from_port.clone(),
                to_node: format_node_id(&self.graph, c.to_node),
                to_port: c.to_port.clone(),
            })
            .collect();
        let group_definitions = self
            .group_definitions
            .values()
            .filter(|def| !def.is_builtin)
            .map(|def| def.as_ref().clone())
            .collect();
        SerializableGraph {
            nodes,
            connections,
            group_definitions,
        }
    }

    pub fn export_document(&self) -> CascadeDocument {
        let graph = self.export_graph();

        let mut used_type_ids: HashSet<&str> =
            graph.nodes.iter().map(|n| n.type_id.as_str()).collect();
        for group_def in &graph.group_definitions {
            for node in &group_def.internal_graph.nodes {
                used_type_ids.insert(node.type_id.as_str());
            }
        }
        let mut scripts = HashMap::new();
        for (type_id, manifest) in &self.kernel_manifests {
            if used_type_ids.contains(type_id.as_str()) {
                scripts.insert(
                    type_id.clone(),
                    ScriptEntry {
                        manifest: manifest.clone(),
                    },
                );
            }
        }

        CascadeDocument {
            cascade: DocumentHeader {
                format_version: CURRENT_FORMAT_VERSION.to_string(),
                app_version: String::new(),
                created_at: String::new(),
                modified_at: String::new(),
            },
            project: ProjectMetadata {
                name: String::new(),
                author: String::new(),
                description: String::new(),
            },
            graph,
            assets: HashMap::new(),
            scripts,
            view: None,
            dsl: None,
        }
    }

    pub fn import_document(&mut self, document: CascadeDocument) -> Result<(), CascadeError> {
        // Pre-register kernels from the document's scripts section so that nodes whose
        // params pre-date the __script_manifest storage format can still load. Compilation
        // errors for individual scripts are silently skipped here — import_graph has its own
        // graceful draft-node fallback that covers those cases without failing the load.
        for entry in document.scripts.values() {
            if let Ok(manifest_json) = serde_json::to_string(&entry.manifest) {
                let _ = self.register_gpu_kernel(&manifest_json);
            }
        }
        self.import_graph(document.graph)
    }

    pub fn import_graph(&mut self, data: SerializableGraph) -> Result<(), CascadeError> {
        self.graph = Graph::new();
        self.nodes.clear();
        self.evaluator = Evaluator::new();
        self.uuid_map.clear();
        self.kernel_manifests.clear();

        let mut gpu_script_manifests: HashMap<String, Option<KernelManifest>> = HashMap::new();
        for def in &data.group_definitions {
            for node in &def.internal_graph.nodes {
                if node.type_id.starts_with("gpu_script::") {
                    gpu_script_manifests
                        .entry(node.type_id.clone())
                        .or_insert_with(|| {
                            extract_gpu_script_manifest(&node.type_id, &node.params)
                        });
                }
            }
        }
        for node in &data.nodes {
            if node.type_id.starts_with("gpu_script::") {
                gpu_script_manifests
                    .entry(node.type_id.clone())
                    .or_insert_with(|| extract_gpu_script_manifest(&node.type_id, &node.params));
            }
        }

        // For gpu_script nodes without a stored manifest (old saves), collect the port names
        // referenced in connections so we can build a permissive draft spec that lets the
        // project load without PortNotFound errors.
        let node_type_by_uuid: HashMap<String, String> = data
            .nodes
            .iter()
            .map(|n| (n.id.clone(), n.type_id.clone()))
            .collect();
        let mut draft_extra_inputs: HashMap<String, HashSet<String>> = HashMap::new();
        let mut draft_extra_outputs: HashMap<String, HashSet<String>> = HashMap::new();
        for conn in &data.connections {
            if let Some(type_id) = node_type_by_uuid.get(&conn.to_node) {
                if type_id.starts_with("gpu_script::")
                    && gpu_script_manifests
                        .get(type_id)
                        .and_then(|m| m.as_ref())
                        .is_none()
                {
                    draft_extra_inputs
                        .entry(type_id.clone())
                        .or_default()
                        .insert(conn.to_port.clone());
                }
            }
            if let Some(type_id) = node_type_by_uuid.get(&conn.from_node) {
                if type_id.starts_with("gpu_script::")
                    && gpu_script_manifests
                        .get(type_id)
                        .and_then(|m| m.as_ref())
                        .is_none()
                {
                    draft_extra_outputs
                        .entry(type_id.clone())
                        .or_default()
                        .insert(conn.from_port.clone());
                }
            }
        }

        for (type_id, manifest) in gpu_script_manifests {
            if let Some(manifest) = manifest.clone() {
                if let Some(gpu_context) = self.gpu_context.clone() {
                    if GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone()).is_ok() {
                        let manifest_for_factory = manifest.clone();
                        let gpu_ctx = gpu_context.clone();
                        Arc::make_mut(&mut self.registry).register_or_replace(
                            &type_id,
                            move || {
                                Arc::new(
                                    GpuKernelNode::from_manifest(
                                        manifest_for_factory.clone(),
                                        gpu_ctx.clone(),
                                    )
                                    .expect("GPU node factory: manifest was pre-validated"),
                                )
                            },
                        );
                        self.kernel_manifests.insert(type_id.clone(), manifest);
                        continue;
                    }
                }
                if register_gpu_script_draft(&mut self.registry, &type_id, &manifest).is_ok() {
                    self.kernel_manifests.insert(type_id.clone(), manifest);
                    continue;
                }
            }
            // No manifest available — build a draft spec that includes any ports referenced by
            // existing connections so the project loads without PortNotFound errors.
            let uid = type_id.clone();
            let extra_inputs = draft_extra_inputs.remove(&type_id).unwrap_or_default();
            let extra_outputs = draft_extra_outputs.remove(&type_id).unwrap_or_default();
            Arc::make_mut(&mut self.registry).register_or_replace(&type_id, move || {
                let base = GpuScriptDraftNode::new(&uid);
                let mut spec = base.spec();
                for port_name in &extra_inputs {
                    if !spec.inputs.iter().any(|p| &p.name == port_name) {
                        spec.inputs.push(PortSpec {
                            name: port_name.clone(),
                            label: port_name.clone(),
                            ty: ValueType::Any,
                            ..Default::default()
                        });
                    }
                }
                for port_name in &extra_outputs {
                    if !spec.outputs.iter().any(|p| &p.name == port_name) {
                        spec.outputs.push(PortSpec {
                            name: port_name.clone(),
                            label: port_name.clone(),
                            ty: ValueType::Any,
                            ..Default::default()
                        });
                    }
                }
                Arc::new(GpuScriptDraftNode::with_spec(spec))
            });
        }

        self.group_definitions.retain(|_, def| def.is_builtin);
        for def in data.group_definitions {
            self.register_group(def).map_err(CascadeError::Other)?;
        }

        let mut id_map = HashMap::new();
        for node in &data.nodes {
            let new_id = self.graph.add_node(&node.type_id);
            self.graph
                .set_position(new_id, node.position.0, node.position.1);
            for (key, value) in &node.params {
                self.graph.set_param(new_id, key, value.clone());
            }
            for (port_name, value) in &node.input_defaults {
                self.graph
                    .set_input_default(new_id, port_name, value.clone());
            }
            if let Some(instance) = self.graph.nodes.get_mut(new_id) {
                instance.uuid = node.id.clone();
                instance.muted = node.muted;
            }
            if let Some(def) = self.group_definitions.get(&node.type_id) {
                let group_node = GroupNode::from_definition(def.clone(), &self.registry)
                    .map_err(CascadeError::Other)?;
                self.nodes.insert(new_id, Arc::new(group_node));
            } else if let Some(instance) = self.registry.create(&node.type_id) {
                self.nodes.insert(new_id, instance);
            }
            id_map.insert(node.id.clone(), new_id);
            self.uuid_map.insert(node.id.clone(), new_id);
        }

        for conn in &data.connections {
            let from_id = id_map.get(&conn.from_node).copied().ok_or_else(|| {
                CascadeError::Other("Invalid from_node in connection".to_string())
            })?;
            let to_id = id_map
                .get(&conn.to_node)
                .copied()
                .ok_or_else(|| CascadeError::Other("Invalid to_node in connection".to_string()))?;
            self.graph.connect(
                &self.registry,
                from_id,
                &conn.from_port,
                to_id,
                &conn.to_port,
            )?;
        }
        Ok(())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

fn find_kernels_dir() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            let candidate = parent.join("kernels");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    let local = PathBuf::from("kernels");
    if local.is_dir() {
        return Some(local);
    }
    None
}

fn format_node_id(graph: &Graph, id: NodeId) -> String {
    graph
        .nodes
        .get(id)
        .map(|node| node.uuid.clone())
        .unwrap_or_default()
}

fn parse_node_id_from_map(
    uuid_map: &HashMap<String, NodeId>,
    id: &str,
) -> Result<NodeId, CascadeError> {
    if let Some(&node_id) = uuid_map.get(id) {
        return Ok(node_id);
    }
    let value = id
        .parse::<u64>()
        .map_err(|_| CascadeError::Other(format!("Unknown node id: {id}")))?;
    Ok(NodeId::from(slotmap::KeyData::from_ffi(value)))
}

fn unique_port_name(base: &str, counts: &mut HashMap<String, usize>) -> String {
    let entry = counts.entry(base.to_string()).or_insert(0);
    *entry += 1;
    if *entry == 1 {
        base.to_string()
    } else {
        format!("{}_{}", base, *entry)
    }
}

fn find_group_nodes(definition: &GroupDefinition) -> Result<(String, String), CascadeError> {
    let mut group_input_id = None;
    let mut group_output_id = None;
    for node in &definition.internal_graph.nodes {
        if node.type_id == "group_input" {
            group_input_id = Some(node.id.clone());
        }
        if node.type_id == "group_output" {
            group_output_id = Some(node.id.clone());
        }
    }
    let group_input_id = group_input_id
        .ok_or_else(|| CascadeError::Other("Group input node missing".to_string()))?;
    let group_output_id = group_output_id
        .ok_or_else(|| CascadeError::Other("Group output node missing".to_string()))?;
    Ok((group_input_id, group_output_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use cascade_gpu::ManifestPort;

    fn sample_manifest_json() -> String {
        let manifest = KernelManifest {
            id: "test_kernel".to_string(),
            display_name: "Test Kernel".to_string(),
            category: "GPU".to_string(),
            description: "test".to_string(),
            inputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            outputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return color;".to_string(),
            ..KernelManifest::default()
        };
        serde_json::to_string(&manifest).expect("manifest json")
    }

    #[test]
    fn test_add_gpu_script_node_creates_unique_type() {
        let mut engine = Engine::new();
        let (node_id, _) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let id = engine.parse_node_id(&node_id).unwrap();
        let node = engine.graph.nodes.get(id).unwrap();
        assert!(node.type_id.starts_with("gpu_script::"));
        let spec = engine.registry.get_spec(&node.type_id).unwrap();
        assert_eq!(spec.display_name, "GPU Script");
        if engine.gpu_context().is_some() {
            let stored_manifest = node.params.get(GPU_SCRIPT_MANIFEST_PARAM_KEY);
            let Some(ParamValue::String(manifest_json)) = stored_manifest else {
                panic!("expected passthrough manifest to be stored for gpu script node");
            };
            let manifest: KernelManifest =
                serde_json::from_str(manifest_json).expect("valid manifest json");
            assert_eq!(manifest.kernel, "return color;");
            let instance = engine.nodes.get(&id).expect("gpu script node instance");
            assert!(instance.as_any().is::<GpuKernelNode>());
        }
    }

    #[test]
    fn test_compile_script_node_rejects_non_gpu_script() {
        let mut engine = Engine::new();
        let (node_id, _) = engine.add_node("viewer", 0.0, 0.0).unwrap();
        let manifest_json = sample_manifest_json();
        let err = engine
            .compile_script_node(&node_id, &manifest_json)
            .unwrap_err();
        assert!(err.contains("Node is not a GPU Script node"));
    }

    #[test]
    fn test_compile_script_node_replaces_node_when_gpu_available() {
        let mut engine = Engine::new();
        if engine.gpu_context().is_none() {
            return;
        }
        let (node_id, _) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let id = engine.parse_node_id(&node_id).unwrap();
        let manifest_json = sample_manifest_json();
        let spec = engine
            .compile_script_node(&node_id, &manifest_json)
            .expect("compile");
        let graph_node = engine.graph.nodes.get(id).unwrap();
        assert_eq!(spec.id, graph_node.type_id);
        let stored_manifest = graph_node.params.get(GPU_SCRIPT_MANIFEST_PARAM_KEY);
        let Some(ParamValue::String(stored_manifest)) = stored_manifest else {
            panic!("expected compiled manifest to be stored on gpu script node");
        };
        let stored_manifest: KernelManifest =
            serde_json::from_str(stored_manifest).expect("valid stored manifest");
        assert_eq!(stored_manifest.id, graph_node.type_id);
        let node = engine.nodes.get(&id).unwrap();
        assert!(node.as_any().is::<GpuKernelNode>());
    }

    #[test]
    fn test_compile_script_node_persists_manifest_without_gpu() {
        let mut engine = Engine::new();
        engine.gpu_context = None;

        let (node_id, _) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let id = engine.parse_node_id(&node_id).unwrap();
        let manifest = KernelManifest {
            id: "scalar_input".to_string(),
            display_name: "Scalar Input".to_string(),
            category: "GPU".to_string(),
            description: "Scalar uniform input".to_string(),
            inputs: vec![
                ManifestPort {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: "Image".to_string(),
                    optional: false,
                    ..Default::default()
                },
                ManifestPort {
                    name: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: "Float".to_string(),
                    default: Some(serde_json::Value::from(0.5)),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui: Some("Slider".to_string()),
                    ..Default::default()
                },
            ],
            outputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return totally_invalid_when_gpu_absent;".to_string(),
            supports_mask: false,
            ..KernelManifest::default()
        };
        let manifest_json = serde_json::to_string(&manifest).expect("manifest json");

        let spec = engine
            .compile_script_node(&node_id, &manifest_json)
            .expect("draft compile without GPU");

        assert_eq!(spec.display_name, "Scalar Input");
        assert!(spec.inputs.iter().any(|input| input.name == "amount"
            && input.ty == ValueType::Float
            && matches!(input.default, Some(ParamDefault::Float(value)) if value == 0.5)));
        let graph_node = engine.graph.nodes.get(id).unwrap();
        let stored_manifest = graph_node.params.get(GPU_SCRIPT_MANIFEST_PARAM_KEY);
        let Some(ParamValue::String(stored_manifest)) = stored_manifest else {
            panic!("expected manifest to be stored on draft gpu script node");
        };
        let stored_manifest: KernelManifest =
            serde_json::from_str(stored_manifest).expect("valid stored manifest");
        assert_eq!(stored_manifest.id, graph_node.type_id);
        assert_eq!(
            stored_manifest.kernel,
            "return totally_invalid_when_gpu_absent;"
        );
        let node = engine.nodes.get(&id).unwrap();
        assert!(node.as_any().is::<GpuScriptDraftNode>());
    }

    #[test]
    fn test_gpu_script_compile_accepts_scalar_input_uniform() {
        let mut engine = Engine::new();
        if engine.gpu_context().is_none() {
            return;
        }

        let (node_id, _) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let manifest = KernelManifest {
            id: "scalar_input".to_string(),
            display_name: "Scalar Input".to_string(),
            category: "GPU".to_string(),
            description: "Scalar uniform input".to_string(),
            inputs: vec![
                ManifestPort {
                    name: "image".to_string(),
                    label: "Image".to_string(),
                    ty: "Image".to_string(),
                    optional: false,
                    ..Default::default()
                },
                ManifestPort {
                    name: "amount".to_string(),
                    label: "Amount".to_string(),
                    ty: "Float".to_string(),
                    default: Some(serde_json::Value::from(0.5)),
                    min: Some(0.0),
                    max: Some(1.0),
                    step: Some(0.01),
                    ui: Some("Slider".to_string()),
                    ..Default::default()
                },
            ],
            outputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            params: vec![],
            kernel: "return vec4(color.rgb * amount, color.a);".to_string(),
            supports_mask: false,
            ..KernelManifest::default()
        };
        let manifest_json = serde_json::to_string(&manifest).expect("manifest json");

        let spec = engine
            .compile_script_node(&node_id, &manifest_json)
            .expect("compile scalar input script");
        let amount = spec
            .inputs
            .iter()
            .find(|input| input.name == "amount")
            .expect("amount input should be exposed");
        assert_eq!(amount.ty, ValueType::Float);
        assert!(matches!(
            amount.default,
            Some(ParamDefault::Float(value)) if value == 0.5
        ));
        assert_eq!(amount.min, Some(0.0));
        assert!(spec.params.is_empty());
    }

    #[test]
    fn test_export_document_includes_grouped_gpu_script_manifest() {
        let mut engine = Engine::new();
        if engine.gpu_context().is_none() {
            return;
        }

        let (script_node_id, actual_type_id) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let create_result = engine
            .create_group_from_nodes(&[&script_node_id], "GPU Script Group")
            .expect("create group");

        let document = engine.export_document();
        assert!(
            document.scripts.contains_key(&actual_type_id),
            "grouped gpu script manifest should be exported with the document",
        );
        assert!(
            document
                .graph
                .nodes
                .iter()
                .all(|node| node.type_id != actual_type_id),
            "the gpu script should only exist inside the exported group definition",
        );
        assert!(
            document.graph.group_definitions.iter().any(|def| def.id
                == create_result.group_definition_id
                && def
                    .internal_graph
                    .nodes
                    .iter()
                    .any(|node| node.type_id == actual_type_id)),
            "exported group definition should still reference the gpu script type",
        );
    }

    #[test]
    fn test_internal_group_viewer_accepts_any_input_connection() {
        let mut engine = Engine::new();
        let (solid_id, _) = engine.add_node("solid_color", 0.0, 0.0).unwrap();
        let (raster_id, _) = engine.add_node("rasterize_field", 200.0, 0.0).unwrap();
        engine
            .connect(&solid_id, "field", &raster_id, "field")
            .expect("connect solid field to rasterizer");

        let group = engine
            .create_group_from_nodes(&[&raster_id], "Raster Group")
            .expect("create group");
        let internal_raster_id = group.removed_node_ids[0].clone();
        let viewer = engine
            .add_internal_node(&group.group_definition_id, "viewer", 300.0, 0.0)
            .expect("add internal viewer");

        engine
            .add_internal_connection(
                &group.group_definition_id,
                &internal_raster_id,
                "image",
                &viewer.id,
                "value",
            )
            .expect("Image should connect to Viewer.value Any inside groups");
    }

    #[test]
    fn test_internal_group_connection_rejects_incompatible_ports() {
        let mut engine = Engine::new();
        let (_solid_id, _) = engine.add_node("solid_color", 0.0, 0.0).unwrap();
        let (raster_id, _) = engine.add_node("rasterize_field", 200.0, 0.0).unwrap();
        let group = engine
            .create_group_from_nodes(&[&raster_id], "Raster Group")
            .expect("create group");
        let internal_raster_id = group.removed_node_ids[0].clone();
        let float_node = engine
            .add_internal_node(&group.group_definition_id, "float_constant", 0.0, 120.0)
            .expect("add internal float");

        let err = engine
            .add_internal_connection(
                &group.group_definition_id,
                &float_node.id,
                "value",
                &internal_raster_id,
                "field",
            )
            .expect_err("Float should not connect to Field inside groups");
        assert!(matches!(err, CascadeError::TypeMismatch { .. }));
    }

    #[test]
    fn test_render_internal_viewer_uses_root_group_inputs() {
        let mut engine = Engine::new();
        let (solid_id, _) = engine.add_node("solid_color", 0.0, 0.0).unwrap();
        let (raster_id, _) = engine.add_node("rasterize_field", 200.0, 0.0).unwrap();
        engine
            .set_param(&raster_id, "width", ParamValue::Int(8))
            .expect("set raster width");
        engine
            .set_param(&raster_id, "height", ParamValue::Int(6))
            .expect("set raster height");
        engine
            .connect(&solid_id, "field", &raster_id, "field")
            .expect("connect solid field to rasterizer");

        let group = engine
            .create_group_from_nodes(&[&raster_id], "Raster Group")
            .expect("create group");
        let internal_raster_id = group.removed_node_ids[0].clone();
        let viewer = engine
            .add_internal_node(&group.group_definition_id, "viewer", 300.0, 0.0)
            .expect("add internal viewer");
        engine
            .add_internal_connection(
                &group.group_definition_id,
                &internal_raster_id,
                "image",
                &viewer.id,
                "value",
            )
            .expect("connect rasterizer to internal viewer");

        let result = engine
            .render_internal_viewer(&group.group_node_id, &viewer.id, 0)
            .expect("render internal viewer");
        assert_eq!(result.width, 8);
        assert_eq!(result.height, 6);
        assert_eq!(result.pixels.len(), 8 * 6 * 4);
    }

    #[test]
    fn test_load_palette_data_updates_color_palette_node_params() {
        let mut engine = Engine::new();
        let (node_id, _) = engine.add_node("color_palette", 0.0, 0.0).unwrap();

        let palette_image = image::RgbaImage::from_fn(3, 1, |x, _| match x {
            0 => image::Rgba([255, 0, 0, 255]),
            1 => image::Rgba([0, 255, 0, 255]),
            _ => image::Rgba([0, 0, 255, 255]),
        });
        let mut png_bytes = Vec::new();
        palette_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode palette png");

        let colors = engine
            .load_palette_data(&node_id, &png_bytes)
            .expect("load palette data");
        assert_eq!(colors.len(), 3);

        let id = engine.parse_node_id(&node_id).unwrap();
        let stored = engine
            .graph
            .nodes
            .get(id)
            .and_then(|node| node.params.get("colors"));
        let Some(ParamValue::ColorPalette(stored_colors)) = stored else {
            panic!("expected colors param to be set on color palette node");
        };
        assert_eq!(stored_colors.len(), 3);

        let has_red = stored_colors
            .iter()
            .any(|color| color[0] > 0.9 && color[1] < 0.1 && color[2] < 0.1);
        let has_green = stored_colors
            .iter()
            .any(|color| color[0] < 0.1 && color[1] > 0.9 && color[2] < 0.1);
        let has_blue = stored_colors
            .iter()
            .any(|color| color[0] < 0.1 && color[1] < 0.1 && color[2] > 0.9);

        assert!(has_red, "stored palette should contain red");
        assert!(has_green, "stored palette should contain green");
        assert!(has_blue, "stored palette should contain blue");
    }

    #[test]
    fn test_pixelate_kernel_e2e_via_compile_script() {
        use cascade_gpu::manifest::ManifestParam;

        let mut engine = Engine::new();
        if engine.gpu_context().is_none() {
            println!("GPU not available, skipping pixelate E2E test");
            return;
        }

        // Build a pixelate-only manifest
        let manifest = KernelManifest {
            id: "pixelate".to_string(),
            display_name: "Pixelate".to_string(),
            category: "GPU".to_string(),
            description: "Pixelate effect".to_string(),
            inputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
            }],
            outputs: vec![ManifestPort {
                name: "image".to_string(),
                label: "Image".to_string(),
                ty: "Image".to_string(),
                optional: false,
                ..Default::default()
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
                options: vec![],
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
            ..KernelManifest::default()
        };
        let manifest_json = serde_json::to_string(&manifest).expect("manifest json");

        // Create a GPU script node and compile it with the pixelate kernel
        let (script_node_id, _) = engine.add_node("gpu_script", 0.0, 0.0).unwrap();
        let spec = engine
            .compile_script_node(&script_node_id, &manifest_json)
            .expect("compile pixelate kernel");
        assert_eq!(spec.display_name, "Pixelate");
        assert_eq!(spec.params.len(), 1);
        assert_eq!(spec.params[0].key, "pixel_size");

        // Create a full pipeline: LoadImage → Pixelate → Viewer
        let (load_id, _) = engine.add_node("load_image", -200.0, 0.0).unwrap();
        let (viewer_id, _) = engine.add_node("viewer", 200.0, 0.0).unwrap();

        // Encode as PNG for LoadImage
        let png_image = image::RgbaImage::from_fn(8, 8, |x, y| {
            let r = ((x as f32 / 7.0) * 255.0) as u8;
            let g = ((y as f32 / 7.0) * 255.0) as u8;
            image::Rgba([r, g, 64, 255])
        });
        let mut png_bytes = Vec::new();
        png_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode PNG");

        engine
            .load_image_data(&load_id, &png_bytes)
            .expect("load image");

        // Connect: LoadImage → Pixelate → Viewer
        engine
            .connect(&load_id, "image", &script_node_id, "image")
            .expect("connect load→pixelate");
        engine
            .connect(&script_node_id, "image", &viewer_id, "value")
            .expect("connect pixelate→viewer");

        // Set pixel_size = 4 (8x8 image with block size 4 → four 4x4 blocks)
        engine
            .set_param(&script_node_id, "pixel_size", ParamValue::Int(4))
            .expect("set pixel_size");

        // Render
        let result = engine
            .render_viewer(&viewer_id, 0)
            .expect("render through pixelate");
        assert_eq!(result.width, 8);
        assert_eq!(result.height, 8);

        // With pixel_size=4 on an 8x8 image:
        // Block origins: pixels 0-3 → origin (2,y), pixels 4-7 → origin (6,y)
        // All pixels within a 4x4 block should have the same color.
        // Verify: pixel (0,0) == pixel (1,0) == pixel (2,0) == pixel (3,0)
        let px = |x: usize, y: usize| -> (u8, u8, u8, u8) {
            let idx = (y * 8 + x) * 4;
            (
                result.pixels[idx],
                result.pixels[idx + 1],
                result.pixels[idx + 2],
                result.pixels[idx + 3],
            )
        };

        let p00 = px(0, 0);
        let p10 = px(1, 0);
        let p20 = px(2, 0);
        let p30 = px(3, 0);
        assert_eq!(
            p00, p10,
            "Pixels (0,0) and (1,0) should match in same block"
        );
        assert_eq!(
            p10, p20,
            "Pixels (1,0) and (2,0) should match in same block"
        );
        assert_eq!(
            p20, p30,
            "Pixels (2,0) and (3,0) should match in same block"
        );

        // Second block: pixel (4,0) should differ from first block
        let p40 = px(4, 0);
        assert_ne!(p00, p40, "Different blocks should have different colors");

        // Verify vertical blocking too: (0,0) == (0,1) == (0,2) == (0,3)
        let p01 = px(0, 1);
        let p02 = px(0, 2);
        let p03 = px(0, 3);
        assert_eq!(
            p00, p01,
            "Pixels (0,0) and (0,1) should match in same block"
        );
        assert_eq!(
            p01, p02,
            "Pixels (0,1) and (0,2) should match in same block"
        );
        assert_eq!(
            p02, p03,
            "Pixels (0,2) and (0,3) should match in same block"
        );

        // Second vertical block should differ
        let p04 = px(0, 4);
        assert_ne!(
            p00, p04,
            "Different vertical blocks should have different colors"
        );

        // Alpha should be preserved
        assert_eq!(p00.3, 255, "Alpha should be preserved");

        println!(
            "Pixelate E2E test PASSED — block (0,0): {p00:?}, block (4,0): {p40:?}, block (0,4): {p04:?}"
        );
    }

    #[test]
    fn test_pixelate_group_e2e() {
        let mut engine = Engine::new();
        if engine.gpu_context().is_none() {
            println!("GPU not available, skipping");
            return;
        }

        let spec = engine.registry.get_spec("group::pixelate");
        assert!(spec.is_some(), "Pixelate group should be registered");
        let spec = spec.unwrap();
        assert_eq!(spec.display_name, "Pixelate");
        assert_eq!(spec.inputs.len(), 2);
        assert!(spec.inputs.iter().any(|p| p.name == "image"));
        assert!(spec.inputs.iter().any(|p| p.name == "palette"));
        assert_eq!(spec.outputs.len(), 1);
        assert_eq!(spec.outputs[0].name, "image");
        assert_eq!(spec.params.len(), 4);
        assert!(spec.params.iter().any(|p| p.key == "pixel_size"));
        assert!(spec.params.iter().any(|p| p.key == "algorithm"));
        assert!(spec.params.iter().any(|p| p.key == "matrix_size"));
        assert!(spec.params.iter().any(|p| p.key == "dither_amount"));

        let (load_id, _) = engine.add_node("load_image", -200.0, 0.0).unwrap();
        let (pix_id, _) = engine.add_node("group::pixelate", 0.0, 0.0).unwrap();
        let (viewer_id, _) = engine.add_node("viewer", 200.0, 0.0).unwrap();

        let png_image = image::RgbaImage::from_fn(8, 8, |x, y| {
            let r = ((x as f32 / 7.0) * 255.0) as u8;
            let g = ((y as f32 / 7.0) * 255.0) as u8;
            image::Rgba([r, g, 64, 255])
        });
        let mut png_bytes = Vec::new();
        png_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode PNG");
        engine.load_image_data(&load_id, &png_bytes).expect("load");

        engine
            .connect(&load_id, "image", &pix_id, "image")
            .expect("connect");
        engine
            .connect(&pix_id, "image", &viewer_id, "value")
            .expect("connect");
        engine
            .set_param(&pix_id, "pixel_size", ParamValue::Int(4))
            .expect("set param");

        let result_no_palette = engine.render_viewer(&viewer_id, 0).expect("render");
        assert_eq!(result_no_palette.width, 8);
        assert_eq!(result_no_palette.height, 8);

        let px = |x: usize, y: usize| -> (u8, u8, u8, u8) {
            let idx = (y * 8 + x) * 4;
            (
                result_no_palette.pixels[idx],
                result_no_palette.pixels[idx + 1],
                result_no_palette.pixels[idx + 2],
                result_no_palette.pixels[idx + 3],
            )
        };
        assert_eq!(px(0, 0), px(1, 0), "Same block should match");
        assert_eq!(px(0, 0), px(3, 3), "Same block should match");
        assert_ne!(px(0, 0), px(4, 0), "Different blocks should differ");
        assert_eq!(px(0, 0).3, 255, "Alpha preserved");
        let (load_pal_id, _) = engine.add_node("load_image", -200.0, 200.0).unwrap();
        let pal_image = image::RgbaImage::from_fn(4, 1, |x, _| match x {
            0 => image::Rgba([255, 0, 0, 255]),
            1 => image::Rgba([0, 255, 0, 255]),
            2 => image::Rgba([0, 0, 255, 255]),
            _ => image::Rgba([255, 255, 255, 255]),
        });
        let mut pal_bytes = Vec::new();
        pal_image
            .write_to(
                &mut std::io::Cursor::new(&mut pal_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode palette");
        engine
            .load_image_data(&load_pal_id, &pal_bytes)
            .expect("load palette");
        engine
            .connect(&load_pal_id, "image", &pix_id, "palette")
            .expect("connect palette");
        engine
            .set_param(&pix_id, "dither_amount", ParamValue::Float(1.0))
            .expect("set dither amount");

        let result_palette = engine.render_viewer(&viewer_id, 1).expect("render");
        assert_eq!(result_palette.width, 8);
        assert_eq!(result_palette.height, 8);
        let idx = 0;
        let p = (
            result_palette.pixels[idx],
            result_palette.pixels[idx + 1],
            result_palette.pixels[idx + 2],
            result_palette.pixels[idx + 3],
        );
        assert_eq!(p.3, 255, "Alpha preserved");
        let is_palette_color = (p.0 > 200 && p.1 < 50 && p.2 < 50)
            || (p.0 < 50 && p.1 > 200 && p.2 < 50)
            || (p.0 < 50 && p.1 < 50 && p.2 > 200)
            || (p.0 > 200 && p.1 > 200 && p.2 > 200);
        assert!(
            is_palette_color,
            "Output pixel should be snapped to a palette color, got {p:?}"
        );
        println!("Pixelate GROUP E2E test PASSED");
    }

    #[test]
    fn test_live_render_preview_scale_only_updates_affected_viewers() {
        let mut engine = Engine::new();

        let (load_id, _) = engine.add_node("load_image", -300.0, 0.0).unwrap();
        let (blur_id, _) = engine.add_node("gaussian_blur", 0.0, 0.0).unwrap();
        let (viewer_id, _) = engine.add_node("viewer", 300.0, 0.0).unwrap();
        let (other_load_id, _) = engine.add_node("load_image", -300.0, 200.0).unwrap();
        let (other_viewer_id, _) = engine.add_node("viewer", 300.0, 200.0).unwrap();

        let png_image = image::RgbaImage::from_fn(100, 80, |x, y| {
            let r = ((x as f32 / 99.0) * 255.0) as u8;
            let g = ((y as f32 / 79.0) * 255.0) as u8;
            image::Rgba([r, g, 64, 255])
        });
        let mut png_bytes = Vec::new();
        png_image
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode PNG");
        engine
            .load_image_data(&load_id, &png_bytes)
            .expect("load image");

        let other_png_image = image::RgbaImage::from_fn(24, 24, |x, y| {
            image::Rgba([(x * 10) as u8, (y * 10) as u8, 200, 255])
        });
        let mut other_png_bytes = Vec::new();
        other_png_image
            .write_to(
                &mut std::io::Cursor::new(&mut other_png_bytes),
                image::ImageFormat::Png,
            )
            .expect("encode other PNG");
        engine
            .load_image_data(&other_load_id, &other_png_bytes)
            .expect("load other image");

        engine
            .connect(&load_id, "image", &blur_id, "image")
            .expect("connect load->blur");
        engine
            .connect(&blur_id, "image", &viewer_id, "value")
            .expect("connect blur->viewer");
        engine
            .connect(&other_load_id, "image", &other_viewer_id, "value")
            .expect("connect other load->viewer");

        let live_results = engine
            .set_param_and_render_viewers_scaled(&blur_id, "sigma", ParamValue::Float(2.0), 0, 0.5)
            .expect("live render");

        assert_eq!(
            live_results.len(),
            1,
            "only affected viewer should re-render"
        );
        let (updated_viewer_id, live_result) = &live_results[0];
        assert_eq!(updated_viewer_id, &viewer_id);
        assert_eq!(live_result.width, 50);
        assert_eq!(live_result.height, 40);

        let committed_result = engine.render_viewer(&viewer_id, 0).expect("full render");
        assert_eq!(committed_result.width, 100);
        assert_eq!(committed_result.height, 80);
    }

    #[test]
    fn test_list_node_types_includes_groups() {
        let engine = Engine::new();
        let specs = engine.list_node_types();
        // GPU kernel groups require a GPU adapter.
        // On CI or headless environments without a GPU, these groups won't be
        // registered, so we only assert they exist when GPU init succeeded.
        // Note: Color Range group is temporarily disabled — it depends on CPU image_math
        // scalar operations not yet supported by the GPU image_math kernel.
        let has_pixelate = specs.iter().any(|s| s.id == "group::pixelate");
        if engine.gpu_context().is_some() {
            assert!(has_pixelate, "Pixelate group should appear in node types");
        } else {
            println!("GPU not available, skipping GPU kernel group assertions");
        }
    }

    #[test]
    #[cfg(feature = "ocio")]
    fn test_ocio_loads_from_env() {
        if std::env::var("OCIO").is_err() {
            println!("$OCIO not set, skipping OCIO integration test");
            return;
        }

        let mut engine = Engine::new();
        engine
            .load_ocio_from_env()
            .expect("OCIO config should load from $OCIO");

        let displays = engine.available_displays();
        assert!(!displays.is_empty(), "OCIO config should provide displays");

        let views = engine.available_views(&displays[0]);
        assert!(!views.is_empty(), "First display should have views");

        assert!(!engine.active_display().is_empty());
        assert!(!engine.active_view().is_empty());

        let cs = engine.available_color_spaces();
        assert!(!cs.is_empty(), "OCIO config should provide color spaces");

        let ws = engine.working_space();
        assert!(!ws.is_empty(), "Working space should be set");
    }
}
