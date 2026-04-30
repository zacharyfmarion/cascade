// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { DslEditor } from '../DslEditor';
import { useGraphStore } from '../../store/graphStore';
import { mockSpecs, makeNodeInstance } from '../../ai/dsl/__tests__/helpers';
import { HandleMap } from '../../ai/dsl/handleMap';
import { parseDsl } from '../../ai/dsl/parser';
import { buildDslShadowFromText } from '../../ai/dsl/shadow';
import type { Connection, NodeInstance, NodeSpec, ParamValue, SerializableGroupDefinition } from '../../store/types';

const monacoHarness = vi.hoisted(() => ({
  setModelMarkers: vi.fn(),
  register: vi.fn(),
  setMonarchTokensProvider: vi.fn(),
  defineTheme: vi.fn(),
  setTheme: vi.fn(),
}));

const applyDslMock = vi.hoisted(() => vi.fn());

vi.mock('@monaco-editor/react', async () => {
  const ReactModule = await import('react');
  type EditorProps = {
    beforeMount?: (monaco: typeof import('monaco-editor')) => void;
    onMount?: (editor: MonacoEditor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void;
    onChange?: (value: string | undefined) => void;
  };

  const monaco = {
    languages: {
      getLanguages: () => [],
      register: monacoHarness.register,
      setMonarchTokensProvider: monacoHarness.setMonarchTokensProvider,
    },
    editor: {
      defineTheme: monacoHarness.defineTheme,
      setTheme: monacoHarness.setTheme,
      setModelMarkers: monacoHarness.setModelMarkers,
    },
    MarkerSeverity: {
      Error: 8,
      Warning: 4,
    },
  } as unknown as typeof import('monaco-editor');

  const MockEditor = (props: EditorProps) => {
    const [value, setValue] = ReactModule.useState('');
    const valueRef = ReactModule.useRef('');
    const setEditorValue = ReactModule.useCallback((next: string) => {
      valueRef.current = next;
      setValue(next);
    }, []);
    const editor = ReactModule.useMemo(() => ({
      setValue: setEditorValue,
      getValue: () => valueRef.current,
      getModel: () => ({
        getLineCount: () => valueRef.current.split('\n').length,
        getLineMaxColumn: (line: number) => (valueRef.current.split('\n')[line - 1]?.length ?? 0) + 1,
      }),
      getPosition: () => null,
      setPosition: vi.fn(),
      getScrollTop: () => 0,
      setScrollTop: vi.fn(),
    }) as unknown as MonacoEditor.IStandaloneCodeEditor, [setEditorValue]);

    ReactModule.useEffect(() => {
      props.beforeMount?.(monaco);
      props.onMount?.(editor, monaco);
      // Monaco only mounts once; re-running this would turn editor.setValue
      // into a render loop in the test double.
    }, [editor]);

    const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setEditorValue(event.currentTarget.value);
      props.onChange?.(event.currentTarget.value);
    };

    return ReactModule.createElement('textarea', {
      'aria-label': 'DSL editor',
      value,
      onChange: handleInput,
      onInput: handleInput,
    });
  };

  return { default: MockEditor };
});

vi.mock('../../ai/dsl/executor', () => ({
  applyDsl: applyDslMock,
}));

const resetStore = (
  nodes = new Map<string, NodeInstance>(),
  connections: Connection[] = [],
) => {
  useGraphStore.setState({
    nodes,
    connections,
    selectedNodeIds: new Set(),
    nodeSpecs: mockSpecs,
    nodeSpecsById: new Map(mockSpecs.map(spec => [spec.id, spec])),
    dslShadow: null,
    customGroupDefinitions: [],
    graphRevision: 1,
    lastTransactionOrigin: null,
    nodeErrors: new Map(),
    editingStack: [{ id: 'root', label: 'Root' }],
  });
};

const blurNode = (amount: number): NodeInstance => makeNodeInstance({
  id: 'blur-node',
  typeId: 'gaussian_blur',
  params: { amount: { Float: amount } },
  inputDefaults: { amount: { Float: amount } },
});

