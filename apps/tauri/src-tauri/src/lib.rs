mod menu;
mod project_package;

use base64::{engine::general_purpose, Engine as _};
use cascade_runtime::{
    migrations, AssetReference, CascadeDocument, Engine, NodeSpec, ParamValue, PortSpec,
    SerializableGraph, UiNodeSpec, ViewerRenderResult,
};
use project_package::{read_asset_blob, AssetBlob};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::ipc::Response;
use tauri::State;

struct AppState {
    engine: Engine,
    project_assets: HashMap<String, AssetReference>,
    packed_asset_bytes: HashMap<String, Vec<u8>>,
}

type EngineState = Arc<Mutex<AppState>>;

fn write_viewer_render_result(buf: &mut Vec<u8>, result: &ViewerRenderResult) {
    match result {
        ViewerRenderResult::Image(render) => {
            buf.push(0);
            buf.extend_from_slice(&render.width.to_le_bytes());
            buf.extend_from_slice(&render.height.to_le_bytes());
            buf.extend_from_slice(&render.pixels);
        }
        ViewerRenderResult::Compare(render) => {
            buf.push(1);
            buf.extend_from_slice(&render.width.to_le_bytes());
            buf.extend_from_slice(&render.height.to_le_bytes());
            buf.extend_from_slice(&render.before_pixels);
            buf.extend_from_slice(&render.after_pixels);
        }
    }
}

fn viewer_render_result_size(result: &ViewerRenderResult) -> usize {
    match result {
        ViewerRenderResult::Image(render) => 1 + 8 + render.pixels.len(),
        ViewerRenderResult::Compare(render) => {
            1 + 8 + render.before_pixels.len() + render.after_pixels.len()
        }
    }
}

fn strip_file_url(path: &str) -> String {
    path.strip_prefix("file://").unwrap_or(path).to_string()
}

fn param_string(
    params: &std::collections::HashMap<String, ParamValue>,
    key: &str,
) -> Option<String> {
    match params.get(key) {
        Some(ParamValue::String(value)) if !value.is_empty() => Some(value.clone()),
        _ => None,
    }
}

fn resolve_project_path(project_dir: &Path, path: &str) -> PathBuf {
    let stripped = strip_file_url(path);
    let path = PathBuf::from(stripped);
    if path.is_absolute() {
        path
    } else {
        project_dir.join(path)
    }
}

fn original_filename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string()
}

fn external_asset_ref(asset_type: &str, path: String, original_filename: String) -> AssetReference {
    AssetReference {
        asset_type: asset_type.to_string(),
        source: "external".to_string(),
        path,
        original_filename,
        hash: String::new(),
        uri: String::new(),
        data: String::new(),
    }
}

fn packed_asset_ref(
    asset_type: &str,
    blob: &AssetBlob,
    original_filename: String,
) -> AssetReference {
    AssetReference {
        asset_type: asset_type.to_string(),
        source: "packed".to_string(),
        path: blob.package_path.clone(),
        original_filename,
        hash: blob.hash.clone(),
        uri: format!("asset://sha256/{}", blob.hash),
        data: String::new(),
    }
}

fn embedded_asset_ref(
    asset_type: &str,
    blob: &AssetBlob,
    original_filename: String,
) -> AssetReference {
    AssetReference {
        asset_type: asset_type.to_string(),
        source: "embedded".to_string(),
        path: String::new(),
        original_filename,
        hash: blob.hash.clone(),
        uri: format!("asset://sha256/{}", blob.hash),
        data: general_purpose::STANDARD.encode(&blob.bytes),
    }
}

fn is_asset_uri(path: &str) -> bool {
    path.starts_with("asset://sha256/")
}

fn missing_ai_result_error(message: &str) -> bool {
    message.contains("No cached AI result") || message.contains("No image in cached AI result")
}

fn cached_ai_result_blob(engine: &Engine, node_id: &str) -> Result<Option<AssetBlob>, String> {
    match engine.get_ai_node_image_data(node_id) {
        Ok(bytes) if bytes.is_empty() => Ok(None),
        Ok(bytes) => {
            let fallback = PathBuf::from(format!("{node_id}.png"));
            Ok(Some(project_package::make_asset_blob(&fallback, bytes)))
        }
        Err(err) => {
            let message = err.to_string();
            if missing_ai_result_error(&message) {
                Ok(None)
            } else {
                Err(message)
            }
        }
    }
}

