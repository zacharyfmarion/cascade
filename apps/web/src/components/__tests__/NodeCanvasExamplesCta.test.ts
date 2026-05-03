// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NodeInstance } from '../../store/types';
import { useGraphStore } from '../../store/graphStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { NodeCanvas } from '../NodeCanvas';

const FIRST_TIME_EMPTY_STATE_TITLES = [
  "Welcome! Let's get you started.",
  'Ready to build your first graph?',
  'Start your first Cascade graph.',
  'Create your first image workflow.',
  'New project, clean canvas.',
];

const RETURNING_EMPTY_STATE_TITLES = [
  'Welcome back.',
  'Ready for another graph?',
  'Pick up with a fresh canvas.',
  'Start your next image workflow.',
  'Your node editor is ready.',
];

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
  useSettingsStore.setState({ isAiAssistantOpen: false });
};

describe('NodeCanvas examples CTA', () => {
  beforeEach(() => {
    localStorage.clear();
    resetCanvasState();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the examples CTA when the root node editor is empty', () => {
    render(React.createElement(NodeCanvas));

    expect(screen.getByTestId('empty-node-editor-cta')).toBeTruthy();
    expect(FIRST_TIME_EMPTY_STATE_TITLES.some(title => screen.queryByText(title))).toBe(true);
    expect(screen.getByText('Browse a ready-made workflow or ask AI to build the first node setup for you.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse Examples' }).className).toContain('ui-button--primary');
    expect(screen.getByRole('button', { name: 'Ask AI' }).className).toContain('ui-button--secondary');
  });

  it('uses returning-user title copy when Cascade has saved browser state', () => {
    localStorage.setItem('cascade-layout', JSON.stringify({ grid: true }));

    render(React.createElement(NodeCanvas));

    expect(RETURNING_EMPTY_STATE_TITLES.some(title => screen.queryByText(title))).toBe(true);
  });

  it('focuses the examples panel from the CTA button', () => {
    const focusExamplesPanel = vi.fn();
    useLayoutStore.setState({ focusExamplesPanel });

    render(React.createElement(NodeCanvas));
    fireEvent.click(screen.getByRole('button', { name: 'Browse Examples' }));

    expect(focusExamplesPanel).toHaveBeenCalled();
  });

  it('opens the AI assistant from the secondary CTA button', () => {
    render(React.createElement(NodeCanvas));
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(useSettingsStore.getState().isAiAssistantOpen).toBe(true);
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

  it('hides the empty state while files are dragged over the node editor', () => {
    render(React.createElement(NodeCanvas));

    expect(screen.getByTestId('empty-node-editor-cta')).toBeTruthy();

    fireEvent.dragOver(screen.getByLabelText('Node Graph Canvas'), {
      dataTransfer: {
        types: ['Files'],
        dropEffect: 'copy',
      },
    });

    expect(screen.queryByTestId('empty-node-editor-cta')).toBeNull();
  });
});
