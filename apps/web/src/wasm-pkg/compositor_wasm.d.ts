/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    add_internal_connection(group_def_id: string, from_node: string, from_port: string, to_node: string, to_port: string): any;
    add_node(type_id: string, x: number, y: number): any;
    batch_add_image(node_id: string, filename: string, data: Uint8Array): void;
    batch_clear(node_id: string): void;
    compile_script_node(node_id: string, manifest_json: string): any;
    connect(from_node: string, from_port: string, to_node: string, to_port: string): void;
    create_group_from_nodes(node_ids: any, name: string): any;
    disconnect(to_node: string, to_port: string): void;
    export_graph(): any;
    export_group_as_package(group_def_id: string): any;
    export_image(node_id: string, frame: bigint): Promise<Uint8Array>;
    /**
     * Returns the UUIDs of viewer/output nodes affected by changes to the given node.
     * Used for selective viewer invalidation — only re-render viewers whose upstream changed.
     */
    get_affected_viewers(node_id: string): string[];
    get_ai_node_image_data(node_id: string): Uint8Array;
    get_batch_info(export_node_id: string): any;
    get_color_management_info(): any;
    get_group_internal_graph(group_node_id: string): any;
    get_image_data(node_id: string): Uint8Array;
    get_last_render_timings(): any;
    get_node_execution_state(node_id: string): any;
    get_render_dimensions(viewer_node_id: string, frame: bigint): Promise<any>;
    get_views_for_display(display: string): any;
    import_custom_nodes(package_js: any): any;
    import_graph(json: any): void;
    init_gpu(): Promise<void>;
    is_ai_configured(): boolean;
    list_node_types(): any;
    load_image_data(node_id: string, data: Uint8Array): void;
    load_palette_data(node_id: string, data: Uint8Array): any;
    load_sequence_frame_data(node_id: string, frame: bigint, data: Uint8Array): void;
    constructor();
    remove_internal_connection(group_def_id: string, to_node: string, to_port: string): any;
    remove_node(node_id: string): void;
    rename_group(group_def_id: string, new_name: string): any;
    render_viewer(viewer_node_id: string, frame: bigint): Promise<any>;
    run_ai_node(node_id: string): Promise<void>;
    set_ai_api_key(provider: string, key: string): void;
    set_ai_node_image_data(node_id: string, data: Uint8Array): void;
    set_display_view(display: string, view: string): void;
    set_input_default(node_id: string, port_name: string, value: any): void;
    set_muted(node_id: string, muted: boolean): void;
    set_param(node_id: string, key: string, value: any): void;
    set_position(node_id: string, x: number, y: number): void;
    set_project_format(width: number, height: number): void;
    set_sequence_info(node_id: string, frame_count: bigint, first_frame: bigint, last_frame: bigint): void;
    types_compatible(from_type: string, to_type: string): boolean;
    ungroup_node(group_node_id: string): any;
    update_group_interface(group_def_id: string, inputs: any, outputs: any): any;
    validate_edits(edits_json: string): any;
}

export function migrate_document_json(json_str: string): string;

export function needs_migration_json(json_str: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_add_internal_connection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly engine_add_node: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_batch_add_image: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly engine_batch_clear: (a: number, b: number, c: number) => [number, number];
    readonly engine_compile_script_node: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_connect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly engine_create_group_from_nodes: (a: number, b: any, c: number, d: number) => [number, number, number];
    readonly engine_disconnect: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_export_graph: (a: number) => [number, number, number];
    readonly engine_export_group_as_package: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_export_image: (a: number, b: number, c: number, d: bigint) => any;
    readonly engine_get_affected_viewers: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_get_ai_node_image_data: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_get_batch_info: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_get_color_management_info: (a: number) => [number, number, number];
    readonly engine_get_group_internal_graph: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_get_image_data: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_get_last_render_timings: (a: number) => [number, number, number];
    readonly engine_get_node_execution_state: (a: number, b: number, c: number) => any;
    readonly engine_get_render_dimensions: (a: number, b: number, c: number, d: bigint) => any;
    readonly engine_get_views_for_display: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_import_custom_nodes: (a: number, b: any) => [number, number, number];
    readonly engine_import_graph: (a: number, b: any) => [number, number];
    readonly engine_init_gpu: (a: number) => any;
    readonly engine_is_ai_configured: (a: number) => number;
    readonly engine_list_node_types: (a: number) => [number, number, number];
    readonly engine_load_image_data: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_load_palette_data: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_load_sequence_frame_data: (a: number, b: number, c: number, d: bigint, e: number, f: number) => [number, number];
    readonly engine_new: () => number;
    readonly engine_remove_internal_connection: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly engine_remove_node: (a: number, b: number, c: number) => void;
    readonly engine_rename_group: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_render_viewer: (a: number, b: number, c: number, d: bigint) => any;
    readonly engine_run_ai_node: (a: number, b: number, c: number) => any;
    readonly engine_set_ai_api_key: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_set_ai_node_image_data: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_set_display_view: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_input_default: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number];
    readonly engine_set_muted: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_set_param: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number];
    readonly engine_set_position: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly engine_set_project_format: (a: number, b: number, c: number) => void;
    readonly engine_set_sequence_info: (a: number, b: number, c: number, d: bigint, e: bigint, f: bigint) => [number, number];
    readonly engine_types_compatible: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly engine_ungroup_node: (a: number, b: number, c: number) => [number, number, number];
    readonly engine_update_group_interface: (a: number, b: number, c: number, d: any, e: any) => [number, number, number];
    readonly engine_validate_edits: (a: number, b: number, c: number) => [number, number, number];
    readonly migrate_document_json: (a: number, b: number) => [number, number, number, number];
    readonly needs_migration_json: (a: number, b: number) => number;
    readonly wasm_bindgen__closure__destroy__h4e9f10c7ebf86095: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h7c306b412fda6163: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h7e36f564172f1f83: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