#[tauri::command]
fn list_node_types(state: State<'_, EngineState>) -> Result<String, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    let specs: Vec<UiNodeSpec> = engine
        .engine
        .list_node_types()
        .into_iter()
        .map(UiNodeSpec::from)
        .collect();
    serde_json::to_string(&specs).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_node(
    state: State<'_, EngineState>,
    type_id: String,
    x: f64,
    y: f64,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let (id, actual_type_id) = s
        .engine
        .add_node(&type_id, x, y)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&serde_json::json!({ "id": id, "typeId": actual_type_id }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_node(state: State<'_, EngineState>, node_id: String) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.remove_node(&node_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn connect(
    state: State<'_, EngineState>,
    from_node: String,
    from_port: String,
    to_node: String,
    to_port: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .connect(&from_node, &from_port, &to_node, &to_port)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn disconnect(
    state: State<'_, EngineState>,
    to_node: String,
    to_port: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .disconnect(&to_node, &to_port)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_param(
    state: State<'_, EngineState>,
    node_id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let param_value: cascade_runtime::ParamValue =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    s.engine
        .set_param(&node_id, &key, param_value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_input_default(
    state: State<'_, EngineState>,
    node_id: String,
    port_name: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let param_value: cascade_runtime::ParamValue =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    s.engine
        .set_input_default(&node_id, &port_name, param_value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_position(
    state: State<'_, EngineState>,
    node_id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .set_position(&node_id, x, y)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_muted(state: State<'_, EngineState>, node_id: String, muted: bool) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .set_muted(&node_id, muted)
        .map_err(|e| e.to_string())
}

/// Receives raw image file bytes via the request body. Node ID passed in x-node-id header.
#[tauri::command]
fn load_image_data(
    state: State<'_, EngineState>,
    request: tauri::ipc::Request,
) -> Result<String, String> {
    let node_id = request
        .headers()
        .get("x-node-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing x-node-id header".to_string())?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected raw body with image data".to_string());
    };
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let change = s
        .engine
        .load_image_data(&node_id, data)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&change).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_image_path(
    state: State<'_, EngineState>,
    node_id: String,
    path: String,
) -> Result<String, String> {
    let normalized = strip_file_url(&path);
    let data = std::fs::read(&normalized).map_err(|e| e.to_string())?;
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let change = s
        .engine
        .load_image_data(&node_id, &data)
        .map_err(|e| e.to_string())?;
    let source = if path.starts_with("file://") {
        path
    } else {
        format!("file://{normalized}")
    };
    s.engine
        .set_param(&node_id, "path", ParamValue::String(source))
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&change).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_palette_data(
    state: State<'_, EngineState>,
    request: tauri::ipc::Request,
) -> Result<String, String> {
    let node_id = request
        .headers()
        .get("x-node-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing x-node-id header".to_string())?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected raw body with palette data".to_string());
    };
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let colors = s
        .engine
        .load_palette_data(&node_id, data)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&colors).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_image_data(state: State<'_, EngineState>, node_id: String) -> Result<Response, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let bytes = s
        .engine
        .get_image_data(&node_id)
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Returns raw RGBA8 pixels prefixed with [width_le32][height_le32].
/// Frontend receives an ArrayBuffer: first 8 bytes are dimensions, rest is pixel data.
#[tauri::command]
fn render_viewer(
    state: State<'_, EngineState>,
    viewer_node_id: String,
    frame: u64,
    preview_scale: Option<f32>,
) -> Result<Response, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .render_viewer_result_scaled(&viewer_node_id, frame, preview_scale.unwrap_or(1.0))
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::with_capacity(viewer_render_result_size(&result));
    write_viewer_render_result(&mut buf, &result);
    Ok(Response::new(buf))
}

#[tauri::command]
fn render_internal_viewer(
    state: State<'_, EngineState>,
    group_node_id: String,
    internal_viewer_id: String,
    frame: u64,
    preview_scale: Option<f32>,
) -> Result<Response, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .render_internal_viewer_result_scaled(
            &group_node_id,
            &internal_viewer_id,
            frame,
            preview_scale.unwrap_or(1.0),
        )
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::with_capacity(viewer_render_result_size(&result));
    write_viewer_render_result(&mut buf, &result);
    Ok(Response::new(buf))
}

/// Batched: set param + render all viewers in one IPC call.
/// Response binary format:
/// [u32 viewer_count LE]
/// For each viewer: [u32 id_len LE][utf8 id bytes][u8 kind][payload]
/// kind 0 payload: [u32 width LE][u32 height LE][RGBA8 pixels]
/// kind 1 payload: [u32 width LE][u32 height LE][before RGBA8 pixels][after RGBA8 pixels]
#[tauri::command]
fn set_param_and_render(
    state: State<'_, EngineState>,
    node_id: String,
    key: String,
    value: serde_json::Value,
    frame: u64,
    preview_scale: Option<f32>,
) -> Result<Response, String> {
    let t0 = Instant::now();
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let param_value: cascade_runtime::ParamValue =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    let results = s
        .engine
        .set_param_and_render_viewer_results_scaled(
            &node_id,
            &key,
            param_value,
            frame,
            preview_scale.unwrap_or(1.0),
        )
        .map_err(|e| e.to_string())?;
    let elapsed = t0.elapsed();
    eprintln!(
        "[perf] set_param_and_render: {:.1}ms ({} viewers)",
        elapsed.as_secs_f64() * 1000.0,
        results.len()
    );

    let total_size: usize = 4 + results
        .iter()
        .map(|(id, r)| 4 + id.len() + viewer_render_result_size(r))
        .sum::<usize>();
    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(results.len() as u32).to_le_bytes());
    for (id, r) in &results {
        buf.extend_from_slice(&(id.len() as u32).to_le_bytes());
        buf.extend_from_slice(id.as_bytes());
        write_viewer_render_result(&mut buf, r);
    }
    Ok(Response::new(buf))
}

#[tauri::command]
fn set_input_default_and_render(
    state: State<'_, EngineState>,
    node_id: String,
    port_name: String,
    value: serde_json::Value,
    frame: u64,
    preview_scale: Option<f32>,
) -> Result<Response, String> {
    let t0 = Instant::now();
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let param_value: cascade_runtime::ParamValue =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    let results = s
        .engine
        .set_input_default_and_render_viewer_results_scaled(
            &node_id,
            &port_name,
            param_value,
            frame,
            preview_scale.unwrap_or(1.0),
        )
        .map_err(|e| e.to_string())?;
    let elapsed = t0.elapsed();
    eprintln!(
        "[perf] set_input_default_and_render: {:.1}ms ({} viewers)",
        elapsed.as_secs_f64() * 1000.0,
        results.len()
    );

    let total_size: usize = 4 + results
        .iter()
        .map(|(id, r)| 4 + id.len() + viewer_render_result_size(r))
        .sum::<usize>();
    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(results.len() as u32).to_le_bytes());
    for (id, r) in &results {
        buf.extend_from_slice(&(id.len() as u32).to_le_bytes());
        buf.extend_from_slice(id.as_bytes());
        write_viewer_render_result(&mut buf, r);
    }
    Ok(Response::new(buf))
}

#[tauri::command]
fn export_graph(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let graph = s.engine.export_graph();
    serde_json::to_string(&graph).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_graph(state: State<'_, EngineState>, data: String) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let graph: SerializableGraph = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    s.engine.import_graph(graph).map_err(|e| e.to_string())?;
    s.project_assets.clear();
    s.packed_asset_bytes.clear();
    Ok(())
}

#[tauri::command]
fn save_project(
    state: State<'_, EngineState>,
    path: String,
    dsl: Option<serde_json::Value>,
    bundle_media: Option<bool>,
    asset_storage: Option<String>,
) -> Result<Option<String>, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let retained_assets = s.project_assets.clone();
    let retained_bytes = s.packed_asset_bytes.clone();
    let mut document = s.engine.export_document();
    document.asset_storage = asset_storage;
    if let Some(dsl) = dsl {
        document.dsl = serde_json::from_value(dsl).ok();
    }

    let file_path = std::path::Path::new(&path);
    if let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) {
        document.project.name = stem.to_string();
    }

    let project_dir = file_path.parent().unwrap_or(std::path::Path::new("."));
    let mut package_assets = Vec::new();
    if bundle_media.unwrap_or(false) {
        document.asset_storage = Some("bundled".to_string());
        collect_packed_assets(
            &s.engine,
            &mut document,
            &mut package_assets,
            &retained_assets,
            &retained_bytes,
        )?;
        project_package::apply_packed_asset_uris(&mut document);
        project_package::write_project_package(file_path, &document, &package_assets)?;
        s.project_assets = document
            .assets
            .iter()
            .map(|(key, asset_ref)| (key.clone(), clone_asset_reference(asset_ref)))
            .collect();
        s.packed_asset_bytes = package_assets
            .iter()
            .map(|asset| (asset.package_path.clone(), asset.bytes.clone()))
            .collect();
        return serde_json::to_string(&document)
            .map(Some)
            .map_err(|e| e.to_string());
    }

    document.asset_storage = Some("external".to_string());
    collect_external_asset_refs(
        &s.engine,
        project_dir,
        &mut document,
        &retained_assets,
        &retained_bytes,
    )?;
    let json = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    s.project_assets = document
        .assets
        .iter()
        .map(|(key, asset_ref)| (key.clone(), clone_asset_reference(asset_ref)))
        .collect();
    s.packed_asset_bytes.clear();
    Ok(None)
}

fn collect_external_asset_refs(
    engine: &Engine,
    project_dir: &Path,
    document: &mut CascadeDocument,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    document.assets.clear();
    for node in &document.graph.nodes {
        match node.type_id.as_str() {
            "load_image" => {
                if let Some(path) = param_string(&node.params, "path") {
                    if is_asset_uri(&path) {
                        if let Some(asset_ref) = embedded_asset_for_node(
                            engine,
                            &node.id,
                            "image",
                            &path,
                            retained_assets,
                            retained_bytes,
                        )? {
                            document.assets.insert(node.id.clone(), asset_ref);
                        }
                    } else {
                        let resolved = resolve_project_path(project_dir, &path);
                        document.assets.insert(
                            node.id.clone(),
                            external_asset_ref("image", path, original_filename(&resolved)),
                        );
                    }
                }
            }
            "load_image_sequence" => {
                if let Some(directory) = param_string(&node.params, "directory") {
                    if is_asset_uri(&directory) {
                        for (key, asset_ref) in
                            embedded_sequence_assets(&node.id, retained_assets, retained_bytes)?
                        {
                            document.assets.insert(key, asset_ref);
                        }
                    } else {
                        let pattern = param_string(&node.params, "pattern").unwrap_or_default();
                        document.assets.insert(
                            node.id.clone(),
                            external_asset_ref("image_sequence", directory, pattern),
                        );
                    }
                }
            }
            "load_video" => {
                if let Some(path) = param_string(&node.params, "file_path") {
                    if is_asset_uri(&path) {
                        if let Some(asset_ref) = embedded_asset_for_node(
                            engine,
                            &node.id,
                            "video",
                            &path,
                            retained_assets,
                            retained_bytes,
                        )? {
                            document.assets.insert(node.id.clone(), asset_ref);
                        }
                    } else {
                        let resolved = resolve_project_path(project_dir, &path);
                        document.assets.insert(
                            node.id.clone(),
                            external_asset_ref("video", path, original_filename(&resolved)),
                        );
                    }
                }
            }
            type_id if type_id.starts_with("ai_") => {
                if let Some(blob) = cached_ai_result_blob(engine, &node.id)? {
                    document.assets.insert(
                        node.id.clone(),
                        embedded_asset_ref("ai_result", &blob, String::new()),
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn retained_asset_for_node<'a>(
    node_id: &str,
    asset_type: &str,
    uri: &str,
    retained_assets: &'a HashMap<String, AssetReference>,
) -> Option<(String, &'a AssetReference)> {
    retained_assets
        .iter()
        .find(|(key, asset_ref)| {
            key.split_once(':')
                .map_or(key.as_str(), |(prefix, _)| prefix)
                == node_id
                && asset_ref.asset_type == asset_type
                && (!uri.is_empty() && asset_ref.uri == uri)
        })
        .or_else(|| {
            retained_assets.iter().find(|(key, asset_ref)| {
                key.split_once(':')
                    .map_or(key.as_str(), |(prefix, _)| prefix)
                    == node_id
                    && asset_ref.asset_type == asset_type
            })
        })
        .map(|(key, asset_ref)| (key.clone(), asset_ref))
}

fn retained_asset_bytes(
    asset_ref: &AssetReference,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<Option<Vec<u8>>, String> {
    if !asset_ref.data.is_empty() {
        return general_purpose::STANDARD
            .decode(&asset_ref.data)
            .map(Some)
            .map_err(|e| e.to_string());
    }
    if asset_ref.source == "packed" && !asset_ref.path.is_empty() {
        return Ok(retained_bytes.get(&asset_ref.path).cloned());
    }
    Ok(None)
}

fn embedded_asset_for_node(
    engine: &Engine,
    node_id: &str,
    asset_type: &str,
    uri: &str,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<Option<AssetReference>, String> {
    if let Some((_, retained)) = retained_asset_for_node(node_id, asset_type, uri, retained_assets)
    {
        if let Some(bytes) = retained_asset_bytes(retained, retained_bytes)? {
            let fallback = PathBuf::from(
                retained
                    .original_filename
                    .clone()
                    .if_empty_then(|| format!("{node_id}.{asset_type}")),
            );
            let blob = project_package::make_asset_blob(&fallback, bytes);
            return Ok(Some(embedded_asset_ref(
                asset_type,
                &blob,
                retained.original_filename.clone(),
            )));
        }
    }
    if asset_type == "image" {
        let bytes = engine.get_image_data(node_id).map_err(|e| e.to_string())?;
        let fallback = PathBuf::from(format!("{node_id}.image"));
        let blob = project_package::make_asset_blob(&fallback, bytes);
        return Ok(Some(embedded_asset_ref(asset_type, &blob, String::new())));
    }
    Ok(None)
}

fn embedded_sequence_assets(
    node_id: &str,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<Vec<(String, AssetReference)>, String> {
    let mut assets = Vec::new();
    let mut sequence_manifest = Vec::new();
    for (key, retained) in retained_assets {
        if key
            .split_once(':')
            .map_or(key.as_str(), |(prefix, _)| prefix)
            != node_id
            || retained.asset_type != "image_sequence_frame"
        {
            continue;
        }
        let Some(bytes) = retained_asset_bytes(retained, retained_bytes)? else {
            continue;
        };
        let fallback = PathBuf::from(
            retained
                .original_filename
                .clone()
                .if_empty_then(|| format!("{key}.image")),
        );
        let blob = project_package::make_asset_blob(&fallback, bytes);
        let asset_ref = embedded_asset_ref(
            "image_sequence_frame",
            &blob,
            retained.original_filename.clone(),
        );
        sequence_manifest.push(serde_json::json!({
            "filename": retained.original_filename.clone(),
            "hash": asset_ref.hash.clone(),
            "uri": asset_ref.uri.clone(),
        }));
        assets.push((key.clone(), asset_ref));
    }
    if !sequence_manifest.is_empty() {
        let manifest_bytes =
            serde_json::to_vec(&serde_json::json!({ "frames": sequence_manifest }))
                .map_err(|e| e.to_string())?;
        let manifest_path = PathBuf::from(format!("{node_id}.sequence.json"));
        let manifest_blob = project_package::make_asset_blob(&manifest_path, manifest_bytes);
        assets.push((
            node_id.to_string(),
            embedded_asset_ref("image_sequence", &manifest_blob, String::new()),
        ));
    }
    Ok(assets)
}

trait EmptyStringExt {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl EmptyStringExt for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn add_retained_packed_asset(
    node_id: &str,
    asset_type: &str,
    uri: &str,
    document: &mut CascadeDocument,
    package_assets: &mut Vec<AssetBlob>,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<bool, String> {
    let Some((key, retained)) = retained_asset_for_node(node_id, asset_type, uri, retained_assets)
    else {
        return Ok(false);
    };
    let Some(bytes) = retained_asset_bytes(retained, retained_bytes)? else {
        return Ok(false);
    };
    let fallback = PathBuf::from(
        retained
            .original_filename
            .clone()
            .if_empty_then(|| format!("{node_id}.{asset_type}")),
    );
    let blob = project_package::make_asset_blob(&fallback, bytes);
    document.assets.insert(
        key,
        packed_asset_ref(asset_type, &blob, retained.original_filename.clone()),
    );
    package_assets.push(blob);
    Ok(true)
}

fn add_retained_packed_sequence(
    node_id: &str,
    document: &mut CascadeDocument,
    package_assets: &mut Vec<AssetBlob>,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    let mut sequence_manifest = Vec::new();
    for (key, retained) in retained_assets {
        if key
            .split_once(':')
            .map_or(key.as_str(), |(prefix, _)| prefix)
            != node_id
            || retained.asset_type != "image_sequence_frame"
        {
            continue;
        }
        let Some(bytes) = retained_asset_bytes(retained, retained_bytes)? else {
            continue;
        };
        let fallback = PathBuf::from(
            retained
                .original_filename
                .clone()
                .if_empty_then(|| format!("{key}.image")),
        );
        let blob = project_package::make_asset_blob(&fallback, bytes);
        let asset_ref = packed_asset_ref(
            "image_sequence_frame",
            &blob,
            retained.original_filename.clone(),
        );
        sequence_manifest.push(serde_json::json!({
            "filename": retained.original_filename.clone(),
            "path": asset_ref.path.clone(),
            "hash": asset_ref.hash.clone(),
            "uri": asset_ref.uri.clone(),
        }));
        document.assets.insert(key.clone(), asset_ref);
        package_assets.push(blob);
    }
    if !sequence_manifest.is_empty() {
        let manifest_bytes =
            serde_json::to_vec(&serde_json::json!({ "frames": sequence_manifest }))
                .map_err(|e| e.to_string())?;
        let manifest_path = PathBuf::from(format!("{node_id}.sequence.json"));
        let manifest_blob = project_package::make_asset_blob(&manifest_path, manifest_bytes);
        document.assets.insert(
            node_id.to_string(),
            packed_asset_ref("image_sequence", &manifest_blob, String::new()),
        );
        package_assets.push(manifest_blob);
    }
    Ok(())
}

fn collect_packed_assets(
    engine: &Engine,
    document: &mut CascadeDocument,
    package_assets: &mut Vec<AssetBlob>,
    retained_assets: &HashMap<String, AssetReference>,
    retained_bytes: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    document.assets.clear();
    let nodes = document
        .graph
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node.type_id.clone(), node.params.clone()))
        .collect::<Vec<_>>();
    for (node_id, type_id, params) in nodes {
        match type_id.as_str() {
            "load_image" => {
                if let Some(path) = param_string(&params, "path") {
                    if is_asset_uri(&path) {
                        if add_retained_packed_asset(
                            &node_id,
                            "image",
                            &path,
                            document,
                            package_assets,
                            retained_assets,
                            retained_bytes,
                        )? {
                            continue;
                        }
                        let bytes = engine.get_image_data(&node_id).map_err(|e| e.to_string())?;
                        let fallback = PathBuf::from(format!("{}.image", node_id));
                        let blob = project_package::make_asset_blob(&fallback, bytes);
                        document.assets.insert(
                            node_id.clone(),
                            packed_asset_ref("image", &blob, String::new()),
                        );
                        package_assets.push(blob);
                    } else {
                        let source_path = PathBuf::from(strip_file_url(&path));
                        let blob = read_asset_blob(&source_path)?;
                        document.assets.insert(
                            node_id.clone(),
                            packed_asset_ref("image", &blob, original_filename(&source_path)),
                        );
                        package_assets.push(blob);
                    }
                } else if let Ok(bytes) = engine.get_image_data(&node_id) {
                    let fallback = PathBuf::from(format!("{}.image", node_id));
                    let blob = project_package::make_asset_blob(&fallback, bytes);
                    document.assets.insert(
                        node_id.clone(),
                        packed_asset_ref("image", &blob, String::new()),
                    );
                    package_assets.push(blob);
                }
            }
            "load_image_sequence" => {
                let Some(directory) = param_string(&params, "directory") else {
                    continue;
                };
                if is_asset_uri(&directory) {
                    add_retained_packed_sequence(
                        &node_id,
                        document,
                        package_assets,
                        retained_assets,
                        retained_bytes,
                    )?;
                    continue;
                }
                let dir = PathBuf::from(strip_file_url(&directory));
                let pattern = param_string(&params, "pattern")
                    .unwrap_or_else(|| "frame_{frame}.png".to_string());
                let regex = sequence_pattern_regex(&pattern)?;
                let mut entries = std::fs::read_dir(&dir)
                    .map_err(|e| {
                        format!("Failed to read sequence directory {}: {e}", dir.display())
                    })?
                    .flatten()
                    .filter_map(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if regex.is_match(&name) {
                            Some((name, entry.path()))
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>();
                entries.sort_by(|a, b| a.0.cmp(&b.0));
                if entries.is_empty() {
                    return Err(format!(
                        "No sequence frames matched '{}' in {}",
                        pattern,
                        dir.display()
                    ));
                }
                let mut sequence_manifest = Vec::new();
                for (filename, path) in entries {
                    let blob = read_asset_blob(&path)?;
                    let asset_ref =
                        packed_asset_ref("image_sequence_frame", &blob, filename.clone());
                    sequence_manifest.push(serde_json::json!({
                        "filename": filename.clone(),
                        "path": asset_ref.path.clone(),
                        "hash": asset_ref.hash.clone(),
                        "uri": asset_ref.uri.clone(),
                    }));
                    document
                        .assets
                        .insert(format!("{}:{filename}", node_id), asset_ref);
                    package_assets.push(blob);
                }
                let manifest_bytes =
                    serde_json::to_vec(&serde_json::json!({ "frames": sequence_manifest }))
                        .map_err(|e| e.to_string())?;
                let manifest_path = PathBuf::from(format!("{}.sequence.json", node_id));
                let manifest_blob =
                    project_package::make_asset_blob(&manifest_path, manifest_bytes);
                document.assets.insert(
                    node_id.clone(),
                    packed_asset_ref("image_sequence", &manifest_blob, pattern),
                );
                package_assets.push(manifest_blob);
            }
            "load_video" => {
                if let Some(path) = param_string(&params, "file_path") {
                    if is_asset_uri(&path) {
                        add_retained_packed_asset(
                            &node_id,
                            "video",
                            &path,
                            document,
                            package_assets,
                            retained_assets,
                            retained_bytes,
                        )?;
                    } else {
                        let source_path = PathBuf::from(strip_file_url(&path));
                        let blob = read_asset_blob(&source_path)?;
                        document.assets.insert(
                            node_id.clone(),
                            packed_asset_ref("video", &blob, original_filename(&source_path)),
                        );
                        package_assets.push(blob);
                    }
                }
            }
            type_id if type_id.starts_with("ai_") => {
                if let Some(blob) = cached_ai_result_blob(engine, &node_id)? {
                    document.assets.insert(
                        node_id.clone(),
                        packed_asset_ref("ai_result", &blob, String::new()),
                    );
                    package_assets.push(blob);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn sequence_pattern_regex(pattern: &str) -> Result<regex::Regex, String> {
    let normalized = if let Some(start) = pattern.find("{frame:") {
        let after = &pattern[start..];
        if let Some(end) = after.find('}') {
            let mut result = pattern[..start].to_string();
            result.push_str("{frame}");
            result.push_str(&pattern[start + end + 1..]);
            result
        } else {
            pattern.to_string()
        }
    } else {
        pattern.to_string()
    };
    let escaped = regex::escape(&normalized);
    let with_capture = escaped.replace("\\{frame\\}", "\\d+");
    regex::Regex::new(&format!("^{with_capture}$")).map_err(|e| e.to_string())
}

#[tauri::command]
fn migrate_document(json: String) -> Result<String, String> {
    let mut value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    migrations::migrate_document(&mut value).map_err(|e| e.to_string())?;
    serde_json::to_string(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn needs_migration(json: String) -> Result<bool, String> {
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(migrations::needs_migration(&value))
}

#[tauri::command]
fn load_project(state: State<'_, EngineState>, path: String) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let file_path = std::path::Path::new(&path);
    let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;

    if project_package::is_zip_project_bytes(&bytes) {
        let package = project_package::read_project_package(file_path)?;
        let packed_asset_bytes = package.assets.clone();
        let json = import_project_document(
            &mut s.engine,
            file_path,
            package.document,
            Some(package.assets),
        )?;
        let exported: CascadeDocument = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        s.project_assets = exported
            .assets
            .iter()
            .map(|(key, asset_ref)| (key.clone(), clone_asset_reference(asset_ref)))
            .collect();
        s.packed_asset_bytes = packed_asset_bytes;
        return Ok(json);
    }

    let json = String::from_utf8(bytes).map_err(|e| e.to_string())?;

    if let Ok(mut doc_value) = serde_json::from_str::<serde_json::Value>(&json) {
        // Apply migrations to transform old documents to current version
        migrations::migrate_document(&mut doc_value).map_err(|e| e.to_string())?;

        // Deserialize the migrated document
        let document: CascadeDocument =
            serde_json::from_value(doc_value).map_err(|e| e.to_string())?;
        let json = import_project_document(&mut s.engine, file_path, document, None)?;
        let exported: CascadeDocument = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        s.project_assets = exported
            .assets
            .iter()
            .map(|(key, asset_ref)| (key.clone(), clone_asset_reference(asset_ref)))
            .collect();
        s.packed_asset_bytes.clear();
        Ok(json)
    } else {
        // Fallback: try to load as SerializableGraph (without migration)
        let graph: SerializableGraph = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        s.engine.import_graph(graph).map_err(|e| e.to_string())?;
        s.project_assets.clear();
        s.packed_asset_bytes.clear();
        let exported = s.engine.export_graph();
        serde_json::to_string(&exported).map_err(|e| e.to_string())
    }
}

fn import_project_document(
    engine: &mut Engine,
    file_path: &Path,
    mut document: CascadeDocument,
    packed_assets: Option<std::collections::HashMap<String, Vec<u8>>>,
) -> Result<String, String> {
    let dsl = document.dsl.take();
    let asset_storage = document.asset_storage.clone();
    let project_dir = file_path.parent().unwrap_or(std::path::Path::new("."));
    let assets: Vec<(String, AssetReference)> = document
        .assets
        .iter()
        .map(|(key, asset_ref)| (key.clone(), clone_asset_reference(asset_ref)))
        .collect();

    engine
        .import_document(document)
        .map_err(|e| e.to_string())?;

    for (asset_key, asset_ref) in &assets {
        hydrate_asset(
            engine,
            project_dir,
            file_path,
            asset_key,
            asset_ref,
            packed_assets.as_ref(),
        )?;
    }

    let mut exported = engine.export_document();
    exported.dsl = dsl;
    exported.assets = assets.into_iter().collect();
    exported.asset_storage = asset_storage;
    project_package::apply_packed_asset_uris(&mut exported);
    serde_json::to_string(&exported).map_err(|e| e.to_string())
}

fn clone_asset_reference(asset_ref: &AssetReference) -> AssetReference {
    AssetReference {
        asset_type: asset_ref.asset_type.clone(),
        source: asset_ref.source.clone(),
        path: asset_ref.path.clone(),
        original_filename: asset_ref.original_filename.clone(),
        hash: asset_ref.hash.clone(),
        uri: asset_ref.uri.clone(),
        data: asset_ref.data.clone(),
    }
}

fn hydrate_asset(
    engine: &mut Engine,
    project_dir: &Path,
    project_path: &Path,
    asset_key: &str,
    asset_ref: &AssetReference,
    packed_assets: Option<&std::collections::HashMap<String, Vec<u8>>>,
) -> Result<(), String> {
    match asset_ref.asset_type.as_str() {
        "image" => {
            let bytes = read_project_asset_bytes(project_dir, asset_ref, packed_assets)?;
            engine
                .load_image_data(asset_key, &bytes)
                .map_err(|e| e.to_string())?;
        }
        "image_sequence" => {
            let directory = resolve_project_path(project_dir, &asset_ref.path);
            if directory.exists() {
                engine
                    .set_sequence_directory(asset_key, directory.to_string_lossy().as_ref())
                    .map_err(|e| e.to_string())?;
            }
        }
        "image_sequence_frame" => {
            let Some(packed_assets) = packed_assets else {
                return Ok(());
            };
            let Some((node_id, _)) = asset_key.split_once(':') else {
                return Ok(());
            };
            let Some(bytes) = packed_assets.get(&asset_ref.path) else {
                return Err(format!(
                    "Packed asset {} missing from project",
                    asset_ref.path
                ));
            };
            let temp_path = write_packed_asset_to_temp(project_path, asset_ref, bytes)?;
            let directory = temp_path
                .parent()
                .ok_or_else(|| "Packed sequence temp path has no parent".to_string())?;
            engine
                .set_sequence_directory(node_id, directory.to_string_lossy().as_ref())
                .map_err(|e| e.to_string())?;
        }
        "video" => {
            let path = if asset_ref.source == "packed" {
                let bytes = read_project_asset_bytes(project_dir, asset_ref, packed_assets)?;
                write_packed_asset_to_temp(project_path, asset_ref, &bytes)?
            } else {
                resolve_project_path(project_dir, &asset_ref.path)
            };
            if path.exists() {
                load_video_asset(engine, asset_key, &path)?;
            }
        }
        "ai_result" => {
            let bytes = read_project_asset_bytes(project_dir, asset_ref, packed_assets)?;
            engine
                .set_ai_node_image_data(asset_key, &bytes)
                .map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    Ok(())
}

#[cfg(all(feature = "video", target_os = "macos"))]
fn load_video_asset(engine: &mut Engine, node_id: &str, path: &Path) -> Result<(), String> {
    engine
        .load_video_file(node_id, path.to_string_lossy().as_ref())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(all(feature = "video", target_os = "macos")))]
fn load_video_asset(_engine: &mut Engine, _node_id: &str, _path: &Path) -> Result<(), String> {
    Ok(())
}

fn read_project_asset_bytes(
    project_dir: &Path,
    asset_ref: &AssetReference,
    packed_assets: Option<&std::collections::HashMap<String, Vec<u8>>>,
) -> Result<Vec<u8>, String> {
    if !asset_ref.data.is_empty() {
        return general_purpose::STANDARD
            .decode(&asset_ref.data)
            .map_err(|e| e.to_string());
    }
    if asset_ref.source == "packed" {
        let assets = packed_assets.ok_or_else(|| "Project asset package is missing".to_string())?;
        assets
            .get(&asset_ref.path)
            .cloned()
            .ok_or_else(|| format!("Packed asset {} missing from project", asset_ref.path))
    } else {
        let asset_path = resolve_project_path(project_dir, &asset_ref.path);
        std::fs::read(&asset_path)
            .map_err(|e| format!("Failed to read asset {}: {e}", asset_path.display()))
    }
}

fn write_packed_asset_to_temp(
    project_path: &Path,
    asset_ref: &AssetReference,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let project_stem = project_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("project");
    let filename = if asset_ref.original_filename.is_empty() {
        Path::new(&asset_ref.path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("asset.bin")
            .to_string()
    } else {
        asset_ref.original_filename.clone()
    };
    let dir = std::env::temp_dir()
        .join("cascade-packed-assets")
        .join(format!("{}-{}", project_stem, std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn compile_script_node(
    state: State<'_, EngineState>,
    node_id: String,
    manifest_json: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let spec = s
        .engine
        .compile_script_node(&node_id, &manifest_json)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_node_spec(state: State<'_, EngineState>, node_id: String) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let spec = s
        .engine
        .get_node_spec(&node_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn register_gpu_kernel(
    state: State<'_, EngineState>,
    manifest_json: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let spec = s
        .engine
        .register_gpu_kernel(&manifest_json)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_image(
    state: State<'_, EngineState>,
    node_id: String,
    frame: u64,
) -> Result<Response, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let (_extension, bytes) = s
        .engine
        .render_export(&node_id, frame)
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn export_image_to_path(
    state: State<'_, EngineState>,
    node_id: String,
    frame: u64,
    path: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let (_extension, bytes) = s
        .engine
        .render_export(&node_id, frame)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_sequence_directory(
    state: State<'_, EngineState>,
    node_id: String,
    directory: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let info = s
        .engine
        .set_sequence_directory(&node_id, &directory)
        .map_err(|e| e.to_string())?;
    s.engine
        .set_param(&node_id, "directory", ParamValue::String(directory))
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&info).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_sequence_info(
    state: State<'_, EngineState>,
    node_id: String,
    pattern: String,
) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let info = s
        .engine
        .get_sequence_info(&node_id, &pattern)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&info).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_video_file(
    state: State<'_, EngineState>,
    node_id: String,
    path: String,
) -> Result<String, String> {
    #[cfg(all(feature = "video", target_os = "macos"))]
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        let info = s
            .engine
            .load_video_file(&node_id, &path)
            .map_err(|e| e.to_string())?;
        let source = if path.starts_with("file://") {
            path
        } else {
            format!("file://{path}")
        };
        s.engine
            .set_param(&node_id, "file_path", ParamValue::String(source))
            .map_err(|e| e.to_string())?;
        serde_json::to_string(&info).map_err(|e| e.to_string())
    }
    #[cfg(not(all(feature = "video", target_os = "macos")))]
    {
        let _ = state;
        let _ = node_id;
        let _ = path;
        Err(
            "Video loading is only available on macOS desktop builds with video enabled"
                .to_string(),
        )
    }
}

#[tauri::command]
fn render_sequence(state: State<'_, EngineState>, node_id: String) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .start_render_sequence(&node_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn render_video(
    #[allow(unused_variables)] state: State<'_, EngineState>,
    #[allow(unused_variables)] node_id: String,
) -> Result<String, String> {
    #[cfg(all(feature = "video", target_os = "macos"))]
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.engine
            .start_render_video(&node_id)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(all(feature = "video", target_os = "macos")))]
    {
        Err("Video export is only available on macOS".to_string())
    }
}

#[tauri::command]
fn cancel_render_job(state: State<'_, EngineState>) -> Result<(), String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    s.engine.cancel_job();
    Ok(())
}

#[tauri::command]
fn get_job_progress(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    match s.engine.get_job_progress() {
        Some(progress) => serde_json::to_string(&progress).map_err(|e| e.to_string()),
        None => Ok("null".to_string()),
    }
}

#[tauri::command]
fn get_last_render_timings(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let timings = s.engine.get_last_render_timings();
    serde_json::to_string(timings).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_group_from_nodes(
    state: State<'_, EngineState>,
    node_ids: Vec<String>,
    name: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let id_refs: Vec<&str> = node_ids.iter().map(|s| s.as_str()).collect();
    let result = s
        .engine
        .create_group_from_nodes(&id_refs, &name)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn ungroup_node(state: State<'_, EngineState>, group_node_id: String) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .ungroup_node(&group_node_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_group_internal_graph(
    state: State<'_, EngineState>,
    group_node_id: String,
) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .get_group_internal_graph(&group_node_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_group_interface(
    state: State<'_, EngineState>,
    group_def_id: String,
    inputs: String,
    outputs: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let inputs: Vec<PortSpec> = serde_json::from_str(&inputs).map_err(|e| e.to_string())?;
    let outputs: Vec<PortSpec> = serde_json::from_str(&outputs).map_err(|e| e.to_string())?;
    let result = s
        .engine
        .update_group_interface(&group_def_id, inputs, outputs)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_internal_connection(
    state: State<'_, EngineState>,
    group_def_id: String,
    from_node: String,
    from_port: String,
    to_node: String,
    to_port: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .add_internal_connection(&group_def_id, &from_node, &from_port, &to_node, &to_port)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_internal_connection(
    state: State<'_, EngineState>,
    group_def_id: String,
    to_node: String,
    to_port: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .remove_internal_connection(&group_def_id, &to_node, &to_port)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_internal_node(
    state: State<'_, EngineState>,
    group_def_id: String,
    type_id: String,
    x: f64,
    y: f64,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .add_internal_node(&group_def_id, &type_id, x, y)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_internal_node(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .remove_internal_node(&group_def_id, &node_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_internal_param(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
    key: String,
    value: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let value: ParamValue = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let result = s
        .engine
        .set_internal_param(&group_def_id, &node_id, &key, value)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_internal_input_default(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
    port_name: String,
    value: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let value: ParamValue = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let result = s
        .engine
        .set_internal_input_default(&group_def_id, &node_id, &port_name, value)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_internal_position(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
    x: f64,
    y: f64,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .set_internal_position(&group_def_id, &node_id, x, y)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_internal_muted(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
    muted: bool,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .set_internal_muted(&group_def_id, &node_id, muted)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn compile_internal_script_node(
    state: State<'_, EngineState>,
    group_def_id: String,
    node_id: String,
    manifest_json: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .compile_internal_script_node(&group_def_id, &node_id, &manifest_json)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_group(
    state: State<'_, EngineState>,
    group_def_id: String,
    new_name: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let result = s
        .engine
        .rename_group(&group_def_id, &new_name)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_group_as_package(
    state: State<'_, EngineState>,
    group_def_id: String,
) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .export_group_as_package(&group_def_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_custom_nodes(state: State<'_, EngineState>, json: String) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let specs: Vec<NodeSpec> = s
        .engine
        .import_custom_nodes(&json)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&specs).map_err(|e| e.to_string())
}

#[tauri::command]
fn register_group_definition(
    state: State<'_, EngineState>,
    json: String,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let spec = s
        .engine
        .register_group_definition_json(&json)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_custom_nodes(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let nodes = s.engine.list_custom_nodes();
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_custom_node(state: State<'_, EngineState>, group_def_id: String) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .remove_custom_node(&group_def_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_ai_api_key(
    state: State<'_, EngineState>,
    provider: String,
    key: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .set_ai_api_key(&provider, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn is_ai_configured(state: State<'_, EngineState>) -> Result<bool, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.engine.is_ai_configured())
}

#[tauri::command]
fn run_ai_node(state: State<'_, EngineState>, node_id: String) -> Result<(), String> {
    let state = Arc::clone(state.inner());
    let prepared = {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.engine
            .prepare_ai_node_run(&node_id)
            .map_err(|e| e.to_string())?
    };

    std::thread::spawn(move || {
        let result = Engine::evaluate_prepared_ai_node_run(&prepared);
        if let Ok(mut s) = state.lock() {
            let _ = s.engine.finish_ai_node_run(prepared, result);
        }
    });

    Ok(())
}

#[tauri::command]
fn get_node_execution_state(
    state: State<'_, EngineState>,
    node_id: String,
) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    serde_json::to_string(&s.engine.get_node_execution_state(&node_id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_ai_node_image_data(
    state: State<'_, EngineState>,
    node_id: String,
) -> Result<Response, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let data = s
        .engine
        .get_ai_node_image_data(&node_id)
        .map_err(|e| e.to_string())?;
    Ok(Response::new(data))
}

#[tauri::command]
fn set_ai_node_image_data(
    state: State<'_, EngineState>,
    request: tauri::ipc::Request,
) -> Result<(), String> {
    let node_id = request
        .headers()
        .get("x-node-id")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing x-node-id header".to_string())?
        .to_string();
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Expected raw body with AI result image data".to_string());
    };
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine
        .set_ai_node_image_data(&node_id, data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_color_spaces(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let spaces = s.engine.available_color_spaces();
    serde_json::to_string(&spaces).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_displays(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let displays = s.engine.available_displays();
    serde_json::to_string(&displays).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_views(state: State<'_, EngineState>, display: String) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let views = s.engine.available_views(&display);
    serde_json::to_string(&views).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_color_management_info(state: State<'_, EngineState>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let info = serde_json::json!({
        "workingSpace": s.engine.working_space(),
        "activeDisplay": s.engine.active_display(),
        "activeView": s.engine.active_view(),
        "displays": s.engine.available_displays(),
        "colorSpaces": s.engine.available_color_spaces(),
    });
    serde_json::to_string(&info).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_display_view(
    state: State<'_, EngineState>,
    display: String,
    view: String,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.set_active_display_view(display, view);
    Ok(())
}

#[tauri::command]
fn set_project_format(
    state: State<'_, EngineState>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.set_project_format(width, height);
    Ok(())
}

#[cfg(feature = "ocio")]
#[tauri::command]
fn load_ocio_config(state: State<'_, EngineState>, path: String) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.load_ocio_config(&path).map_err(|e| e.to_string())
}

#[cfg(feature = "ocio")]
#[tauri::command]
fn load_ocio_from_env(state: State<'_, EngineState>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.load_ocio_from_env().map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_color_management(state: State<'_, EngineState>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.engine.reset_color_management();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = Engine::new();

    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(AppState {
            engine,
            project_assets: HashMap::new(),
            packed_asset_bytes: HashMap::new(),
        })))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            menu::setup_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_node_types,
            add_node,
            remove_node,
            connect,
            disconnect,
            set_param,
            set_input_default,
            set_position,
            set_muted,
            load_image_data,
            load_image_path,
            load_palette_data,
            get_image_data,
            render_viewer,
            render_internal_viewer,
            set_param_and_render,
            set_input_default_and_render,
            export_graph,
            import_graph,
            save_project,
            migrate_document,
            needs_migration,
            load_project,
            compile_script_node,
            get_node_spec,
            register_gpu_kernel,
            export_image,
            export_image_to_path,
            set_sequence_directory,
            get_sequence_info,
            load_video_file,
            render_sequence,
            render_video,
            cancel_render_job,
            get_job_progress,
            create_group_from_nodes,
            ungroup_node,
            get_group_internal_graph,
            update_group_interface,
            add_internal_connection,
            remove_internal_connection,
            add_internal_node,
            remove_internal_node,
            set_internal_param,
            set_internal_input_default,
            set_internal_position,
            set_internal_muted,
            compile_internal_script_node,
            rename_group,
            export_group_as_package,
            import_custom_nodes,
            register_group_definition,
            list_custom_nodes,
            remove_custom_node,
            set_ai_api_key,
            is_ai_configured,
            run_ai_node,
            get_node_execution_state,
            get_ai_node_image_data,
            set_ai_node_image_data,
            get_last_render_timings,
            list_color_spaces,
            list_displays,
            list_views,
            get_color_management_info,
            set_display_view,
            set_project_format,
            reset_color_management,
            #[cfg(feature = "ocio")]
            load_ocio_config,
            #[cfg(feature = "ocio")]
            load_ocio_from_env,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png() -> Vec<u8> {
        general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC")
            .expect("tiny PNG decodes")
    }

    fn engine_with_cached_ai_result() -> (Engine, String) {
        let mut engine = Engine::new();
        let (node_id, _) = engine
            .add_node("ai_generate_image", 0.0, 0.0)
            .expect("add AI image node");
        engine
            .set_ai_node_image_data(&node_id, &tiny_png())
            .expect("cache AI image");
        (engine, node_id)
    }

    #[test]
    fn collect_packed_assets_includes_cached_ai_results() {
        let (engine, node_id) = engine_with_cached_ai_result();
        let mut document = engine.export_document();
        let mut package_assets = Vec::new();

        collect_packed_assets(
            &engine,
            &mut document,
            &mut package_assets,
            &HashMap::new(),
            &HashMap::new(),
        )
        .expect("collect packed assets");

        let asset_ref = document
            .assets
            .get(&node_id)
            .expect("AI result asset reference");
        assert_eq!(asset_ref.asset_type, "ai_result");
        assert_eq!(asset_ref.source, "packed");
        assert!(asset_ref.path.starts_with("assets/"));
        assert!(asset_ref.path.ends_with(".png"));
        assert!(asset_ref.uri.starts_with("asset://sha256/"));
        assert_eq!(package_assets.len(), 1);
        assert_eq!(package_assets[0].package_path, asset_ref.path);
        assert_eq!(
            package_assets[0].bytes,
            engine
                .get_ai_node_image_data(&node_id)
                .expect("cached AI image bytes")
        );
    }

    #[test]
    fn collect_external_asset_refs_embeds_cached_ai_results() {
        let (engine, node_id) = engine_with_cached_ai_result();
        let mut document = engine.export_document();

        collect_external_asset_refs(
            &engine,
            Path::new("."),
            &mut document,
            &HashMap::new(),
            &HashMap::new(),
        )
        .expect("collect external assets");

        let asset_ref = document
            .assets
            .get(&node_id)
            .expect("AI result asset reference");
        assert_eq!(asset_ref.asset_type, "ai_result");
        assert_eq!(asset_ref.source, "embedded");
        assert!(asset_ref.path.is_empty());
        assert!(!asset_ref.data.is_empty());
        assert!(asset_ref.uri.starts_with("asset://sha256/"));
    }

    #[test]
    fn hydrate_asset_restores_packed_ai_result_cache() {
        let mut source_engine = Engine::new();
        let (node_id, _) = source_engine
            .add_node("ai_generate_image", 0.0, 0.0)
            .expect("add source AI node");
        source_engine
            .set_ai_node_image_data(&node_id, &tiny_png())
            .expect("cache source AI image");
        let bytes = source_engine
            .get_ai_node_image_data(&node_id)
            .expect("encoded AI image");
        let blob = project_package::make_asset_blob(Path::new("ai-result.png"), bytes.clone());
        let asset_ref = packed_asset_ref("ai_result", &blob, String::new());
        let packed_assets = HashMap::from([(blob.package_path.clone(), blob.bytes.clone())]);

        let mut restored_engine = Engine::new();
        let (restored_node_id, _) = restored_engine
            .add_node("ai_generate_image", 0.0, 0.0)
            .expect("add restored AI node");
        hydrate_asset(
            &mut restored_engine,
            Path::new("."),
            Path::new("/tmp/project.casc"),
            &restored_node_id,
            &asset_ref,
            Some(&packed_assets),
        )
        .expect("hydrate AI result");

        assert_eq!(
            restored_engine
                .get_ai_node_image_data(&restored_node_id)
                .expect("restored AI image bytes"),
            bytes
        );
        assert_eq!(
            restored_engine
                .get_node_execution_state(&restored_node_id)
                .status,
            "complete"
        );
    }
}
