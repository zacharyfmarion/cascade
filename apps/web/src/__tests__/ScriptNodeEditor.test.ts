import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../store/graphStore';
import { ScriptNodeEditor } from '../components/ScriptNodeEditor';
import { buildDefaultGpuScriptManifest, buildGpuScriptNodeSpec } from '../ai/gpuScript';

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
});
