import { useCallback, useEffect, useRef } from 'react';
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useGraphStore } from '../store/graphStore';
import { useThemeStore } from '../store/themeStore';
import type { SyntaxColors } from '../themes/types';
import { serializeGraph } from '../ai/dsl/serializer';
import { deriveHandleMap } from '../ai/dsl/instance';
import { applyDsl } from '../ai/dsl/executor';
import { parseDsl } from '../ai/dsl/parser';
import { validateAst } from '../ai/dsl/validator';
import type { DslSourceMap } from '../ai/dsl/types';
import type { DiagnosticItem, NodeInstance } from '../store/types';
import type { EngineError } from '../engine/engineError';

const APPLY_DEBOUNCE_MS = 600;
const MARKER_OWNER = 'dsl-editor';
const EVAL_MARKER_OWNER = 'dsl-eval';
const LANGUAGE_ID = 'compositor-dsl';
const MONACO_THEME_ID = 'compositor-dsl';

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  automaticLayout: true,
  renderLineHighlight: 'none',
  padding: { top: 8 },
  contextmenu: false,
  folding: false,
  glyphMargin: true,
  tabSize: 2,
};

/**
 * Serialize the current graph state to DSL text.
 * Returns empty string when specs/nodes aren't ready yet.
 */
function serializeCurrent(): string {
  const { nodes, connections, nodeSpecs } = useGraphStore.getState();
  if (nodeSpecs.length === 0 || nodes.size === 0) return '';
  return serializeGraph({
    nodes,
    connections,
    nodeSpecs,
    handleMap: deriveHandleMap(nodes),
  });
}

