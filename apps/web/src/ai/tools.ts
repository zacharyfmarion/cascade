import { tool } from 'ai';
import { z } from 'zod';
import { getAuthoringNodeSpecs } from '../platform/features';
import { getRuntimeSurface } from '../platform/runtime';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import type { NodeSpec, ParamSpec, PortSpec } from '../store/types';
import { serializeGraph } from './dsl/serializer';
import { customDefinitionToNodeSpec, parseDsl } from './dsl/parser';
import { validateAst } from './dsl/validator';
import { diffAst } from './dsl/differ';
import { applyMutations } from './dsl/executor';
import { captureViewerThumbnail } from './viewerSnapshot';
import { snakeToPascal, labelToSnake, pascalToSnake } from './dsl/types';
import type { DslAst } from './dsl/types';
import { graphSemanticHash, handleMapFromShadow } from './dsl/shadow';
import { buildDefaultGpuScriptManifest, buildGpuScriptManifestFromGlsl, buildGpuScriptNodeSpec, generateGlslKernel } from './gpuScript';

export { resetSharedHandleMap as resetHandleMap } from './dsl/instance';


function getCurrentDsl(): string {
  const { nodes, connections, nodeSpecs, dslShadow } = useGraphStore.getState();
  if (dslShadow?.status === 'valid' && dslShadow.graphHash === graphSemanticHash(nodes, connections)) {
    return dslShadow.text;
  }
  return serializeGraph({
    nodes,
    connections,
    nodeSpecs,
    handleMap: handleMapFromShadow(nodes, dslShadow),
  });
}


function getCurrentAst(): DslAst {
  const { nodeSpecs, nodes } = useGraphStore.getState();
  const dslText = getCurrentDsl();
  const handleMap = handleMapFromShadow(nodes, useGraphStore.getState().dslShadow);
  const result = parseDsl(dslText, nodeSpecs, { currentNodes: nodes, handleMap });

  return result.ast ?? { nodes: new Map(), connections: [] };
}

function getAuthoringSpecs(): NodeSpec[] {
  const { nodeSpecs } = useGraphStore.getState();
  return getAuthoringNodeSpecs(nodeSpecs, getRuntimeSurface());
}


function formatParamSpec(p: ParamSpec): Record<string, unknown> {
  // ui_hint carries the real structural type for complex params — p.ty is
  // misleading (e.g. ColorPalette has ty:Color, ColorRamp has ty:Float).
  let type: string = p.ty;
  let dslSyntax: string | undefined;
  if (p.ui_hint.type === 'ColorPalette') {
    type = 'ColorPalette';
    dslSyntax = 'Array of rgba() colors: [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 0.5, 1.0, 1.0)]. Colors are in LINEAR space [0..1].';
  } else if (p.ui_hint.type === 'ColorRamp') {
    type = 'ColorRamp';
    dslSyntax = 'Array of position:color stops: [0.0: rgba(0.0, 0.0, 0.0, 1.0), 0.5: rgba(1.0, 0.0, 0.0, 1.0), 1.0: rgba(1.0, 1.0, 1.0, 1.0)]. Positions are 0..1.';
  } else if (p.ui_hint.type === 'CurveEditor') {
    type = 'CurvePoints';
    dslSyntax = 'Array of (x, y) control points: [(0.0, 0.0), (0.25, 0.4), (0.75, 0.9), (1.0, 1.0)]. Both x and y are 0..1.';
  }

  const desc: Record<string, unknown> = {
    key: p.key,
    type,
  };
  if (dslSyntax) desc.dsl_syntax = dslSyntax;
  if (p.min !== undefined) desc.min = p.min;
  if (p.max !== undefined) desc.max = p.max;
  if (p.step !== undefined) desc.step = p.step;
  if (p.ui_hint.type === 'Dropdown' && 'data' in p.ui_hint) {
    const snakeOptions = p.ui_hint.data.map(labelToSnake);
    desc.options = snakeOptions;
    desc.dsl_syntax = `Use one of the exact option strings in quotes, e.g. "${snakeOptions[0]}"`;
    desc.type = 'Dropdown';
  }
  return desc;
}

