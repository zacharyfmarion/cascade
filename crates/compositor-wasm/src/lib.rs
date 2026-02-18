mod ai_provider;

use compositor_core::ai::AiProvider;
use compositor_core::color::{BuiltinColorManagement, ColorManagement};
use compositor_core::error::CompositorError;
use compositor_core::eval::Evaluator;
use compositor_core::graph::{Graph, NodeId};
use compositor_core::group::{
    GroupDefinition, InternalConnection, InternalNode, SerializableInternalGraph,
};
use compositor_core::node::{Node, NodeRegistry};
use compositor_core::types::{Format, FrameTime, NodeSpec, ParamValue, PortSpec, Value};
use compositor_gpu::kernel_node::GpuKernelNode;
use compositor_gpu::{GpuContext, KernelManifest};
use compositor_nodes_std::{register_standard_nodes, ColorPaletteNode, GpuScriptDraftNode, GroupNode, LoadImage, LoadImageSequence, SequenceInfo, Viewer};
use js_sys::Array;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use uuid::Uuid;
use wasm_bindgen::prelude::*;
use crate::ai_provider::WasmAiProvider;

#[wasm_bindgen]
pub struct Engine {
    graph: Graph,
    registry: Arc<NodeRegistry>,
    nodes: HashMap<NodeId, Arc<dyn Node>>,
    evaluator: Evaluator,
    last_timings: HashMap<String, f64>,
    group_definitions: HashMap<String, Arc<GroupDefinition>>,
    uuid_map: HashMap<String, NodeId>,
    gpu_context: Option<Arc<GpuContext>>,
    kernel_manifests: HashMap<String, KernelManifest>,
    ai_provider: Option<Arc<dyn AiProvider>>,
    color_management: BuiltinColorManagement,
    active_display: String,
    active_view: String,
    project_format: Format,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        console_error_panic_hook::set_once();
        let mut registry = NodeRegistry::new();
        register_standard_nodes(&mut registry);
        Engine {
            graph: Graph::new(),
            registry: Arc::new(registry),
            nodes: HashMap::new(),
            evaluator: Evaluator::new(),
            last_timings: HashMap::new(),
            group_definitions: HashMap::new(),
            uuid_map: HashMap::new(),
            gpu_context: None,
            kernel_manifests: HashMap::new(),
            ai_provider: None,
            color_management: BuiltinColorManagement::new(),
            active_display: "sRGB".to_string(),
            active_view: "Standard".to_string(),
            project_format: Format::hd(),
        }
    }

    pub async fn init_gpu(&mut self) -> Result<(), JsValue> {
        let ctx = GpuContext::new_async().await.map_err(to_js_error_str)?;
        let shared = Arc::new(ctx);
        compositor_gpu::register_gpu_nodes(Arc::make_mut(&mut self.registry), shared.clone());
        self.gpu_context = Some(shared);
        Ok(())
    }

    pub fn set_ai_api_key(&mut self, provider: &str, key: &str) -> Result<(), JsValue> {
        match provider {
            "openai" | "wasm" => {
                let ai = Arc::new(WasmAiProvider::new());
                ai.set_api_key(key.to_string());
                let ai_provider: Arc<dyn AiProvider> = ai;
                self.ai_provider = Some(ai_provider);
                Ok(())
            }
            _ => Err(JsValue::from_str("Unknown AI provider")),
        }
    }

    pub fn is_ai_configured(&self) -> bool {
        self.ai_provider
            .as_ref()
            .map_or(false, |provider| provider.is_configured())
    }

    pub fn compile_script_node(
        &mut self,
        node_id: &str,
        manifest_json: &str,
    ) -> Result<JsValue, JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;

        let manifest: KernelManifest =
            serde_json::from_str(manifest_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

        let graph_node = self
            .graph
            .nodes
            .get(id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let type_id = graph_node.type_id.clone();

        if !type_id.starts_with("gpu_script") {
            return Err(JsValue::from_str("Node is not a GPU Script node"));
        }

        let mut manifest = manifest;
        manifest.id = type_id.clone();

        let gpu_context = self
            .gpu_context
            .clone()
            .ok_or_else(|| JsValue::from_str("GPU not available"))?;

        let compiled_node =
            GpuKernelNode::from_manifest(manifest.clone(), gpu_context.clone())
                .map_err(to_js_error_str)?;
        let spec = compiled_node.spec();

        self.kernel_manifests
            .insert(type_id.clone(), manifest.clone());
        let manifest_for_factory = manifest.clone();
        let gpu_ctx = gpu_context.clone();
        Arc::make_mut(&mut self.registry).register_or_replace(&type_id, move || {
            Arc::new(
                GpuKernelNode::from_manifest(manifest_for_factory.clone(), gpu_ctx.clone())
                    .expect("GPU node"),
            )
        });

        self.nodes.insert(id, Arc::new(compiled_node));
        self.graph.prune_connections_for_node(id, &self.registry);
        self.graph.mark_dirty(id);

        serde_wasm_bindgen::to_value(&spec).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn list_node_types(&self) -> JsValue {
        let specs: Vec<_> = self
            .registry
            .list_specs()
            .into_iter()
            .filter(|spec| !spec.id.starts_with("gpu_script::"))
            .map(|spec| {
                let mut spec = spec.clone();
                spec.inputs = spec.all_inputs();
                spec
            })
            .collect();
        serde_wasm_bindgen::to_value(&specs).unwrap_or(JsValue::NULL)
    }

    fn register_group(&mut self, def: GroupDefinition) -> Result<NodeSpec, String> {
        let arc_def = Arc::new(def);
        let interface = GroupNode::derive_interface(&arc_def, &self.registry)?;
        let spec = GroupNode::build_spec(&arc_def, &interface);
        Arc::make_mut(&mut self.registry).register_spec(&spec.id, spec.clone());
        self.group_definitions.insert(spec.id.clone(), arc_def);
        Ok(spec)
    }

    pub fn add_node(&mut self, type_id: &str, x: f64, y: f64) -> JsValue {
        match self.add_node_internal(type_id, x, y) {
            Some((id, actual_type_id)) => {
                serde_wasm_bindgen::to_value(&AddNodeResult {
                    id,
                    type_id: actual_type_id,
                })
                .unwrap_or(JsValue::NULL)
            }
            None => JsValue::NULL,
        }
    }

    fn add_node_internal(
        &mut self,
        type_id: &str,
        x: f64,
        y: f64,
    ) -> Option<(String, String)> {
        if let Some(def) = self.group_definitions.get(type_id) {
            let node_id = self.graph.add_node(type_id);
            self.graph.set_position(node_id, x, y);
            let uuid = self
                .graph
                .nodes
                .get(node_id)
                .map(|node| node.uuid.clone())
                .unwrap_or_default();
            self.uuid_map.insert(uuid.clone(), node_id);
            match GroupNode::from_definition(def.clone(), &self.registry) {
                Ok(group_node) => {
                    self.nodes.insert(node_id, Arc::new(group_node));
                }
                Err(_) => {
                    self.graph.remove_node(node_id);
                    self.uuid_map.remove(&uuid);
                    return None;
                }
            }
            let id = format_node_id(&self.graph, node_id);
            return Some((id, type_id.to_string()));
        }

        let actual_type_id = if type_id == "gpu_script" {
            let uid = format!("gpu_script::{}", Uuid::new_v4());
            let uid2 = uid.clone();
            Arc::make_mut(&mut self.registry)
                .register_or_replace(&uid, move || Arc::new(GpuScriptDraftNode::new(&uid2)));
            uid
        } else {
            type_id.to_string()
        };

        let node_id = self.graph.add_node(&actual_type_id);
        self.graph.set_position(node_id, x, y);
        let uuid = self
            .graph
            .nodes
            .get(node_id)
            .map(|node| node.uuid.clone())
            .unwrap_or_default();
        self.uuid_map.insert(uuid, node_id);
        if let Some(node) = self.registry.create(&actual_type_id) {
            self.nodes.insert(node_id, node);
        }
        let id = format_node_id(&self.graph, node_id);
        Some((id, actual_type_id))
    }

    pub fn remove_node(&mut self, node_id: &str) {
        if let Ok(id) = parse_node_id(&self.uuid_map, node_id) {
            if let Some(uuid) = self.graph.nodes.get(id).map(|node| node.uuid.clone()) {
                self.uuid_map.remove(&uuid);
            }
            self.graph.remove_node(id);
            self.nodes.remove(&id);
        }
    }

    pub fn connect(
        &mut self,
        from_node: &str,
        from_port: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<(), JsValue> {
        let from_id = parse_node_id(&self.uuid_map, from_node).map_err(to_js_error)?;
        let to_id = parse_node_id(&self.uuid_map, to_node).map_err(to_js_error)?;
        self.graph
            .connect(&self.registry, from_id, from_port, to_id, to_port)
            .map_err(to_js_error)
    }

    pub fn disconnect(&mut self, to_node: &str, to_port: &str) {
        if let Ok(id) = parse_node_id(&self.uuid_map, to_node) {
            self.graph.disconnect(id, to_port);
        }
    }

    pub fn set_param(&mut self, node_id: &str, key: &str, value: JsValue) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let spec = self
            .graph
            .nodes
            .get(id)
            .and_then(|n| self.registry.get_spec(&n.type_id))
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let param_spec = spec.params.iter().find(|p| p.key == key);
        let param_value = convert_param_value(param_spec, value)?;
        self.graph.set_param(id, key, param_value);
        Ok(())
    }

    pub fn set_input_default(&mut self, node_id: &str, port_name: &str, value: JsValue) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let param_spec = self
            .graph
            .nodes
            .get(id)
            .and_then(|n| self.registry.get_spec(&n.type_id))
            .and_then(|spec| spec.params.iter().find(|p| p.key == port_name));
        let param_value = convert_param_value(param_spec, value)?;
        self.graph.set_input_default(id, port_name, param_value);
        Ok(())
    }

    pub fn set_position(&mut self, node_id: &str, x: f64, y: f64) {
        if let Ok(id) = parse_node_id(&self.uuid_map, node_id) {
            self.graph.set_position(id, x, y);
        }
    }

    pub fn load_image_data(&mut self, node_id: &str, data: &[u8]) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let load_node = node
            .as_any()
            .downcast_ref::<LoadImage>()
            .ok_or_else(|| JsValue::from_str("Node is not LoadImage"))?;
        load_node.set_image_data(data).map_err(to_js_error)?;
        self.graph.mark_dirty(id);
        Ok(())
    }

    pub fn get_image_data(&self, node_id: &str) -> Result<Vec<u8>, JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let load_node = node
            .as_any()
            .downcast_ref::<LoadImage>()
            .ok_or_else(|| JsValue::from_str("Node is not LoadImage"))?;
        load_node
            .get_image_bytes()
            .ok_or_else(|| JsValue::from_str("No image data available"))
    }

    pub fn load_palette_data(&mut self, node_id: &str, data: &[u8]) -> Result<JsValue, JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let palette_node = node
            .as_any()
            .downcast_ref::<ColorPaletteNode>()
            .ok_or_else(|| JsValue::from_str("Node is not ColorPaletteNode"))?;
        let colors = palette_node.load_palette_data(data).map_err(to_js_error)?;
        let param = ParamValue::ColorPalette(colors);
        self.graph.set_param(id, "colors", param);
        self.graph.mark_dirty(id);
        let colors_ref = match self.graph.nodes.get(id).and_then(|n| n.params.get("colors")) {
            Some(ParamValue::ColorPalette(c)) => c,
            _ => return Err(JsValue::from_str("Failed to read back palette")),
        };
        serde_wasm_bindgen::to_value(colors_ref).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn load_sequence_frame_data(
        &mut self,
        node_id: &str,
        frame: u64,
        data: &[u8],
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let seq_node = node
            .as_any()
            .downcast_ref::<LoadImageSequence>()
            .ok_or_else(|| JsValue::from_str("Node is not LoadImageSequence"))?;
        seq_node.set_frame_data(frame, data).map_err(to_js_error)
    }

    pub fn set_sequence_info(
        &mut self,
        node_id: &str,
        frame_count: u64,
        first_frame: u64,
        last_frame: u64,
    ) -> Result<(), JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;
        let node = self
            .nodes
            .get(&id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let seq_node = node
            .as_any()
            .downcast_ref::<LoadImageSequence>()
            .ok_or_else(|| JsValue::from_str("Node is not LoadImageSequence"))?;
        seq_node
            .set_info(SequenceInfo {
                frame_count,
                first_frame,
                last_frame,
            })
            .map_err(to_js_error)
    }

     pub async fn render_viewer(
         &mut self,
         viewer_node_id: &str,
         frame: u64,
     ) -> Result<Vec<u8>, JsValue> {
         let id = parse_node_id(&self.uuid_map, viewer_node_id).map_err(to_js_error)?;
         let cm = &self.color_management;
         let eval_result = self
             .evaluator
             .evaluate(
                 &mut self.graph,
                 &self.registry,
                 &self.nodes,
                 id,
                 "display",
                 FrameTime { frame },
                 cm,
                 self.ai_provider.as_deref(),
                 &self.project_format,
             )
            .await
            .map_err(to_js_error)?;
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
            Value::Image(image) => Ok(Viewer::image_to_rgba8_with_display(
                &image,
                cm,
                &self.active_display,
                &self.active_view,
            )),
            _ => Err(JsValue::from_str("Viewer output is not an image")),
        }
    }

    pub fn get_last_render_timings(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.last_timings).unwrap_or(JsValue::NULL)
    }

    pub fn get_color_management_info(&self) -> JsValue {
        let cm = &self.color_management;
        let displays = cm.available_displays();
        let views: Vec<String> = if let Some(d) = displays.first() {
            cm.available_views(d)
        } else {
            vec![]
        };
        let info = serde_json::json!({
            "workingSpace": cm.working_space().to_string(),
            "activeDisplay": &self.active_display,
            "activeView": &self.active_view,
            "displays": displays,
            "colorSpaces": cm.available_color_spaces(),
        });
        serde_wasm_bindgen::to_value(&info).unwrap_or(JsValue::NULL)
    }

    pub fn get_views_for_display(&self, display: &str) -> JsValue {
        let views = self.color_management.available_views(display);
        serde_wasm_bindgen::to_value(&views).unwrap_or(JsValue::NULL)
    }

    pub fn set_display_view(&mut self, display: &str, view: &str) {
        self.active_display = display.to_string();
        self.active_view = view.to_string();
        self.evaluator = Evaluator::new();
    }

    pub fn set_project_format(&mut self, width: u32, height: u32) {
        self.project_format = Format::from_dimensions(width, height);
        self.evaluator = Evaluator::new();
    }

     pub async fn get_render_dimensions(&mut self, viewer_node_id: &str, frame: u64) -> JsValue {
         let id = match parse_node_id(&self.uuid_map, viewer_node_id) {
             Ok(v) => v,
             Err(_) => return JsValue::NULL,
         };
         let cm = &self.color_management;
         let eval_result = self
             .evaluator
             .evaluate(
                 &mut self.graph,
                 &self.registry,
                 &self.nodes,
                 id,
                 "display",
                 FrameTime { frame },
                 cm,
                 self.ai_provider.as_deref(),
                 &self.project_format,
             )
            .await;
        if let Ok(eval_result) = eval_result {
            if let Value::Image(image) = eval_result.value {
                let dims = RenderDimensions {
                    width: image.width,
                    height: image.height,
                };
                serde_wasm_bindgen::to_value(&dims).unwrap_or(JsValue::NULL)
            } else {
                JsValue::NULL
            }
        } else {
            JsValue::NULL
        }
    }

    pub fn export_graph(&self) -> JsValue {
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
        let graph = SerializableGraph {
            nodes,
            connections,
            group_definitions,
        };
        serde_wasm_bindgen::to_value(&graph).unwrap_or(JsValue::NULL)
    }

    pub async fn export_image(&mut self, node_id: &str, frame: u64) -> Result<Vec<u8>, JsValue> {
        let id = parse_node_id(&self.uuid_map, node_id).map_err(to_js_error)?;

        let instance = self
            .graph
            .nodes
            .get(id)
            .ok_or_else(|| JsValue::from_str("Node not found"))?;
        let format = match instance.params.get("format") {
            Some(ParamValue::Int(v)) => *v,
            _ => 0,
        };

         let cm = &self.color_management;
         let eval_result = self
             .evaluator
             .evaluate(
                 &mut self.graph,
                 &self.registry,
                 &self.nodes,
                 id,
                 "display",
                 FrameTime { frame },
                 cm,
                 self.ai_provider.as_deref(),
                 &self.project_format,
             )
             .await
             .map_err(to_js_error)?;

         match eval_result.value {
             Value::Image(image) => {
                 let rgba8 = Viewer::image_to_rgba8_with_display(
                    &image,
                    cm,
                    &self.active_display,
                    &self.active_view,
                );
                let mut buf = Vec::new();

                if format == 1 {
                    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
                        .ok_or_else(|| JsValue::from_str("Failed to create image buffer"))?;
                    let rgb_img = image::DynamicImage::ImageRgba8(img).into_rgb8();
                    let mut cursor = std::io::Cursor::new(&mut buf);
                    rgb_img
                        .write_to(&mut cursor, image::ImageFormat::Jpeg)
                        .map_err(|e| JsValue::from_str(&format!("JPEG encode failed: {e}")))?;
                } else {
                    let img = image::RgbaImage::from_raw(image.width, image.height, rgba8)
                        .ok_or_else(|| JsValue::from_str("Failed to create image buffer"))?;
                    let mut cursor = std::io::Cursor::new(&mut buf);
                    img.write_to(&mut cursor, image::ImageFormat::Png)
                        .map_err(|e| JsValue::from_str(&format!("PNG encode failed: {e}")))?;
                }

                Ok(buf)
            }
            _ => Err(JsValue::from_str("Export output is not an image")),
        }
    }

    pub fn import_graph(&mut self, json: JsValue) -> Result<(), JsValue> {
        let data: SerializableGraph =
            serde_wasm_bindgen::from_value(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.graph = Graph::new();
        self.nodes.clear();
        self.evaluator = Evaluator::new();
        self.last_timings.clear();
        self.uuid_map.clear();

        self.group_definitions.retain(|_, def| def.is_builtin);
        for def in data.group_definitions {
            self.register_group(def)
                .map_err(|err| JsValue::from_str(&err))?;
        }

        let mut id_map = HashMap::new();
        for node in data.nodes.iter() {
            let new_id = self.graph.add_node(&node.type_id);
            self.graph
                .set_position(new_id, node.position.0, node.position.1);
            for (key, value) in node.params.iter() {
                self.graph.set_param(new_id, key, value.clone());
            }
            for (port_name, value) in node.input_defaults.iter() {
                self.graph.set_input_default(new_id, port_name, value.clone());
            }
            if let Some(instance) = self.graph.nodes.get_mut(new_id) {
                instance.uuid = node.id.clone();
            }
            self.uuid_map.insert(node.id.clone(), new_id);
            if let Some(def) = self.group_definitions.get(&node.type_id) {
                let group_node = GroupNode::from_definition(def.clone(), &self.registry)
                    .map_err(|err| JsValue::from_str(&err))?;
                self.nodes.insert(new_id, Arc::new(group_node));
            } else if let Some(instance) = self.registry.create(&node.type_id) {
                self.nodes.insert(new_id, instance);
            }
            id_map.insert(node.id.clone(), new_id);
        }
        for conn in data.connections.iter() {
            let from_id = id_map
                .get(&conn.from_node)
                .copied()
                .ok_or_else(|| JsValue::from_str("Invalid connection from_node"))?;
            let to_id = id_map
                .get(&conn.to_node)
                .copied()
                .ok_or_else(|| JsValue::from_str("Invalid connection to_node"))?;
            self.graph
                .connect(
                    &self.registry,
                    from_id,
                    &conn.from_port,
                    to_id,
                    &conn.to_port,
                )
                .map_err(to_js_error)?;
        }
        Ok(())
    }

    pub fn create_group_from_nodes(
        &mut self,
        node_ids: JsValue,
        name: &str,
    ) -> Result<JsValue, JsValue> {
        let node_id_strs: Vec<String> = serde_wasm_bindgen::from_value(node_ids)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let result = self
            .create_group_internal(&node_id_strs, name)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn ungroup_node(&mut self, group_node_id: &str) -> Result<JsValue, JsValue> {
        let result = self.ungroup_internal(group_node_id).map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn get_group_internal_graph(&self, group_node_id: &str) -> Result<JsValue, JsValue> {
        let result = self
            .get_group_graph_internal(group_node_id)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn update_group_interface(
        &mut self,
        group_def_id: &str,
        inputs: JsValue,
        outputs: JsValue,
    ) -> Result<JsValue, JsValue> {
        let inputs: Vec<PortSpec> = serde_wasm_bindgen::from_value(inputs)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let outputs: Vec<PortSpec> = serde_wasm_bindgen::from_value(outputs)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let spec = self
            .update_interface_internal(group_def_id, inputs, outputs)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&spec).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn rename_group(&mut self, group_def_id: &str, new_name: &str) -> Result<JsValue, JsValue> {
        let spec = self
            .rename_group_internal(group_def_id, new_name)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&spec).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn add_internal_connection(
        &mut self,
        group_def_id: &str,
        from_node: &str,
        from_port: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<JsValue, JsValue> {
        let spec = self
            .add_internal_connection_internal(group_def_id, from_node, from_port, to_node, to_port)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&spec).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn remove_internal_connection(
        &mut self,
        group_def_id: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<JsValue, JsValue> {
        let spec = self
            .remove_internal_connection_internal(group_def_id, to_node, to_port)
            .map_err(to_js_error)?;
        serde_wasm_bindgen::to_value(&spec).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    fn create_group_internal(
        &mut self,
        node_ids: &[String],
        name: &str,
    ) -> Result<CreateGroupResult, CompositorError> {
        if node_ids.is_empty() {
            return Err(CompositorError::Other(
                "No nodes selected for grouping".to_string(),
            ));
        }

        let mut selected_ids = Vec::new();
        let mut selected_set = HashSet::new();
        for nid in node_ids {
            let id = parse_node_id(&self.uuid_map, nid)?;
            if selected_set.insert(id) {
                selected_ids.push(id);
            }
        }

        struct Info {
            id: NodeId,
            type_id: String,
            params: HashMap<String, ParamValue>,
            position: (f64, f64),
        }

        let mut infos = Vec::new();
        let mut cx = 0.0;
        let mut cy = 0.0;
        for id in &selected_ids {
            let inst = self
                .graph
                .nodes
                .get(*id)
                .ok_or_else(|| CompositorError::Other("Node not found".to_string()))?;
            cx += inst.position.0;
            cy += inst.position.1;
            infos.push(Info {
                id: inst.id,
                type_id: inst.type_id.clone(),
                params: inst.params.clone(),
                position: inst.position,
            });
        }
        let count = infos.len() as f64;
        let centroid = if count > 0.0 {
            (cx / count, cy / count)
        } else {
            (0.0, 0.0)
        };

        struct Incoming {
            ext_from: NodeId,
            ext_from_port: String,
            int_to: String,
            int_to_port: String,
            port_name: String,
        }
        struct Outgoing {
            ext_to: NodeId,
            ext_to_port: String,
            int_from: String,
            int_from_port: String,
            port_name: String,
        }

        let mut int_conns = Vec::new();
        let mut incoming = Vec::new();
        let mut outgoing = Vec::new();
        let mut in_counts: HashMap<String, usize> = HashMap::new();
        let mut out_counts: HashMap<String, usize> = HashMap::new();

        for conn in self.graph.connections() {
            let from_sel = selected_set.contains(&conn.from_node);
            let to_sel = selected_set.contains(&conn.to_node);
            if from_sel && to_sel {
                int_conns.push(InternalConnection {
                    from_node: format_node_id(&self.graph, conn.from_node),
                    from_port: conn.from_port.clone(),
                    to_node: format_node_id(&self.graph, conn.to_node),
                    to_port: conn.to_port.clone(),
                });
            } else if !from_sel && to_sel {
                let to_inst = self
                    .graph
                    .nodes
                    .get(conn.to_node)
                    .ok_or_else(|| CompositorError::Other("Node not found".to_string()))?;
                let base = format!("{}_{}", to_inst.type_id, conn.to_port);
                let pn = unique_port_name(&base, &mut in_counts);
                incoming.push(Incoming {
                    ext_from: conn.from_node,
                    ext_from_port: conn.from_port.clone(),
                    int_to: format_node_id(&self.graph, conn.to_node),
                    int_to_port: conn.to_port.clone(),
                    port_name: pn,
                });
            } else if from_sel && !to_sel {
                let from_inst = self
                    .graph
                    .nodes
                    .get(conn.from_node)
                    .ok_or_else(|| CompositorError::Other("Node not found".to_string()))?;
                let base = format!("{}_{}", from_inst.type_id, conn.from_port);
                let pn = unique_port_name(&base, &mut out_counts);
                outgoing.push(Outgoing {
                    ext_to: conn.to_node,
                    ext_to_port: conn.to_port.clone(),
                    int_from: format_node_id(&self.graph, conn.from_node),
                    int_from_port: conn.from_port.clone(),
                    port_name: pn,
                });
            }
        }

        let mut int_nodes = Vec::new();
        let mut min_x = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut avg_y = 0.0;
        let node_count = infos.len() as f64;
        for info in &infos {
            let ox = info.position.0 - centroid.0;
            let oy = info.position.1 - centroid.1;
            if ox < min_x {
                min_x = ox;
            }
            if ox > max_x {
                max_x = ox;
            }
            avg_y += oy;
            let mut params = info.params.clone();
            params.insert("__group_offset_x".to_string(), ParamValue::Float(ox));
            params.insert("__group_offset_y".to_string(), ParamValue::Float(oy));
            let image_data = if info.type_id == "load_image" {
                self.nodes
                    .get(&info.id)
                    .and_then(|node_arc| node_arc.as_any().downcast_ref::<LoadImage>())
                    .and_then(|load_node| load_node.get_image_bytes())
            } else {
                None
            };
            int_nodes.push(InternalNode {
                id: format_node_id(&self.graph, info.id),
                type_id: info.type_id.clone(),
                params,
                image_data,
            });
        }
        avg_y /= node_count;
        let node_width = 200.0;
        let padding = 100.0;

        let mut gi_params = HashMap::new();
        gi_params.insert(
            "__group_offset_x".to_string(),
            ParamValue::Float(min_x - node_width - padding),
        );
        gi_params.insert("__group_offset_y".to_string(), ParamValue::Float(avg_y));
        int_nodes.push(InternalNode {
            id: "gi".to_string(),
            type_id: "group_input".to_string(),
            params: gi_params,
            image_data: None,
        });

        let mut go_params = HashMap::new();
        go_params.insert(
            "__group_offset_x".to_string(),
            ParamValue::Float(max_x + node_width + padding),
        );
        go_params.insert("__group_offset_y".to_string(), ParamValue::Float(avg_y));
        int_nodes.push(InternalNode {
            id: "go".to_string(),
            type_id: "group_output".to_string(),
            params: go_params,
            image_data: None,
        });

        for b in &incoming {
            int_conns.push(InternalConnection {
                from_node: "gi".to_string(),
                from_port: b.port_name.clone(),
                to_node: b.int_to.clone(),
                to_port: b.int_to_port.clone(),
            });
        }
        for b in &outgoing {
            int_conns.push(InternalConnection {
                from_node: b.int_from.clone(),
                from_port: b.int_from_port.clone(),
                to_node: "go".to_string(),
                to_port: b.port_name.clone(),
            });
        }

        let gd_id = format!("group::user_{}", Uuid::new_v4());
        let definition = GroupDefinition {
            id: gd_id.clone(),
            name: name.to_string(),
            category: "User".to_string(),
            description: "User-defined group".to_string(),
            internal_graph: SerializableInternalGraph {
                nodes: int_nodes,
                connections: int_conns,
            },
            promotions: Vec::new(),
            is_builtin: false,
            explicit_inputs: None,
            explicit_outputs: None,
        };

        let new_spec = self
            .register_group(definition)
            .map_err(CompositorError::Other)?;

        let removed: Vec<String> = selected_ids
            .iter()
            .map(|id| format_node_id(&self.graph, *id))
            .collect();
        for id in &selected_ids {
            if let Some(uuid) = self.graph.nodes.get(*id).map(|node| node.uuid.clone()) {
                self.uuid_map.remove(&uuid);
            }
            self.graph.remove_node(*id);
            self.nodes.remove(id);
        }

        let (gn_id_str, _) = self.add_node_internal(&gd_id, centroid.0, centroid.1)
            .ok_or_else(|| CompositorError::Other(
                "Failed to create group node".to_string(),
            ))?;
        let gn_id = parse_node_id(&self.uuid_map, &gn_id_str)?;

        for b in &incoming {
            self.graph.connect(
                &self.registry,
                b.ext_from,
                &b.ext_from_port,
                gn_id,
                &b.port_name,
            )?;
        }
        for b in &outgoing {
            self.graph.connect(
                &self.registry,
                gn_id,
                &b.port_name,
                b.ext_to,
                &b.ext_to_port,
            )?;
        }

        Ok(CreateGroupResult {
            group_definition_id: gd_id,
            group_node_id: gn_id_str,
            removed_node_ids: removed,
            new_spec,
        })
    }

    fn ungroup_internal(&mut self, group_node_id: &str) -> Result<UngroupResult, CompositorError> {
        let gid = parse_node_id(&self.uuid_map, group_node_id)?;
        let inst = self
            .graph
            .nodes
            .get(gid)
            .ok_or_else(|| CompositorError::Other("Node not found".to_string()))?;
        let type_id = inst.type_id.clone();
        let gdef = self
            .group_definitions
            .get(&type_id)
            .cloned()
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let gpos = inst.position;

        struct ExtConn {
            from_node: NodeId,
            from_port: String,
            to_node: NodeId,
            to_port: String,
        }

        let mut incoming = Vec::new();
        let mut outgoing_ext = Vec::new();
        for conn in self.graph.connections() {
            if conn.to_node == gid {
                incoming.push(ExtConn {
                    from_node: conn.from_node,
                    from_port: conn.from_port.clone(),
                    to_node: conn.to_node,
                    to_port: conn.to_port.clone(),
                });
            } else if conn.from_node == gid {
                outgoing_ext.push(ExtConn {
                    from_node: conn.from_node,
                    from_port: conn.from_port.clone(),
                    to_node: conn.to_node,
                    to_port: conn.to_port.clone(),
                });
            }
        }

        if let Some(uuid) = self.graph.nodes.get(gid).map(|node| node.uuid.clone()) {
            self.uuid_map.remove(&uuid);
        }
        self.graph.remove_node(gid);
        self.nodes.remove(&gid);

        let (gi_id, go_id) = find_group_nodes(gdef.as_ref()).map_err(CompositorError::Other)?;

        let mut in_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut out_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for conn in &gdef.internal_graph.connections {
            if conn.from_node == gi_id {
                in_map
                    .entry(conn.from_port.clone())
                    .or_default()
                    .push((conn.to_node.clone(), conn.to_port.clone()));
            }
            if conn.to_node == go_id {
                out_map
                    .entry(conn.to_port.clone())
                    .or_default()
                    .push((conn.from_node.clone(), conn.from_port.clone()));
            }
        }

        let mut id_map: HashMap<String, NodeId> = HashMap::new();
        let mut restored = Vec::new();

        for internal in &gdef.internal_graph.nodes {
            if internal.type_id == "group_input" || internal.type_id == "group_output" {
                continue;
            }
            let ox = match internal.params.get("__group_offset_x") {
                Some(ParamValue::Float(v)) => *v,
                _ => 0.0,
            };
            let oy = match internal.params.get("__group_offset_y") {
                Some(ParamValue::Float(v)) => *v,
                _ => 0.0,
            };
            let pos = (gpos.0 + ox, gpos.1 + oy);
            let (new_str, _) = self.add_node_internal(&internal.type_id, pos.0, pos.1)
                .ok_or_else(|| CompositorError::Other("Failed to restore node".to_string()))?;
            let new_id = parse_node_id(&self.uuid_map, &new_str)?;
            let mut params = internal.params.clone();
            params.remove("__group_offset_x");
            params.remove("__group_offset_y");
            for (k, v) in &params {
                self.graph.set_param(new_id, k, v.clone());
            }
            id_map.insert(internal.id.clone(), new_id);
            restored.push(RestoredNode {
                id: new_str,
                type_id: internal.type_id.clone(),
                position: pos,
                params,
            });
        }

        for conn in &gdef.internal_graph.connections {
            if conn.from_node == gi_id || conn.to_node == go_id {
                continue;
            }
            if conn.from_node == go_id || conn.to_node == gi_id {
                continue;
            }
            let fid = id_map
                .get(&conn.from_node)
                .copied()
                .ok_or_else(|| CompositorError::Other("Internal node not restored".to_string()))?;
            let tid = id_map
                .get(&conn.to_node)
                .copied()
                .ok_or_else(|| CompositorError::Other("Internal node not restored".to_string()))?;
            self.graph
                .connect(&self.registry, fid, &conn.from_port, tid, &conn.to_port)?;
        }

        for ec in &incoming {
            if let Some(targets) = in_map.get(&ec.to_port) {
                for (iid, iport) in targets {
                    if let Some(nid) = id_map.get(iid) {
                        self.graph.connect(
                            &self.registry,
                            ec.from_node,
                            &ec.from_port,
                            *nid,
                            iport,
                        )?;
                    }
                }
            }
        }
        for ec in &outgoing_ext {
            if let Some(sources) = out_map.get(&ec.from_port) {
                for (iid, iport) in sources {
                    if let Some(nid) = id_map.get(iid) {
                        self.graph
                            .connect(&self.registry, *nid, iport, ec.to_node, &ec.to_port)?;
                    }
                }
            }
        }

        Ok(UngroupResult {
            restored_nodes: restored,
            removed_group_node_id: group_node_id.to_string(),
        })
    }

    fn get_group_graph_internal(
        &self,
        group_node_id: &str,
    ) -> Result<GroupInternalGraph, CompositorError> {
        let gid = parse_node_id(&self.uuid_map, group_node_id)?;
        let inst = self
            .graph
            .nodes
            .get(gid)
            .ok_or_else(|| CompositorError::Other("Node not found".to_string()))?;
        let gdef = self
            .group_definitions
            .get(&inst.type_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let interface =
            GroupNode::derive_interface(gdef, &self.registry).map_err(CompositorError::Other)?;

        let mut nodes = Vec::new();
        for internal in &gdef.internal_graph.nodes {
            let ox = match internal.params.get("__group_offset_x") {
                Some(ParamValue::Float(v)) => *v,
                _ => 0.0,
            };
            let oy = match internal.params.get("__group_offset_y") {
                Some(ParamValue::Float(v)) => *v,
                _ => 0.0,
            };
            let mut params = internal.params.clone();
            params.remove("__group_offset_x");
            params.remove("__group_offset_y");
            nodes.push(InternalGraphNode {
                id: internal.id.clone(),
                type_id: internal.type_id.clone(),
                params,
                position: (ox, oy),
            });
        }

        let connections = gdef
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
            group_def_id: gdef.id.clone(),
            name: gdef.name.clone(),
            nodes,
            connections,
            inputs: interface.inputs,
            outputs: interface.outputs,
        })
    }

    fn update_interface_internal(
        &mut self,
        group_def_id: &str,
        inputs: Vec<PortSpec>,
        outputs: Vec<PortSpec>,
    ) -> Result<NodeSpec, CompositorError> {
        let existing = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let mut updated = (*existing.as_ref()).clone();
        let (gi_id, go_id) = find_group_nodes(&updated).map_err(CompositorError::Other)?;

        let in_names: HashSet<String> = inputs.iter().map(|p| p.name.clone()).collect();
        let out_names: HashSet<String> = outputs.iter().map(|p| p.name.clone()).collect();

        updated.internal_graph.connections.retain(|conn| {
            if conn.from_node == gi_id {
                return in_names.contains(&conn.from_port);
            }
            if conn.to_node == go_id {
                return out_names.contains(&conn.to_port);
            }
            true
        });

        updated.explicit_inputs = Some(inputs);
        updated.explicit_outputs = Some(outputs);

        let spec = self
            .register_group(updated)
            .map_err(CompositorError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;

        let gn_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, n)| n.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for nid in gn_ids {
            let gn = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CompositorError::Other)?;
            self.nodes.insert(nid, Arc::new(gn));
            self.graph.prune_connections_for_node(nid, &self.registry);
        }

        Ok(spec)
    }

    fn rename_group_internal(
        &mut self,
        group_def_id: &str,
        new_name: &str,
    ) -> Result<NodeSpec, CompositorError> {
        let existing = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let mut updated = (*existing.as_ref()).clone();
        updated.name = new_name.to_string();
        let spec = self.register_group(updated).map_err(CompositorError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, n)| n.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();
        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CompositorError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
        }

        Ok(spec)
    }

    fn add_internal_connection_internal(
        &mut self,
        group_def_id: &str,
        from_node: &str,
        from_port: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<NodeSpec, CompositorError> {
        let existing = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let mut updated = (*existing.as_ref()).clone();

        let (gi_id, go_id) = find_group_nodes(&updated).map_err(CompositorError::Other)?;

        let from_internal = updated
            .internal_graph
            .nodes
            .iter()
            .find(|node| node.id == from_node)
            .ok_or_else(|| {
                CompositorError::Other(format!("Internal node not found: {}", from_node))
            })?;
        let to_internal = updated
            .internal_graph
            .nodes
            .iter()
            .find(|node| node.id == to_node)
            .ok_or_else(|| {
                CompositorError::Other(format!("Internal node not found: {}", to_node))
            })?;

        updated
            .internal_graph
            .connections
            .retain(|conn| !(conn.to_node == to_node && conn.to_port == to_port));

        updated.internal_graph.connections.push(InternalConnection {
            from_node: from_node.to_string(),
            from_port: from_port.to_string(),
            to_node: to_node.to_string(),
            to_port: to_port.to_string(),
        });

        let interface = GroupNode::derive_interface(&updated, &self.registry)
            .map_err(CompositorError::Other)?;

        let from_port_spec = if from_node == gi_id {
            interface
                .inputs
                .iter()
                .find(|port| port.name == from_port)
                .ok_or_else(|| CompositorError::PortNotFound {
                    node_type: from_internal.type_id.clone(),
                    port_name: from_port.to_string(),
                })?
        } else {
            let from_spec = self
                .registry
                .get_spec(&from_internal.type_id)
                .ok_or_else(|| {
                    CompositorError::InvalidConnection(format!(
                        "Unknown node type: {}",
                        from_internal.type_id
                    ))
                })?;
            from_spec
                .outputs
                .iter()
                .find(|port| port.name == from_port)
                .ok_or_else(|| CompositorError::PortNotFound {
                    node_type: from_internal.type_id.clone(),
                    port_name: from_port.to_string(),
                })?
        };

        let to_port_spec = if to_node == go_id {
            interface
                .outputs
                .iter()
                .find(|port| port.name == to_port)
                .ok_or_else(|| CompositorError::PortNotFound {
                    node_type: to_internal.type_id.clone(),
                    port_name: to_port.to_string(),
                })?
        } else {
            let to_spec = self
                .registry
                .get_spec(&to_internal.type_id)
                .ok_or_else(|| {
                    CompositorError::InvalidConnection(format!(
                        "Unknown node type: {}",
                        to_internal.type_id
                    ))
                })?;
            to_spec
                .inputs
                .iter()
                .find(|port| port.name == to_port)
                .ok_or_else(|| CompositorError::PortNotFound {
                    node_type: to_internal.type_id.clone(),
                    port_name: to_port.to_string(),
                })?
        };

        if !compositor_core::graph::types_compatible(&from_port_spec.ty, &to_port_spec.ty) {
            return Err(CompositorError::TypeMismatch {
                expected: format!("{:?}", to_port_spec.ty),
                got: format!("{:?}", from_port_spec.ty),
            });
        }

        let spec = self
            .register_group(updated)
            .map_err(CompositorError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;

        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, n)| n.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CompositorError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
        }

        Ok(spec)
    }

    fn remove_internal_connection_internal(
        &mut self,
        group_def_id: &str,
        to_node: &str,
        to_port: &str,
    ) -> Result<NodeSpec, CompositorError> {
        let existing = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;
        let mut updated = (*existing.as_ref()).clone();

        updated
            .internal_graph
            .connections
            .retain(|conn| !(conn.to_node == to_node && conn.to_port == to_port));

        let spec = self
            .register_group(updated)
            .map_err(CompositorError::Other)?;

        let def_arc = self
            .group_definitions
            .get(group_def_id)
            .ok_or_else(|| CompositorError::Other("Group definition not found".to_string()))?;

        let group_node_ids: Vec<NodeId> = self
            .graph
            .nodes
            .iter()
            .filter(|(_, n)| n.type_id == group_def_id)
            .map(|(id, _)| id)
            .collect();

        for node_id in group_node_ids {
            let group_node = GroupNode::from_definition(def_arc.clone(), &self.registry)
                .map_err(CompositorError::Other)?;
            self.nodes.insert(node_id, Arc::new(group_node));
            self.graph
                .prune_connections_for_node(node_id, &self.registry);
        }

        Ok(spec)
    }
}

#[derive(Serialize, Deserialize)]
struct SerializableGraph {
    nodes: Vec<SerializableNode>,
    connections: Vec<SerializableConnection>,
    #[serde(default)]
    group_definitions: Vec<GroupDefinition>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGroupResult {
    group_definition_id: String,
    group_node_id: String,
    removed_node_ids: Vec<String>,
    new_spec: NodeSpec,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UngroupResult {
    restored_nodes: Vec<RestoredNode>,
    removed_group_node_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoredNode {
    id: String,
    type_id: String,
    position: (f64, f64),
    params: HashMap<String, ParamValue>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupInternalGraph {
    group_def_id: String,
    name: String,
    nodes: Vec<InternalGraphNode>,
    connections: Vec<InternalGraphConnection>,
    inputs: Vec<PortSpec>,
    outputs: Vec<PortSpec>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InternalGraphNode {
    id: String,
    type_id: String,
    params: HashMap<String, ParamValue>,
    position: (f64, f64),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InternalGraphConnection {
    from_node: String,
    from_port: String,
    to_node: String,
    to_port: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddNodeResult {
    id: String,
    type_id: String,
}

#[derive(Serialize, Deserialize)]
struct SerializableNode {
    id: String,
    type_id: String,
    params: HashMap<String, ParamValue>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    input_defaults: HashMap<String, ParamValue>,
    position: (f64, f64),
}

#[derive(Serialize, Deserialize)]
struct SerializableConnection {
    from_node: String,
    from_port: String,
    to_node: String,
    to_port: String,
}

#[derive(Serialize, Deserialize)]
struct RenderDimensions {
    width: u32,
    height: u32,
}

fn format_node_id(graph: &Graph, id: NodeId) -> String {
    graph
        .nodes
        .get(id)
        .map(|node| node.uuid.clone())
        .unwrap_or_default()
}

fn parse_node_id(uuid_map: &HashMap<String, NodeId>, id: &str) -> Result<NodeId, CompositorError> {
    if let Some(node_id) = uuid_map.get(id) {
        return Ok(*node_id);
    }
    let value = id
        .parse::<u64>()
        .map_err(|_| CompositorError::Other("Invalid node id".to_string()))?;
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

fn find_group_nodes(definition: &GroupDefinition) -> Result<(String, String), String> {
    let mut gi = None;
    let mut go = None;
    for node in &definition.internal_graph.nodes {
        if node.type_id == "group_input" {
            gi = Some(node.id.clone());
        }
        if node.type_id == "group_output" {
            go = Some(node.id.clone());
        }
    }
    let gi = gi.ok_or_else(|| "Group input node missing".to_string())?;
    let go = go.ok_or_else(|| "Group output node missing".to_string())?;
    Ok((gi, go))
}

fn convert_param_value(
    param_spec: Option<&compositor_core::types::ParamSpec>,
    value: JsValue,
) -> Result<ParamValue, JsValue> {
    if let Some(spec) = param_spec {
        match spec.ty {
            compositor_core::types::ValueType::Bool => {
                if let Some(v) = value.as_bool() {
                    return Ok(ParamValue::Bool(v));
                }
            }
            compositor_core::types::ValueType::Int => {
                if let Some(v) = value.as_f64() {
                    return Ok(ParamValue::Int(v as i64));
                }
            }
            compositor_core::types::ValueType::Float => {
                if let Some(v) = value.as_f64() {
                    return Ok(ParamValue::Float(v));
                }
            }
            compositor_core::types::ValueType::Color => {
                if matches!(spec.ui_hint, compositor_core::types::UiHint::ColorPalette) {
                    if Array::is_array(&value) {
                        let outer = Array::from(&value);
                        let mut colors = Vec::with_capacity(outer.length() as usize);
                        for i in 0..outer.length() {
                            let inner = Array::from(&outer.get(i));
                            if inner.length() == 4 {
                                let mut c = [0.0f64; 4];
                                for j in 0..4 {
                                    c[j as usize] = inner.get(j as u32).as_f64()
                                        .ok_or_else(|| JsValue::from_str("Invalid palette color component"))?;
                                }
                                colors.push(c);
                            }
                        }
                        return Ok(ParamValue::ColorPalette(colors));
                    }
                }
                if Array::is_array(&value) {
                    let array = Array::from(&value);
                    if array.length() == 4 {
                        let mut out = [0.0f64; 4];
                        for i in 0..4 {
                            out[i] = array
                                .get(i as u32)
                                .as_f64()
                                .ok_or_else(|| JsValue::from_str("Invalid color component"))?;
                        }
                        return Ok(ParamValue::Color(out));
                    }
                }
            }
            _ => {}
        }
    }

    if let Some(v) = value.as_bool() {
        return Ok(ParamValue::Bool(v));
    }
    if let Some(v) = value.as_f64() {
        return Ok(ParamValue::Float(v));
    }
    if let Some(v) = value.as_string() {
        return Ok(ParamValue::String(v));
    }
    if Array::is_array(&value) {
        let array = Array::from(&value);
        if array.length() == 4 {
            let mut out = [0.0f64; 4];
            for i in 0..4 {
                out[i] = array
                    .get(i as u32)
                    .as_f64()
                    .ok_or_else(|| JsValue::from_str("Invalid color component"))?;
            }
            return Ok(ParamValue::Color(out));
        }
    }
    Err(JsValue::from_str("Unsupported parameter value"))
}

fn to_js_error(err: CompositorError) -> JsValue {
    JsValue::from_str(&err.to_string())
}

fn to_js_error_str(err: String) -> JsValue {
    JsValue::from_str(&err)
}
