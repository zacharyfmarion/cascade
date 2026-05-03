// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NodeInstance } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { useLayoutStore } from '../../store/layoutStore';
import { NodeCanvas } from '../NodeCanvas';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'react-flow' }, children),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  useReactFlow: () => ({
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getNodes: () => [],
    getEdges: () => [],
    fitView: vi.fn(),
  }),
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  SelectionMode: { Partial: 'partial' },
}));

vi.mock('../../engine/wasmEngine', () => ({
  initWasmEngine: vi.fn(),
  wasmEngine: null,
}));

const resetCanvasState = () => {
  useGraphStore.setState({
    nodes: new Map(),
    frames: new Map(),
    connections: [],
    selectedNodeIds: new Set(),
    nodeSpecs: [],
    nodeSpecsById: new Map(),
    editingStack: [{ id: 'root', label: 'Root' }],
    fitViewRequestId: 0,
  });
};

describe('NodeCanvas examples CTA', () => {
  beforeEach(() => {
    resetCanvasState();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the examples CTA when the root node editor is empty', () => {
    render(React.createElement(NodeCanvas));

    expect(screen.getByTestId('empty-node-editor-cta')).toBeTruthy();
    expect(screen.getByText('Want a starting point? Browse examples.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse Examples' }).className).toContain('ui-button--primary');
  });

  it('focuses the examples panel from the CTA button', () => {
    const focusExamplesPanel = vi.fn();
    useLayoutStore.setState({ focusExamplesPanel });

    render(React.createElement(NodeCanvas));
    fireEvent.click(screen.getByRole('button', { name: 'Browse Examples' }));

    expect(focusExamplesPanel).toHaveBeenCalled();
  });

  it('hides the examples CTA once the graph has nodes', () => {
    useGraphStore.setState({
      nodes: new Map<string, NodeInstance>([
        ['node-1', {
          id: 'node-1',
          typeId: 'viewer',
          position: { x: 0, y: 0 },
          params: {},
          inputDefaults: {},
          muted: false,
        }],
      ]),
    });

    render(React.createElement(NodeCanvas));

    expect(screen.queryByTestId('empty-node-editor-cta')).toBeNull();
  });
});