function formatPortSpec(port: PortSpec): Record<string, unknown> {
  const desc: Record<string, unknown> = {
    name: port.name,
    type: port.ty,
  };
  if (port.label && port.label !== port.name) desc.label = port.label;
  if (port.default !== undefined) desc.default = port.default;
  if (port.min !== undefined) desc.min = port.min;
  if (port.max !== undefined) desc.max = port.max;
  if (port.step !== undefined) desc.step = port.step;
  return desc;
}

function isGpuScriptSpec(spec: NodeSpec): boolean {
  return spec.id === 'gpu_script' || spec.id.startsWith('gpu_script::');
}

function buildGpuScriptSchema(specs: NodeSpec[], requestedType: string): Record<string, unknown> {
  const requestedTypeId = pascalToSnake(requestedType);
  const spec = specs.find((candidate) => candidate.id === requestedTypeId)
    ?? specs.find(isGpuScriptSpec)
    ?? buildGpuScriptNodeSpec(buildDefaultGpuScriptManifest('gpu_script'));
  const supportsMask = spec.inputs.some((input) => input.name === 'mask' && input.ty === 'Mask');

  return {
    type: 'GpuScript',
    runtime_type: spec.id,
    category: spec.category,
    description: spec.description,
    params: spec.params.map(formatParamSpec),
    inputs: spec.inputs.map(formatPortSpec),
    outputs: spec.outputs.map(formatPortSpec),
    editable_fields: [
      {
        key: 'script',
        type: 'String',
        multiline: true,
        dsl_syntax: 'Use a triple-quoted multiline string inside a GpuScript node, e.g. script: """\\nfloat gain = 1.2;\\nreturn vec4(color.rgb * gain, color.a);\\n"""',
        description: 'Editable GLSL body for process(vec4 color, vec2 uv, ivec2 pixel). Provide only the body, not the full shader.',
      },
      {
        key: 'supports_mask',
        type: 'Bool',
        current_value: supportsMask,
        description: 'Controls whether the implicit Mask input is exposed on the node interface.',
      },
    ],
    glsl_context: {
      signature: 'vec4 process(vec4 color, vec2 uv, ivec2 pixel)',
      available_globals: [
        'u_input: readonly image2D for the primary input',
        'Additional image inputs are bound as u_<name>',
        'Float/Int/Bool input controls are uniforms available directly by name',
        'Helpers: bayer8(int x, int y), luminance(vec4 c)',
      ],
    },
    editing_notes: [
      'Existing GPU Script nodes often use runtime type ids like gpu_script::<uuid>, but they all share the GpuScript editing model.',
      'Use input ports for both image/mask inputs and scalar controls. Scalar controls are Float, Int, or Bool inputs with default/min/max/step/ui metadata.',
      'New or edited GPU Script manifests should keep params: []; legacy params may be migrated into scalar inputs.',
      'To inspect the current kernel, ports, scalar controls, and supports_mask for a specific node, call get_gpu_script_manifest with the node handle or id before editing.',
      'When editing through the DSL, the special script field updates the GLSL body and recompiles the node.',
      'If you change ports, scalar controls, or mask support, preserve the existing interface unless the user explicitly asked for interface changes.',
    ],
  };
}

// ─── Tool schemas ────────────────────────────────────────────────

const readGraphSchema = z.object({});

const editGraphSchema = z.object({
  old_text: z.string().describe('The exact text to find in the current graph DSL'),
  new_text: z.string().describe('The replacement text'),
});

const writeGraphSchema = z.object({
  dsl: z.string().describe('Complete DSL text for the new graph'),
});

const viewCurrentImageSchema = z.object({});

const listNodeTypesSchema = z.object({});

const getNodeSchemaSchema = z.object({
  node_type: z.string().describe('PascalCase node type name (e.g. "GaussianBlur", "BrightnessContrast")'),
});

const createGpuScriptSchema = z.object({
  description: z.string().describe('Text description of the desired GPU effect.'),
});