const groupSpec: NodeSpec = {
  id: 'group::soft_blur',
  display_name: 'Soft Blur',
  category: 'User',
  description: 'User-defined group',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
};

const groupInputSpec: NodeSpec = {
  id: 'group_input',
  display_name: 'Group Input',
  category: 'Group',
  description: 'Inputs to this group',
  inputs: [],
  outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
};

const groupOutputSpec: NodeSpec = {
  id: 'group_output',
  display_name: 'Group Output',
  category: 'Group',
  description: 'Outputs from this group',
  inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [],
  params: [],
};

const softBlurDefinition: SerializableGroupDefinition = {
  id: 'group::soft_blur',
  name: 'SoftBlur',
  category: 'User',
  description: 'User-defined group',
  internal_graph: {
    nodes: [
      { id: 'input', type_id: 'group_input', params: {}, input_defaults: {}, position: [-240, 0] },
      { id: 'blur', type_id: 'gaussian_blur', params: {}, input_defaults: {}, position: [0, 0] },
      { id: 'output', type_id: 'group_output', params: {}, input_defaults: {}, position: [240, 0] },
    ],
    connections: [
      { from_node: 'input', from_port: 'image', to_node: 'blur', to_port: 'image' },
      { from_node: 'blur', from_port: 'image', to_node: 'output', to_port: 'image' },
    ],
  },
  promotions: [],
  is_builtin: false,
  explicit_inputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
  explicit_outputs: [{ name: 'image', label: 'Image', ty: 'Image' }],
};

