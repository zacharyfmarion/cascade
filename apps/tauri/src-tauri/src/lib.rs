mod menu;

use compositor_runtime::{
    AssetReference, CompositorDocument, Engine, PortSpec, RenderResult, SerializableGraph,
};
use std::sync::Mutex;
use std::time::Instant;
use tauri::ipc::Response;
use tauri::State;

struct AppState {
    engine: Engine,
}

type EngineState = Mutex<AppState>;

#[tauri::command]
fn list_node_types(state: State<'_, EngineState>) -> Result<String, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    let specs = engine.engine.list_node_types();
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
    let param_value: compositor_runtime::ParamValue =
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
    let param_value: compositor_runtime::ParamValue =
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
) -> Result<(), String> {
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
    s.engine
        .load_image_data(&node_id, data)
        .map_err(|e| e.to_string())
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
) -> Result<Response, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let RenderResult {
        width,
        height,
        pixels,
    } = s
        .engine
        .render_viewer(&viewer_node_id, frame)
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::with_capacity(8 + pixels.len());
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(&pixels);
    Ok(Response::new(buf))
}

/// Batched: set param + render all viewers in one IPC call.
/// Response binary format:
/// [u32 viewer_count LE]
/// For each viewer: [u32 id_len LE][utf8 id bytes][u32 width LE][u32 height LE][RGBA8 pixels]
#[tauri::command]
fn set_param_and_render(
    state: State<'_, EngineState>,
    node_id: String,
    key: String,
    value: serde_json::Value,
    frame: u64,
) -> Result<Response, String> {
    let t0 = Instant::now();
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let param_value: compositor_runtime::ParamValue =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    let results = s
        .engine
        .set_param_and_render_viewers(&node_id, &key, param_value, frame)
        .map_err(|e| e.to_string())?;
    let elapsed = t0.elapsed();
    eprintln!(
        "[perf] set_param_and_render: {:.1}ms ({} viewers)",
        elapsed.as_secs_f64() * 1000.0,
        results.len()
    );

    let total_size: usize = 4 + results
        .iter()
        .map(|(id, r)| 4 + id.len() + 8 + r.pixels.len())
        .sum::<usize>();
    let mut buf = Vec::with_capacity(total_size);
    buf.extend_from_slice(&(results.len() as u32).to_le_bytes());
    for (id, r) in &results {
        buf.extend_from_slice(&(id.len() as u32).to_le_bytes());
        buf.extend_from_slice(id.as_bytes());
        buf.extend_from_slice(&r.width.to_le_bytes());
        buf.extend_from_slice(&r.height.to_le_bytes());
        buf.extend_from_slice(&r.pixels);
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
    s.engine.import_graph(graph).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project(state: State<'_, EngineState>, path: String) -> Result<(), String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let mut document = s.engine.export_document();

    let file_path = std::path::Path::new(&path);
    if let Some(stem) = file_path.file_stem().and_then(|s| s.to_str()) {
        document.project.name = stem.to_string();
    }

    let project_dir = file_path.parent().unwrap_or(std::path::Path::new("."));
    let assets_dir = project_dir.join("assets");

    for node in &document.graph.nodes {
        if node.type_id == "load_image" {
            if let Ok(bytes) = s.engine.get_image_data(&node.id) {
                if !assets_dir.exists() {
                    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;
                }

                let asset_filename = format!("{}.png", node.id);
                let asset_path = assets_dir.join(&asset_filename);
                std::fs::write(&asset_path, &bytes).map_err(|e| e.to_string())?;

                document.assets.insert(
                    node.id.clone(),
                    AssetReference {
                        asset_type: "image".to_string(),
                        source: "embedded".to_string(),
                        path: format!("assets/{}", asset_filename),
                        original_filename: String::new(),
                        hash: String::new(),
                    },
                );
            }
        }
    }

    let json = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_project(state: State<'_, EngineState>, path: String) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let file_path = std::path::Path::new(&path);
    let json = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;

    if let Ok(document) = serde_json::from_str::<CompositorDocument>(&json) {
        let project_dir = file_path.parent().unwrap_or(std::path::Path::new("."));
        let assets: Vec<(String, String, String)> = document
            .assets
            .iter()
            .map(|(node_id, asset_ref)| {
                (
                    node_id.clone(),
                    asset_ref.asset_type.clone(),
                    asset_ref.path.clone(),
                )
            })
            .collect();

        s.engine
            .import_document(document)
            .map_err(|e| e.to_string())?;

        for (node_id, asset_type, asset_path) in assets {
            if asset_type == "image" {
                let asset_path = project_dir.join(&asset_path);
                if asset_path.exists() {
                    let bytes = std::fs::read(&asset_path).map_err(|e| e.to_string())?;
                    s.engine
                        .load_image_data(&node_id, &bytes)
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        let graph = s.engine.export_graph();
        serde_json::to_string(&graph).map_err(|e| e.to_string())
    } else {
        let graph: SerializableGraph = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        s.engine.import_graph(graph).map_err(|e| e.to_string())?;
        let exported = s.engine.export_graph();
        serde_json::to_string(&exported).map_err(|e| e.to_string())
    }
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
    let mut s = state.lock().map_err(|e| e.to_string())?;
    let info = s
        .engine
        .load_video_file(&node_id, &path)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&info).map_err(|e| e.to_string())
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
    #[cfg(target_os = "macos")]
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.engine
            .start_render_video(&node_id)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut engine = Engine::new();

    #[cfg(feature = "ocio")]
    {
        match engine.load_ocio_from_env() {
            Ok(()) => eprintln!("[compositor] Loaded OCIO config from $OCIO"),
            Err(e) => {
                eprintln!("[compositor] OCIO not loaded ({e}), using builtin color management")
            }
        }
    }

    tauri::Builder::default()
        .manage(Mutex::new(AppState { engine }))
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
            get_image_data,
            render_viewer,
            set_param_and_render,
            export_graph,
            import_graph,
            save_project,
            load_project,
            compile_script_node,
            register_gpu_kernel,
            export_image,
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
            rename_group,
            set_ai_api_key,
            is_ai_configured,
            get_last_render_timings,
            list_color_spaces,
            list_displays,
            list_views,
            get_color_management_info,
            set_display_view,
            set_project_format,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
