import { describe, expect, it } from 'vitest';
import { getAuthoringNodeSpecs, getUnsupportedNodeMessage, isFeatureVisible, isNodeSupportedOnSurface } from './features';
import { getRuntimeSurface } from './runtime';
import type { NodeSpec } from '../store/types';

const viewerSpec: NodeSpec = {
  id: 'viewer',
  display_name: 'Viewer',
  category: 'Output',
  description: 'View the result',
  inputs: [],
  outputs: [],
  params: [],
};

const loadVideoSpec: NodeSpec = {
  id: 'load_video',
  display_name: 'Load Video',
  category: 'Input',
  description: 'Load a video file',
  inputs: [],
  outputs: [],
  params: [],
  supported_surfaces: ['desktop'],
};

describe('platform runtime helpers', () => {
  it('detects desktop from Tauri internals', () => {
    expect(getRuntimeSurface({ __TAURI_INTERNALS__: {} })).toBe('desktop');
  });

  it('detects desktop from Tauri runtime flag', () => {
    expect(getRuntimeSurface({ isTauri: true })).toBe('desktop');
  });

  it('defaults to web when Tauri internals are absent', () => {
    expect(getRuntimeSurface({})).toBe('web');
  });
});

describe('platform feature visibility helpers', () => {
  it('shows the mac download CTA on web only', () => {
    expect(isFeatureVisible('macDownloadCta', 'web')).toBe(true);
    expect(isFeatureVisible('macDownloadCta', 'desktop')).toBe(false);
  });

  it('filters desktop-only nodes out of the web authoring catalog', () => {
    const specs = getAuthoringNodeSpecs([viewerSpec, loadVideoSpec], 'web');
    expect(specs.map(spec => spec.id)).toEqual(['viewer']);
  });

  it('keeps desktop-only nodes in the desktop authoring catalog', () => {
    const specs = getAuthoringNodeSpecs([viewerSpec, loadVideoSpec], 'desktop');
    expect(specs.map(spec => spec.id)).toEqual(['viewer', 'load_video']);
  });

  it('excludes gpu_script instance types from the authoring catalog', () => {
    const gpuScriptBase: NodeSpec = { id: 'gpu_script', display_name: 'GPU Script', category: 'GPU', description: '', inputs: [], outputs: [], params: [] };
    const gpuScriptInst1: NodeSpec = { id: 'gpu_script::aaa-111', display_name: 'GPU Script', category: 'GPU', description: '', inputs: [], outputs: [], params: [] };
    const gpuScriptInst2: NodeSpec = { id: 'gpu_script::bbb-222', display_name: 'GPU Script', category: 'GPU', description: '', inputs: [], outputs: [], params: [] };
    const specs = getAuthoringNodeSpecs([gpuScriptBase, gpuScriptInst1, gpuScriptInst2], 'web');
    expect(specs.map(s => s.id)).toEqual(['gpu_script']);
  });

  it('reports unsupported desktop-only nodes clearly', () => {
    expect(isNodeSupportedOnSurface(loadVideoSpec, 'web')).toBe(false);
    expect(getUnsupportedNodeMessage(loadVideoSpec, 'web')).toBe('Load Video is only available in the desktop app.');
  });
});