const getGpuScriptManifestSchema = z.object({
  node_id: z.string().optional().describe('Node ID for the GPU Script node.'),
  node_handle: z.string().optional().describe('DSL handle for the GPU Script node.'),
}).refine(value => Boolean(value.node_id || value.node_handle), {
  message: 'Provide node_id or node_handle',
});


// ─── Tool type aliases ───────────────────────────────────────────
type ReadGraphArgs = z.infer<typeof readGraphSchema>;
type EditGraphArgs = z.infer<typeof editGraphSchema>;
type WriteGraphArgs = z.infer<typeof writeGraphSchema>;
type ViewCurrentImageArgs = z.infer<typeof viewCurrentImageSchema>;
type ListNodeTypesArgs = z.infer<typeof listNodeTypesSchema>;
type GetNodeSchemaArgs = z.infer<typeof getNodeSchemaSchema>;
type CreateGpuScriptArgs = z.infer<typeof createGpuScriptSchema>;
type GetGpuScriptManifestArgs = z.infer<typeof getGpuScriptManifestSchema>;

// ─── Tool executors ──────────────────────────────────────────────

const toolExecutors = {
  read_graph: async (_args: ReadGraphArgs) => {
    void _args;
    const dsl = getCurrentDsl();
    return { graph: dsl };
  },

  edit_graph: async ({ old_text, new_text }: EditGraphArgs) => {
    const currentDsl = getCurrentDsl();


    const index = currentDsl.indexOf(old_text);
    if (index === -1) {
      return {
        success: false,
        error: 'old_text not found in current graph',
        current_graph: currentDsl,
      };
    }


    const secondIndex = currentDsl.indexOf(old_text, index + 1);
    if (secondIndex !== -1) {
      return {
        success: false,
        error: 'old_text matches multiple locations in the graph. Include more surrounding context to make the match unambiguous.',
        current_graph: currentDsl,
      };
    }


    const newDsl = currentDsl.substring(0, index) + new_text + currentDsl.substring(index + old_text.length);


    return applyNewDsl(newDsl);
  },

  write_graph: async ({ dsl }: WriteGraphArgs) => {
    return applyNewDsl(dsl);
  },

  view_current_image: async (_args: ViewCurrentImageArgs) => {
    void _args;
    const dataUrl = captureViewerThumbnail();
    if (!dataUrl) return { error: 'No viewer image available' };
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    return { type: 'image' as const, data: base64 };
  },

  list_node_types: async (_args: ListNodeTypesArgs) => {
    void _args;
    const specs = getAuthoringSpecs();
    const groups: Record<string, string[]> = {};
    for (const s of specs) {
      const cat = s.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      const normalizedType = isGpuScriptSpec(s) ? 'GpuScript' : snakeToPascal(s.id);
      const desc = s.description ? ` — ${s.description}` : '';
      const entry = `${normalizedType}${desc}`;
      if (!groups[cat].includes(entry)) {
        groups[cat].push(entry);
      }
    }
    return groups;
  },

  get_node_schema: async ({ node_type }: GetNodeSchemaArgs) => {
    const specs = getAuthoringSpecs();
    const typeId = pascalToSnake(node_type);
    if (typeId === 'gpu_script' || typeId.startsWith('gpu_script::')) {
      // Pass all nodeSpecs (including gpu_script:: instances) so buildGpuScriptSchema
      // can find the specific instance spec for runtime_type.
      const allSpecs = useGraphStore.getState().nodeSpecs;
      return buildGpuScriptSchema(allSpecs, node_type);
    }
    const spec = specs.find((s: NodeSpec) => s.id === typeId);
    if (!spec) {
      return { error: `Unknown node type: ${node_type}` };
    }
    return {
      type: snakeToPascal(spec.id),
      category: spec.category,
      description: spec.description,
      params: spec.params.map(formatParamSpec),
      inputs: spec.inputs.map(i => ({ name: i.name, type: i.ty })),
      outputs: spec.outputs.map(o => ({ name: o.name, type: o.ty })),
    };
  },

  create_gpu_script: async ({ description }: CreateGpuScriptArgs) => {
    const apiKey = useSettingsStore.getState().anthropicApiKey;
    if (!apiKey) {
      return {
        success: false,
        error: 'Anthropic API key is not configured. Set it in Settings → AI Assistant.',
      };
    }

    const store = useGraphStore.getState();
    const nodeId = await store.addNode('gpu_script', { x: 0, y: 0 });
    const node = store.nodes.get(nodeId);
    const typeId = node?.typeId ?? 'gpu_script';

    const manifest = await generateGlslKernel(description, apiKey);
    const compiledManifest = buildGpuScriptManifestFromGlsl(typeId, manifest);
    const manifestJson = JSON.stringify(compiledManifest);
    const handleMap = handleMapFromShadow(store.nodes, store.dslShadow);
    const handle = handleMap.getOrCreate(nodeId, typeId);
    store.setDslHandle(nodeId, handle);

    try {
      await store.compileScriptNode(nodeId, manifestJson);
      return {
        success: true,
        node_id: nodeId,
        handle,
        manifest: compiledManifest,
      };
    } catch (error) {
      return {
        success: false,
        node_id: nodeId,
        handle,
        error: error instanceof Error ? error.message : String(error),
        manifest: compiledManifest,
      };
    }
  },

  get_gpu_script_manifest: async ({ node_id, node_handle }: GetGpuScriptManifestArgs) => {
    const store = useGraphStore.getState();
    const handleMap = handleMapFromShadow(store.nodes, store.dslShadow);
    const nodeId = node_id ?? (node_handle ? handleMap.getNodeId(node_handle) : undefined);
    if (!nodeId) {
      return { success: false, error: 'Unknown node id/handle.' };
    }

    const node = store.nodes.get(nodeId);
    if (!node) {
      return { success: false, error: 'Node not found.' };
    }

    if (!node.typeId.startsWith('gpu_script')) {
      return { success: false, error: 'Node is not a GPU Script node.' };
    }

    const manifestValue = node.params['__script_manifest'];
    if (!manifestValue || !('String' in manifestValue) || typeof manifestValue.String !== 'string') {
      return {
        success: false,
        node_id: nodeId,
        handle: node_handle ?? handleMap.getHandle(nodeId),
        message: 'GPU Script manifest not found. Compile the script first to populate __script_manifest.',
      };
    }

    try {
      const parsed = JSON.parse(manifestValue.String) as Record<string, unknown>;
      return {
        success: true,
        node_id: nodeId,
        handle: node_handle ?? handleMap.getHandle(nodeId),
        manifest: parsed,
      };
    } catch (error) {
      return {
        success: false,
        node_id: nodeId,
        handle: node_handle ?? handleMap.getHandle(nodeId),
        error: `Failed to parse __script_manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};


async function applyNewDsl(newDsl: string): Promise<Record<string, unknown>> {
  const { nodeSpecs, nodes, dslShadow } = useGraphStore.getState();
  const handleMap = handleMapFromShadow(nodes, dslShadow);


  const parseResult = parseDsl(newDsl, nodeSpecs, { currentNodes: nodes, handleMap });
  if (parseResult.errors.length > 0) {
    return {
      success: false,
      errors: parseResult.errors.map(e => ({
        line: e.line,
        message: e.message,
        ...(e.suggestion ? { suggestion: e.suggestion } : {}),
      })),
    };
  }
  if (!parseResult.ast) {
    return { success: false, errors: [{ line: 0, message: 'Failed to parse DSL' }] };
  }


  const customSpecs = parseResult.ast.customNodes
    ? Array.from(parseResult.ast.customNodes.values()).map(customDefinitionToNodeSpec)
    : [];
  const validation = validateAst(parseResult.ast, [...nodeSpecs, ...customSpecs]);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors.map(e => ({
        line: e.line,
        message: e.message,
        ...(e.suggestion ? { suggestion: e.suggestion } : {}),
      })),
    };
  }


  const currentAst = getCurrentAst();
  const mutations = diffAst(currentAst, parseResult.ast);

  if (mutations.length === 0) {
    const updatedDsl = getCurrentDsl();
    return { success: true, graph: updatedDsl, mutations_applied: 0 };
  }


  const result = await applyMutations(mutations, handleMap, nodeSpecs);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  const updatedState = useGraphStore.getState();
  updatedState.setDslShadowFromEditor(newDsl, handleMap, parseResult.ast, parseResult.sourceMap);
  const updatedDsl = getCurrentDsl();
  const response: Record<string, unknown> = {
    success: true,
    graph: updatedDsl,
    mutations_applied: mutations.length,
  };
  if (result.evalErrors && result.evalErrors.length > 0) {
    response.eval_errors = result.evalErrors.map(e => ({
      message: e.message,
      node: e.nodeId,
      nodeType: e.nodeType,
    }));
  }
  return response;
}

// ─── Exported tool definitions ───────────────────────────────────

export const cascadeTools = {
  read_graph: tool({
    description: 'Get the current graph as Cascade DSL text. The DSL uses graph { ... }, node = NodeType(...), source.output -> target.input connections, muted(NodeType(...)) wrappers, and inline asset constructors only for resolvable asset sources. Web-dropped/embedded assets are omitted from loader params.',
    inputSchema: readGraphSchema,
    execute: toolExecutors.read_graph,
  }),

  edit_graph: tool({
    description: 'Edit the graph by finding and replacing text in the Cascade DSL. Use arrow connections (source.output -> target.input), muted(...) wrappers, and inline asset constructors only for resolvable asset sources. The old_text must match exactly. The result is parsed, validated, and applied atomically.',
    inputSchema: editGraphSchema,
    execute: toolExecutors.edit_graph,
  }),

  write_graph: tool({
    description: 'Replace the entire graph with new Cascade DSL text. Use graph { ... }, node bindings, arrow connections, muted(...) wrappers, and inline asset constructors only for resolvable asset sources. Do not invent file paths for web-dropped/embedded assets. Frames/layout are not represented. The DSL is parsed, validated, diffed, and applied with minimal mutations.',
    inputSchema: writeGraphSchema,
    execute: toolExecutors.write_graph,
  }),

  view_current_image: tool({
    description: 'Capture a screenshot of the current viewer output. Use this to see the result of your changes. Returns the image directly.',
    inputSchema: viewCurrentImageSchema,
    execute: toolExecutors.view_current_image,
    toModelOutput({ output }) {
      if (typeof output === 'object' && output && 'type' in output && output.type === 'image') {
        return {
          type: 'content',
          value: [{ type: 'media', data: (output as { data: string }).data, mediaType: 'image/jpeg' }],
        };
      }
      return { type: 'json', value: output };
    },
  }),

  list_node_types: tool({
    description: 'List all available node types grouped by category. Returns type names with short descriptions. Use get_node_schema for full param/input/output details.',
    inputSchema: listNodeTypesSchema,
    execute: toolExecutors.list_node_types,
  }),

  get_node_schema: tool({
    description: 'Get the full schema for a specific node type: all params with types/ranges/options, inputs, and outputs.',
    inputSchema: getNodeSchemaSchema,
    execute: toolExecutors.get_node_schema,
  }),
  create_gpu_script: tool({
    description: 'Generate a custom GPU Script node from a text description. Creates a draft node, compiles the GLSL manifest, and returns the node id plus status/errors.',
    inputSchema: createGpuScriptSchema,
    execute: toolExecutors.create_gpu_script,
  }),
  get_gpu_script_manifest: tool({
    description: 'Fetch the compiled GPU Script manifest for an existing GPU Script node (from __script_manifest). Returns an error if the node has not been compiled yet.',
    inputSchema: getGpuScriptManifestSchema,
    execute: toolExecutors.get_gpu_script_manifest,
  }),
};

export type CascadeToolName = keyof typeof toolExecutors;

export async function executeCascadeTool(
  toolName: CascadeToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const executor = toolExecutors[toolName] as (toolArgs: Record<string, unknown>) => Promise<unknown>;
  return executor(args);
}
