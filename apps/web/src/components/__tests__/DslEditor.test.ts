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
import type { Connection, NodeInstance, ParamValue } from '../../store/types';

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
  });
};

const blurNode = (amount: number): NodeInstance => makeNodeInstance({
  id: 'blur-node',
  typeId: 'gaussian_blur',
  params: { amount: { Float: amount } },
  inputDefaults: { amount: { Float: amount } },
});

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
});
