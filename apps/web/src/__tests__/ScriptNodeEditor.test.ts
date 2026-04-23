import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { ScriptNodeEditor } from '../components/ScriptNodeEditor';
import { createScriptEditorInitialState } from '../components/scriptNodeEditorModel';
import {
  buildDefaultGpuScriptManifest,
  buildGpuScriptManifest,
  buildGpuScriptNodeSpec,
  type GpuScriptManifest,
} from '../ai/gpuScript';

vi.mock('../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

const NODE_ID = 'gpu-script-node';
const TYPE_ID = 'gpu_script::editor_test';

describe('ScriptNodeEditor', () => {
  beforeEach(() => {
    const manifest = buildDefaultGpuScriptManifest(TYPE_ID);
    useGraphStore.setState({
      nodeSpecs: [buildGpuScriptNodeSpec(manifest)],
      nodes: new Map([[
        NODE_ID,
        {
          id: NODE_ID,
          typeId: TYPE_ID,
          position: { x: 0, y: 0 },
          muted: false,
          params: {
            __script_manifest: { String: JSON.stringify(manifest) },
          },
          inputDefaults: {},
        },
      ]]),
    });
  });

  it('shows an AI button and removes the inline AI generation controls', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ScriptNodeEditor, { nodeId: NODE_ID, typeId: TYPE_ID }),
    );

    expect(markup).toContain('Edit With AI');
    expect(markup).not.toContain('AI Generation');
    expect(markup).not.toContain('Generate GLSL');
    expect(markup).not.toContain('Anthropic API Key');
  });

  it('loads legacy manifest params as scalar input controls', () => {
    const legacyManifest: GpuScriptManifest = {
      ...buildDefaultGpuScriptManifest(TYPE_ID),
      inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
      params: [{
        key: 'amount',
        label: 'Amount',
        type: 'Float',
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        ui: 'Slider',
      }],
      kernel: 'return vec4(color.rgb * amount, color.a);',
    };
    const state = createScriptEditorInitialState(
      TYPE_ID,
      JSON.stringify(legacyManifest),
      buildGpuScriptNodeSpec(legacyManifest),
    );

    expect(state.inputs).toContainEqual({
      id: 'in_1',
      name: 'amount',
      label: 'Amount',
      ty: 'Float',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      ui: 'Slider',
    });
    expect(state.compileStatus).toBe('success');
  });

  it('emits scalar controls as inputs with no params', () => {
    const manifest = buildGpuScriptManifest(
      TYPE_ID,
      [
        { name: 'image', label: 'Image', ty: 'Image' },
        { name: 'amount', label: 'Amount', ty: 'Float', default: 0.75, min: 0, max: 1, step: 0.01 },
      ],
      [{ name: 'image', label: 'Image', ty: 'Image' }],
      [],
      'return vec4(color.rgb * amount, color.a);',
      true,
    );

    expect(manifest.params).toEqual([]);
    expect(manifest.inputs).toContainEqual({
      name: 'amount',
      label: 'Amount',
      ty: 'Float',
      default: 0.75,
      min: 0,
      max: 1,
      step: 0.01,
      ui: 'Slider',
    });
  });
});
