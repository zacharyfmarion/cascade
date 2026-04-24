import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../store/graphStore';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec } from '../gpuScript';
import { executeCascadeTool } from '../tools';
import { buildSystemPrompt } from '../systemPrompt';

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

describe('GPU script AI schema', () => {
  beforeEach(() => {
    const gpuScriptSpec = buildGpuScriptNodeSpec(buildDefaultGpuScriptManifest('gpu_script::schema_test'));
    useGraphStore.setState({
      nodeSpecs: [gpuScriptSpec],
      nodes: new Map(),
      connections: [],
    });
  });

  it('returns GPU-script-specific editing guidance from get_node_schema', async () => {
    const result = await executeCascadeTool('get_node_schema', { node_type: 'GpuScript' }) as Record<string, unknown>;

    expect(result.type).toBe('GpuScript');
    expect(result.runtime_type).toBe('gpu_script::schema_test');
    expect(result).toHaveProperty('editable_fields');
    expect(result).toHaveProperty('glsl_context');

    const editableFields = result.editable_fields as Array<Record<string, unknown>>;
    expect(editableFields.some((field) => field.key === 'script' && field.multiline === true)).toBe(true);
    expect(editableFields.some((field) => field.key === 'supports_mask')).toBe(true);

    const editingNotes = result.editing_notes as string[];
    expect(editingNotes.some((note) => note.includes('get_gpu_script_manifest'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('Scalar controls'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('params: []'))).toBe(true);
  });

  it('tells the AI about multiline GPU-script editing in the system prompt', () => {
    const prompt = buildSystemPrompt(useGraphStore.getState().nodeSpecs);

    expect(prompt).toContain('script: """');
    expect(prompt).toContain('supports_mask');
    expect(prompt).toContain('get_gpu_script_manifest');
    expect(prompt).toContain('GpuScript');
    expect(prompt).toContain('Scalar input controls');
    expect(prompt).toContain('params: []');
  });
});