export const DslEditor: React.FC = () => {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * When true, the next Monaco model change event should be ignored
   * because it was triggered by an external graph→editor sync, not user typing.
   */
  const suppressApplyRef = useRef(false);
  /** Track the last DSL text we pushed to the editor to avoid no-op updates. */
  const lastPushedDslRef = useRef('');
  const sourceMapRef = useRef<DslSourceMap | null>(null);

  // ─── Theme helpers ──────────────────────────────────────────────────
  /**
   * Strip leading '#' from a hex color for Monaco's foreground format.
   * Monaco expects 6-char hex without '#'.
   */
  const stripHash = useCallback((hex: string) => hex.replace(/^#/, ''), []);

  /**
   * Build Monaco token rules from SyntaxColors.
   */
  const buildTokenRules = useCallback(
    (sc: SyntaxColors): Monaco.editor.ITokenThemeRule[] => [
      { token: 'comment.dsl', foreground: stripHash(sc.comment), fontStyle: 'italic' },
      { token: 'keyword.annotation.dsl', foreground: stripHash(sc.keyword) },
      { token: 'type.node.dsl', foreground: stripHash(sc.type) },
      { token: 'variable.handle.dsl', foreground: stripHash(sc.variable) },
      { token: 'variable.parameter.dsl', foreground: stripHash(sc.parameter) },
      { token: 'variable.port.dsl', foreground: stripHash(sc.port) },
      { token: 'support.function.dsl', foreground: stripHash(sc.function) },
      { token: 'constant.boolean.dsl', foreground: stripHash(sc.keyword) },
      { token: 'number.dsl', foreground: stripHash(sc.number) },
      { token: 'number.float.dsl', foreground: stripHash(sc.number) },
      { token: 'string.dsl', foreground: stripHash(sc.string) },
      { token: 'string.escape.dsl', foreground: stripHash(sc.stringEscape) },
      { token: 'operator.arrow.dsl', foreground: stripHash(sc.operator), fontStyle: 'bold' },
      { token: 'delimiter.dsl', foreground: stripHash(sc.foreground) },
    ],
    [stripHash],
  );

  /**
   * Read CSS custom properties to build Monaco editor UI colors.
   * These come from the compositor theme tokens applied to :root.
   */
  const buildEditorColors = useCallback((): Monaco.editor.IColors => {
    const style = getComputedStyle(document.documentElement);
    const get = (v: string) => style.getPropertyValue(v).trim();
    return {
      'editor.background': get('--bg-primary'),
      'editor.foreground': get('--text-primary'),
      'editor.lineHighlightBackground': get('--bg-primary'),
      'editorLineNumber.foreground': get('--text-muted'),
      'editorCursor.foreground': get('--accent-primary'),
      'editor.selectionBackground': get('--bg-surface'),
      'editorWidget.background': get('--bg-secondary'),
      'editorWidget.border': get('--border-default'),
    };
  }, []);

  /**
   * Define (or redefine) the Monaco theme using the current compositor theme.
   */
  const defineMonacoTheme = useCallback(
    (monaco: typeof Monaco, syntaxColors: SyntaxColors, themeType: 'dark' | 'light') => {
      monaco.editor.defineTheme(MONACO_THEME_ID, {
        base: themeType === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        rules: buildTokenRules(syntaxColors),
        colors: buildEditorColors(),
      });
    },
    [buildTokenRules, buildEditorColors],
  );

  // ─── Language registration (once, before mount) ────────────────────
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    // Register custom DSL language if not already registered
    if (!monaco.languages.getLanguages().some((l: Monaco.languages.ILanguageExtensionPoint) => l.id === LANGUAGE_ID)) {
      monaco.languages.register({ id: LANGUAGE_ID });
      monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
        defaultToken: '',
        tokenPostfix: '.dsl',

        keywords: ['true', 'false'],
        builtinFunctions: ['rgba'],

        tokenizer: {
          root: [
            // Comments (# only at start of line or after whitespace)
            [/^\s*#.*$/, 'comment'],
            [/(\s+)(#.*)$/, ['white', 'comment']],

            // Annotation (@muted) — must precede handle rules
            [/@@muted/, 'keyword.annotation'],

            // Connection: handle.port <- handle.port
            [/([a-z][a-z0-9_]*)(\.)(\w+)(\s*)(<-)(\s*)([a-z][a-z0-9_]*)(\.)(\w+)/,
              ['variable.handle', 'delimiter', 'variable.port', 'white',
               'operator.arrow', 'white',
               'variable.handle', 'delimiter', 'variable.port']],

            // Node declaration: handle = NodeType or handle = Ns::NodeType
            [/([a-z][a-z0-9_]*)(\s*)(=)(\s*)([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)/,
              ['variable.handle', 'white', 'delimiter', 'white', 'type.node']],

            // Builtin functions: rgba(, palette(, ramp(, curve(
            [/(rgba|palette|ramp|curve)(\()/, ['support.function', 'delimiter']],

            // Parameter key: word followed by colon
            [/([a-z_][a-z0-9_]*)(\s*)(:)/, ['variable.parameter', 'white', 'delimiter']],

            // Boolean literals
            [/\b(true|false)\b/, 'constant.boolean'],

            // Numeric literals (floats and ints)
            [/-?\d+\.\d*/, 'number.float'],
            [/-?\.\d+/, 'number.float'],
            [/-?\d+/, 'number'],

            // String literals
            [/"/, 'string', '@string'],

            // Array brackets
            [/\[|\]/, 'delimiter.bracket'],

            // Remaining delimiters: = ( ) , .
            [/[=(),.]/, 'delimiter'],

            // Catch-all identifiers (unmatched lowercase words)
            [/[a-z_][a-z0-9_]*/, 'identifier'],

            // Whitespace
            [/\s+/, 'white'],
          ],

          string: [
            [/[^"\\]+/, 'string'],
            [/\\./, 'string.escape'],
            [/"/, 'string', '@pop'],
          ],
        },
      });
    }

    // Define initial theme from current compositor theme
    const { syntaxColors, type: themeType } = useThemeStore.getState().currentTheme;
    defineMonacoTheme(monaco, syntaxColors, themeType);
  }, [defineMonacoTheme]);

  // ─── Set markers (error squiggles) ──────────────────────────────────
  const setMarkers = useCallback(
    (errors: { line: number; message: string }[]) => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor) return;
      const model = editor.getModel();
      if (!model) return;

      const markers: Monaco.editor.IMarkerData[] = errors.map((err) => {
        const lineNumber = Math.max(1, Math.min(err.line, model.getLineCount()));
        return {
          severity: monaco.MarkerSeverity.Error,
          message: err.message,
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: model.getLineMaxColumn(lineNumber),
        };
      });

      monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
    },
    [],
  );

  const clearMarkers = useCallback(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  }, []);
  // ─── Eval markers (separate owner for eval errors) ──────────────────
  const setEvalMarkers = useCallback(
    (errors: { line?: number; message: string }[]) => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor) return;
      const model = editor.getModel();
    if (!model) return;
      const markers: Monaco.editor.IMarkerData[] = errors.map((err) => {
        const lineNumber = Math.max(1, Math.min(err.line ?? 1, model.getLineCount()));
        return {
          severity: monaco.MarkerSeverity.Warning,
          message: `[Eval] ${err.message}`,
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: model.getLineMaxColumn(lineNumber),
        };
      });

      monaco.editor.setModelMarkers(model, EVAL_MARKER_OWNER, markers);
    },
    [],
  );

  const clearEvalMarkers = useCallback(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, EVAL_MARKER_OWNER, []);
  }, []);

  const mapEvalErrorsToMarkers = useCallback(
    (errors: Array<Pick<DiagnosticItem, 'message' | 'nodeId' | 'line'>>, nodes: Map<string, NodeInstance>) => {
      const sourceMap = sourceMapRef.current;
      const handleMap = deriveHandleMap(nodes);
      return errors.map((err) => {
        let line = err.line;
        if (err.nodeId && sourceMap) {
          const handle = handleMap.getHandle(err.nodeId);
          const span = handle ? sourceMap.nodeSpans.get(handle) : undefined;
          if (span) {
            line = span.startLine;
          }
        }
        return { line: line ?? 1, message: err.message };
      });
    },
    [],
  );

  // ─── Validate only (show markers without applying) ──────────────────
  const validateAndMark = useCallback(
    (text: string) => {
      const { nodeSpecs } = useGraphStore.getState();
      if (nodeSpecs.length === 0) return;

      const parseResult = parseDsl(text, nodeSpecs);
      sourceMapRef.current = parseResult.sourceMap ?? null;
      if (parseResult.errors.length > 0) {
        setMarkers(parseResult.errors);
        return;
      }

      if (parseResult.ast) {
        const validation = validateAst(parseResult.ast, nodeSpecs);
        if (!validation.valid) {
          setMarkers(validation.errors);
          return;
        }
      }

      clearMarkers();
    },
    [setMarkers, clearMarkers],
  );

  // ─── Apply DSL text to the graph ────────────────────────────────────
  const applyDslToGraph = useCallback(
    async (text: string) => {
      const { nodes, connections, nodeSpecs } = useGraphStore.getState();
      if (nodeSpecs.length === 0) return;
      const handleMap = deriveHandleMap(nodes);
      const result = await applyDsl(
        text,
        handleMap,
        nodeSpecs,
        nodes,
        connections,
      );
      if (!result.success) {
        setMarkers(result.errors);
        clearEvalMarkers();
      } else {
        clearMarkers();
        // Show eval errors as warning markers if the render produced errors
        if (result.evalErrors && result.evalErrors.length > 0) {
          setEvalMarkers(mapEvalErrorsToMarkers(result.evalErrors, nodes));
        } else {
          clearEvalMarkers();
        }
        // After successful apply, update our tracking ref so graph→editor
        // sync recognizes this text as "already shown".
        lastPushedDslRef.current = result.updatedDsl;
      }
    },
    [setMarkers, clearMarkers, setEvalMarkers, clearEvalMarkers, mapEvalErrorsToMarkers],
  );

  // ─── Editor onChange: debounced apply ───────────────────────────────
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (suppressApplyRef.current) {
        suppressApplyRef.current = false;
        return;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const text = value ?? '';

      // Immediate feedback: validate and show markers
      validateAndMark(text);

      // Debounced: actually apply to graph
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void applyDslToGraph(text);
      }, APPLY_DEBOUNCE_MS);
    },
    [applyDslToGraph, validateAndMark],
  );

  // ─── Editor mount ───────────────────────────────────────────────────
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Set initial content
      const initialDsl = serializeCurrent();
      lastPushedDslRef.current = initialDsl;
      suppressApplyRef.current = true;
      editor.setValue(initialDsl);

    },
    [],
  );

  // ─── Theme change subscription ──────────────────────────────────────
  // Re-define the Monaco theme whenever the compositor theme changes.
  useEffect(() => {
    const unsubscribe = useThemeStore.subscribe((state) => {
      const monaco = monacoRef.current;
      if (!monaco) return;
      const { syntaxColors, type: themeType } = state.currentTheme;
      defineMonacoTheme(monaco, syntaxColors, themeType);
      // Force Monaco to re-apply the theme
      monaco.editor.setTheme(MONACO_THEME_ID);
    });
    return unsubscribe;
  }, [defineMonacoTheme]);

  // ─── Graph → Editor sync ────────────────────────────────────────────
  // Subscribe to graph store changes and push serialized DSL to the editor.
  // Skip when the DSL editor itself caused the change (origin gating).
  useEffect(() => {
    let prevNodes = useGraphStore.getState().nodes;
    let prevConnections = useGraphStore.getState().connections;
    let prevNodeSpecs = useGraphStore.getState().nodeSpecs;

    const unsubscribe = useGraphStore.subscribe((state) => {
      // Only act when the relevant slices actually changed
      if (
        state.nodes === prevNodes &&
        state.connections === prevConnections &&
        state.nodeSpecs === prevNodeSpecs
      ) {
        return;
      }
      prevNodes = state.nodes;
      prevConnections = state.connections;
      prevNodeSpecs = state.nodeSpecs;

      const editor = editorRef.current;
      if (!editor) return;

      // Don't re-serialize when the change originated from the DSL editor itself
      if (state.lastTransactionOrigin === 'dsl') return;

      const { nodes, connections, nodeSpecs } = state;
      if (nodeSpecs.length === 0 || nodes.size === 0) return;

      const newDsl = serializeGraph({
        nodes,
        connections,
        nodeSpecs,
        handleMap: deriveHandleMap(nodes),
      });

      // Skip if the serialized text hasn't changed
      if (newDsl === lastPushedDslRef.current) return;
      lastPushedDslRef.current = newDsl;

      // Suppress the onChange handler so we don't re-apply
      suppressApplyRef.current = true;
      // Preserve cursor / scroll position
      const position = editor.getPosition();
      const scrollTop = editor.getScrollTop();
      editor.setValue(newDsl);
      if (position) editor.setPosition(position);
      editor.setScrollTop(scrollTop);
      clearMarkers();
    });

    return unsubscribe;
  }, [clearMarkers]);

  useEffect(() => {
    let prevNodeErrors = useGraphStore.getState().nodeErrors;
    const unsubscribe = useGraphStore.subscribe((state) => {
      if (state.nodeErrors === prevNodeErrors) return;
      prevNodeErrors = state.nodeErrors;
      if (state.lastTransactionOrigin === 'dsl') return;
      const editor = editorRef.current;
      if (!editor) return;
      if (state.nodeErrors.size === 0) {
        clearEvalMarkers();
        return;
      }
      const errors: Array<Pick<DiagnosticItem, 'message' | 'nodeId' | 'line'>> = [];
      state.nodeErrors.forEach((err: EngineError, nodeId) => {
        errors.push({ message: err.message, nodeId: err.nodeId ?? nodeId });
      });
      setEvalMarkers(mapEvalErrorsToMarkers(errors, state.nodes));
    });

    return unsubscribe;
  }, [clearEvalMarkers, mapEvalErrorsToMarkers, setEvalMarkers]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor
        language={LANGUAGE_ID}
        theme={MONACO_THEME_ID}
        options={EDITOR_OPTIONS}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={handleChange}
      />
    </div>
  );
};