describe('DslEditor', () => {
  beforeEach(() => {
    monacoHarness.setModelMarkers.mockClear();
    monacoHarness.register.mockClear();
    monacoHarness.setMonarchTokensProvider.mockClear();
    monacoHarness.defineTheme.mockClear();
    monacoHarness.setTheme.mockClear();
    applyDslMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows parser diagnostics as Monaco markers without applying invalid DSL', async () => {
    resetStore(new Map([['viewer-node', makeNodeInstance({ id: 'viewer-node', typeId: 'viewer' })]]));
    render(React.createElement(DslEditor));

    const editor = screen.getByLabelText('DSL editor');
    fireEvent.input(editor, { target: { value: 'graph {\n  blur1 = GaussianBlur(amount 5.0)\n}' } });

    await waitFor(() => {
      expect(monacoHarness.setModelMarkers).toHaveBeenCalledWith(
        expect.anything(),
        'dsl-editor',
        expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Invalid param syntax') })]),
      );
    });
    expect(applyDslMock).not.toHaveBeenCalled();
  });

  it('debounces valid edits and stores the applied shadow text', async () => {
    vi.useFakeTimers();
    const nodes = new Map([['blur-node', blurNode(1)]]);
    resetStore(nodes);
    const text = 'graph {\n  blur1 = GaussianBlur(amount: 2.0)\n}';
    applyDslMock.mockResolvedValue({ success: true, updatedDsl: text });
    render(React.createElement(DslEditor));

    const editor = screen.getByLabelText('DSL editor');
    fireEvent.input(editor, { target: { value: text } });
    await vi.advanceTimersByTimeAsync(600);

    expect(applyDslMock).toHaveBeenCalledOnce();
    expect(useGraphStore.getState().dslShadow?.text).toBe(text);
    expect(useGraphStore.getState().dslShadow?.status).toBe('valid');
  });

  it('reconciles external graph changes while preserving shadow comments', async () => {
    const nodes = new Map([['blur-node', blurNode(1)]]);
    resetStore(nodes);
    const handleMap = new HandleMap();
    handleMap.set('blur1', 'blur-node');
    const shadowText = [
      '# keep me',
      'graph {',
      '  blur1 = GaussianBlur(amount: 1.0) # tune',
      '}',
    ].join('\n');
    const parseResult = parseDsl(shadowText, mockSpecs, { currentNodes: nodes, handleMap });
    useGraphStore.setState({
      dslShadow: buildDslShadowFromText({
        text: shadowText,
        nodes,
        connections: [],
        graphRevision: 1,
        handleMap,
        ast: parseResult.ast,
        sourceMap: parseResult.sourceMap,
      }),
    });

    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain('# keep me'));

    const nextNodes = new Map(nodes);
    const nextParams: Record<string, ParamValue> = { amount: { Float: 2 } };
    nextNodes.set('blur-node', { ...blurNode(2), params: nextParams, inputDefaults: nextParams });
    act(() => {
      useGraphStore.setState({ nodes: nextNodes, graphRevision: 2, lastTransactionOrigin: 'ui' });
    });

    await waitFor(() => {
      expect(editor.value).toContain('# keep me');
      expect(editor.value).toContain('blur1 = GaussianBlur(amount: 2.0) # tune');
    });
  });

  it('shows canonical empty graph DSL and clears stale shadow when an external graph change removes all nodes', async () => {
    const nodes = new Map([['blur-node', blurNode(1)]]);
    resetStore(nodes);
    const handleMap = new HandleMap();
    handleMap.set('blur1', 'blur-node');
    const shadowText = [
      '# stale once graph is empty',
      'graph {',
      '  blur1 = GaussianBlur(amount: 1.0)',
      '}',
    ].join('\n');
    const parseResult = parseDsl(shadowText, mockSpecs, { currentNodes: nodes, handleMap });
    useGraphStore.setState({
      dslShadow: buildDslShadowFromText({
        text: shadowText,
        nodes,
        connections: [],
        graphRevision: 1,
        handleMap,
        ast: parseResult.ast,
        sourceMap: parseResult.sourceMap,
      }),
    });

    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain('blur1 = GaussianBlur'));

    act(() => {
      useGraphStore.setState({
        nodes: new Map(),
        connections: [],
        dslShadow: useGraphStore.getState().dslShadow,
        graphRevision: 2,
        lastTransactionOrigin: 'ui',
      });
    });

    await waitFor(() => {
      expect(editor.value).toBe('graph {\n\n}');
      expect(useGraphStore.getState().dslShadow).toBeNull();
    });
  });

  it('syncs AI-origin graph changes into the editor from the DSL shadow', async () => {
    resetStore(new Map());
    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe('graph {\n\n}'));

    const nodes = new Map([['blur-node', blurNode(3)]]);
    const handleMap = new HandleMap();
    handleMap.set('blur1', 'blur-node');
    const shadowText = 'graph {\n  blur1 = GaussianBlur(amount: 3.0)\n}';
    const parseResult = parseDsl(shadowText, mockSpecs, { currentNodes: nodes, handleMap });
    const shadow = buildDslShadowFromText({
      text: shadowText,
      nodes,
      connections: [],
      graphRevision: 2,
      handleMap,
      ast: parseResult.ast,
      sourceMap: parseResult.sourceMap,
    });

    act(() => {
      useGraphStore.setState({
        nodes,
        dslShadow: shadow,
        graphRevision: 2,
        lastTransactionOrigin: 'ai',
      });
    });

    await waitFor(() => {
      expect(editor.value).toBe(shadowText);
    });
  });

  it('syncs delayed AI shadow text after the graph has already changed', async () => {
    resetStore(new Map());
    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe('graph {\n\n}'));

    const nodes = new Map([['blur-node', blurNode(3)]]);
    act(() => {
      useGraphStore.setState({
        nodes,
        dslShadow: null,
        graphRevision: 2,
        lastTransactionOrigin: 'ai',
      });
    });

    await waitFor(() => {
      expect(editor.value).toBe('graph {\n  blur1 = GaussianBlur(amount: 3.0)\n}');
    });

    const handleMap = new HandleMap();
    handleMap.set('blur1', 'blur-node');
    const shadowText = '# generated by ai\n\ngraph {\n  blur1 = GaussianBlur(amount: 3.0)\n}';
    const parseResult = parseDsl(shadowText, mockSpecs, { currentNodes: nodes, handleMap });
    const shadow = buildDslShadowFromText({
      text: shadowText,
      nodes,
      connections: [],
      graphRevision: 2,
      handleMap,
      ast: parseResult.ast,
      sourceMap: parseResult.sourceMap,
    });

    act(() => {
      useGraphStore.setState({ dslShadow: shadow });
    });

    await waitFor(() => {
      expect(editor.value).toBe(shadowText);
    });
  });

  it('syncs project-loaded graph changes after a stale DSL origin is cleared', async () => {
    resetStore(new Map());
    useGraphStore.setState({ lastTransactionOrigin: 'dsl' });
    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toBe('graph {\n\n}'));

    const nodes = new Map([
      ['load-node', makeNodeInstance({ id: 'load-node', typeId: 'load_image', params: {} })],
      ['viewer-node', makeNodeInstance({ id: 'viewer-node', typeId: 'viewer', params: {} })],
    ]);
    const connections: Connection[] = [{
      id: 'load-to-viewer',
      fromNode: 'load-node',
      fromPort: 'image',
      toNode: 'viewer-node',
      toPort: 'image',
    }];

    act(() => {
      useGraphStore.setState({
        nodes,
        connections,
        dslShadow: null,
        graphRevision: 2,
        lastTransactionOrigin: null,
      });
    });

    await waitFor(() => {
      expect(editor.value).toContain('LoadImage()');
      expect(editor.value).toContain('Viewer()');
      expect(editor.value).toContain('.image ->');
      expect(editor.value).not.toBe('graph {\n\n}');
    });
  });

  it('keeps showing document DSL when the active canvas is inside a group', async () => {
    const rootSpecs = [...mockSpecs, groupSpec];
    const rootNodes = new Map<string, NodeInstance>([
      ['group-node', makeNodeInstance({ id: 'group-node', typeId: 'group::soft_blur' })],
    ]);
    const internalNodes = new Map<string, NodeInstance>([
      ['input', makeNodeInstance({ id: 'input', typeId: 'group_input', position: { x: -240, y: 0 } })],
      ['blur', makeNodeInstance({ id: 'blur', typeId: 'gaussian_blur', position: { x: 0, y: 0 } })],
      ['output', makeNodeInstance({ id: 'output', typeId: 'group_output', position: { x: 240, y: 0 } })],
    ]);
    const internalConnections: Connection[] = [
      { id: 'c1', fromNode: 'input', fromPort: 'image', toNode: 'blur', toPort: 'image' },
      { id: 'c2', fromNode: 'blur', fromPort: 'image', toNode: 'output', toPort: 'image' },
    ];

    useGraphStore.setState({
      nodes: internalNodes,
      connections: internalConnections,
      selectedNodeIds: new Set(),
      nodeSpecs: [...rootSpecs, groupInputSpec, groupOutputSpec],
      nodeSpecsById: new Map([...rootSpecs, groupInputSpec, groupOutputSpec].map(spec => [spec.id, spec])),
      customGroupDefinitions: [softBlurDefinition],
      dslShadow: null,
      graphRevision: 2,
      lastTransactionOrigin: 'ui',
      nodeErrors: new Map(),
      editingStack: [
        { id: 'root', label: 'Root' },
        {
          id: 'group::soft_blur',
          label: 'Soft Blur',
          groupNodeId: 'group-node',
          groupDefId: 'group::soft_blur',
          savedNodes: rootNodes,
          savedConnections: [],
          savedNodeSpecs: rootSpecs,
        },
      ],
    });

    render(React.createElement(DslEditor));
    const editor = await screen.findByLabelText('DSL editor') as HTMLTextAreaElement;

    await waitFor(() => {
      expect(editor.value).toContain('node Softblur = group {');
      expect(editor.value).toContain('input.image -> blur1.image');
      expect(editor.value).toContain('blur1.image -> output.image');
      expect(editor.value).toContain('= Softblur()');
      expect(editor.value).not.toContain('GroupInput()');
      expect(editor.value).not.toContain('GroupOutput()');
    });
  });
});
