import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../store/graphStore';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec } from '../gpuScript';
import { cascadeTools, executeCascadeTool } from '../tools';
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
    expect(result.definition_type).toBe('gpu');
    expect(result).toHaveProperty('definition_example');
    expect(result).toHaveProperty('glsl_context');
    expect(result).not.toHaveProperty('editable_fields');

    const definitionExample = result.definition_example as string;
    expect(definitionExample).toContain('node FilmGlow = gpu {');
    expect(definitionExample).toContain('code """');
    expect(definitionExample).toContain('glow1 = FilmGlow(gain: 1.5)');

    const editingNotes = result.editing_notes as string[];
    expect(editingNotes.some((note) => note.includes('node Name = gpu'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('InvertImage'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('read_graph'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('write_graph'))).toBe(true);
    expect(editingNotes.some((note) => note.includes('get_gpu_script_manifest'))).toBe(false);
    expect(editingNotes.some((note) => note.includes('create_gpu_script'))).toBe(false);
  });

  it('tells the AI about multiline GPU-script editing in the system prompt', () => {
    const prompt = buildSystemPrompt(useGraphStore.getState().nodeSpecs);

    expect(prompt).toContain('node FilmGrain = gpu {');
    expect(prompt).toContain('code """');
    expect(prompt).toContain('grain1 = FilmGrain(strength: 0.2, size: 2.0)');
    expect(prompt).toContain('GpuScript');
    expect(prompt).toContain('Scalar input controls are exposed directly by name');
    expect(prompt).toContain('There is no separate GPU creation tool');
    expect(prompt).toContain('use `InvertImage`');
    expect(prompt).not.toContain('create_gpu_script');
    expect(prompt).not.toContain('get_gpu_script_manifest');
    expect(prompt).not.toContain('Manifest Fields');
  });

  it('does not expose GPU-script-specific tools to the model', () => {
    expect(Object.keys(cascadeTools)).not.toContain('create_gpu_script');
    expect(Object.keys(cascadeTools)).not.toContain('get_gpu_script_manifest');
  });
});
