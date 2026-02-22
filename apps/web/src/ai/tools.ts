import { tool } from 'ai';
import { z } from 'zod';
import { useGraphStore } from '../store/graphStore';
import type { NodeSpec, ParamSpec } from '../store/types';
import { serializeGraph } from './dsl/serializer';
import { parseDsl } from './dsl/parser';
import { validateAst } from './dsl/validator';
import { diffAst } from './dsl/differ';
import { applyMutations } from './dsl/executor';
import { captureViewerThumbnail } from './viewerSnapshot';
import { snakeToPascal } from './dsl/types';
import type { DslAst } from './dsl/types';
import { getSharedHandleMap } from './dsl/instance';

export { resetSharedHandleMap as resetHandleMap } from './dsl/instance';


function getCurrentDsl(): string {
  const { nodes, connections, nodeSpecs } = useGraphStore.getState();
  return serializeGraph({
    nodes,
    connections,
    nodeSpecs,
    handleMap: getSharedHandleMap(),
  });
}


function getCurrentAst(): DslAst {
  const { nodeSpecs } = useGraphStore.getState();
  const dslText = getCurrentDsl();
  const result = parseDsl(dslText, nodeSpecs);

  return result.ast ?? { nodes: new Map(), connections: [] };
}


function formatParamSpec(p: ParamSpec): Record<string, unknown> {
  // ui_hint carries the real structural type for complex params — p.ty is
  // misleading (e.g. ColorPalette has ty:Color, ColorRamp has ty:Float).
  let type: string = p.ty;
  let dslSyntax: string | undefined;
  if (p.ui_hint.type === 'ColorPalette') {
    type = 'ColorPalette';
    dslSyntax = '[rgba(...), rgba(...)]';
  } else if (p.ui_hint.type === 'ColorRamp') {
    type = 'ColorRamp';
    dslSyntax = '[0.0: rgba(...), 1.0: rgba(...)]';
  } else if (p.ui_hint.type === 'CurveEditor') {
    type = 'CurvePoints';
    dslSyntax = '[(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)]';
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
    desc.options = p.ui_hint.data;
  }
  return desc;
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

// ─── Tool type aliases ───────────────────────────────────────────

type ReadGraphArgs = z.infer<typeof readGraphSchema>;
type EditGraphArgs = z.infer<typeof editGraphSchema>;
type WriteGraphArgs = z.infer<typeof writeGraphSchema>;
type ViewCurrentImageArgs = z.infer<typeof viewCurrentImageSchema>;
type ListNodeTypesArgs = z.infer<typeof listNodeTypesSchema>;
type GetNodeSchemaArgs = z.infer<typeof getNodeSchemaSchema>;

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
    const specs = useGraphStore.getState().nodeSpecs;
    const groups: Record<string, string[]> = {};
    for (const s of specs) {
      const cat = s.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      const desc = s.description ? ` — ${s.description}` : '';
      groups[cat].push(`${snakeToPascal(s.id)}${desc}`);
    }
    return groups;
  },

  get_node_schema: async ({ node_type }: GetNodeSchemaArgs) => {
    const specs = useGraphStore.getState().nodeSpecs;
    const pascalToSnake = (name: string): string =>
      name
        .split('::')
        .map(part =>
          part.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
        )
        .join('::');
    const typeId = pascalToSnake(node_type);
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
};


async function applyNewDsl(newDsl: string): Promise<Record<string, unknown>> {
  const { nodeSpecs } = useGraphStore.getState();
  const handleMap = getSharedHandleMap();


  const parseResult = parseDsl(newDsl, nodeSpecs);
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


  const validation = validateAst(parseResult.ast, nodeSpecs);
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
      errors: result.errors.map(msg => ({ line: 0, message: msg })),
    };
  }


  const updatedDsl = getCurrentDsl();
  return {
    success: true,
    graph: updatedDsl,
    mutations_applied: mutations.length,
  };
}

// ─── Exported tool definitions ───────────────────────────────────

export const compositorTools = {
  read_graph: tool({
    description: 'Get the current graph as DSL text. Shows all nodes with non-default params and all connections.',
    inputSchema: readGraphSchema,
    execute: toolExecutors.read_graph,
  }),

  edit_graph: tool({
    description: 'Edit the graph by finding and replacing text in the DSL. The old_text must match exactly. The result is parsed, validated, and applied atomically. Returns the updated graph DSL or errors.',
    inputSchema: editGraphSchema,
    execute: toolExecutors.edit_graph,
  }),

  write_graph: tool({
    description: 'Replace the entire graph with new DSL text. Use for building from scratch or major restructuring. The DSL is parsed, validated, diffed against the current graph, and applied with minimal mutations.',
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
};

export type CompositorToolName = keyof typeof toolExecutors;

export async function executeCompositorTool(
  toolName: CompositorToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const executor = toolExecutors[toolName] as (toolArgs: Record<string, unknown>) => Promise<unknown>;
  return executor(args);
}
