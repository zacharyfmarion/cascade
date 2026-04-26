import type { DslAst, DslConnection, DslNode, DslParamValue, DslSourceMap, DslSourceSpan } from './types';
import { pascalToSnake, labelToSnake, snakeToLabel } from './types';
import type { NodeInstance, NodeSpec, ParamSpec } from '../../store/types';
import type { HandleMap } from './handleMap';

interface ParseError {
  line: number;
  message: string;
  suggestion?: string;
}

export interface ParseResult {
  ast: DslAst | null;
  errors: ParseError[];
  sourceMap?: DslSourceMap;
}

const NODE_REGEX = /^([a-z][a-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)\(([\s\S]*)\)$/;
const MUTED_NODE_REGEX = /^([a-z][a-z0-9_]*)\s*=\s*muted\(\s*([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)\(([\s\S]*)\)\s*\)$/;
const ARROW_CONNECTION_REGEX = /^([a-z][a-z0-9_]*)\.([\w]+)\s*->\s*([a-z][a-z0-9_]*)\.([\w]+)$/;
const VERSION_REGEX = /^cascade\s+\d+$/;

type StringMode = 'none' | 'double' | 'triple';

type ScanState = {
  stringMode: StringMode;
  escaped: boolean;
};

export interface ParseContext {
  currentNodes?: Map<string, NodeInstance>;
  handleMap?: HandleMap;
}

const advanceScanner = (text: string, index: number, state: ScanState): { nextIndex: number; state: ScanState } => {
  if (state.stringMode === 'triple') {
    if (text.startsWith('"""', index)) {
      return { nextIndex: index + 3, state: { stringMode: 'none', escaped: false } };
    }
    return { nextIndex: index + 1, state: { stringMode: 'triple', escaped: false } };
  }

  const char = text[index];
  if (state.stringMode === 'double') {
    if (char === '\\' && !state.escaped) {
      return { nextIndex: index + 1, state: { stringMode: 'double', escaped: true } };
    }
    if (char === '"' && !state.escaped) {
      return { nextIndex: index + 1, state: { stringMode: 'none', escaped: false } };
    }
    return { nextIndex: index + 1, state: { stringMode: 'double', escaped: false } };
  }

  if (text.startsWith('"""', index)) {
    return { nextIndex: index + 3, state: { stringMode: 'triple', escaped: false } };
  }
  if (char === '"') {
    return { nextIndex: index + 1, state: { stringMode: 'double', escaped: false } };
  }
  return { nextIndex: index + 1, state };
};

const stripInlineComment = (line: string): string => {
  let state: ScanState = { stringMode: 'none', escaped: false };
  for (let i = 0; i < line.length;) {
    const char = line[i];
    if (state.stringMode === 'none' && char === '#' && i > 0 && line[i - 1] === ' ') {
      return line.slice(0, i - 1).trimEnd();
    }
    const next = advanceScanner(line, i, state);
    state = next.state;
    i = next.nextIndex;
  }
  return line;
};

const findGraphBody = (input: string): string | null => {
  const graphMatch = /\bgraph\s*\{/.exec(input);
  if (!graphMatch) return null;

  const openIndex = input.indexOf('{', graphMatch.index);
  let depth = 0;
  let bodyStart = -1;
  let state: ScanState = { stringMode: 'none', escaped: false };

  for (let i = openIndex; i < input.length;) {
    const char = input[i];
    if (state.stringMode === 'none') {
      if (char === '{') {
        depth += 1;
        if (depth === 1) {
          bodyStart = i + 1;
        }
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && bodyStart >= 0) {
          const lineOffset = input.slice(0, bodyStart).split(/\r?\n/).length - 1;
          return `${'\n'.repeat(lineOffset)}${input.slice(bodyStart, i)}`;
        }
      }
    }
    const next = advanceScanner(input, i, state);
    state = next.state;
    i = next.nextIndex;
  }

  return null;
};

const stripDocumentShell = (input: string): string => {
  const graphBody = findGraphBody(input);
  if (graphBody !== null) return graphBody;
  return input;
};

const hasNonDocumentShellContent = (input: string): boolean =>
  input
    .split(/\r?\n/)
    .map((line) => stripInlineComment(line).trim())
    .some((line) => line && !line.startsWith('#') && !VERSION_REGEX.test(line));

export const splitTopLevelParams = (paramStr: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let state: ScanState = { stringMode: 'none', escaped: false };
  let current = '';

  for (let i = 0; i < paramStr.length;) {
    const char = paramStr[i];
    if (state.stringMode === 'none') {
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    }

    if (state.stringMode === 'none' && depth === 0 && char === ',') {
      const trimmed = current.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    const next = advanceScanner(paramStr, i, state);
    current += paramStr.slice(i, next.nextIndex);
    state = next.state;
    i = next.nextIndex;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) parts.push(trimmed);
  return parts;
};

const splitKeyValue = (entry: string): { key: string; value: string } | null => {
  let depth = 0;
  let state: ScanState = { stringMode: 'none', escaped: false };
  for (let i = 0; i < entry.length;) {
    const char = entry[i];
    if (state.stringMode === 'none') {
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    }
    if (state.stringMode === 'none' && depth === 0 && char === ':') {
      return { key: entry.slice(0, i).trim(), value: entry.slice(i + 1).trim() };
    }
    const next = advanceScanner(entry, i, state);
    state = next.state;
    i = next.nextIndex;
  }
  return null;
};

const parseNumber = (raw: string): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const parseRgba = (raw: string): [number, number, number, number] | null => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('rgba(') || !trimmed.endsWith(')')) return null;
  const inner = trimmed.slice(5, -1);
  const parts = splitTopLevelParams(inner);
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => parseNumber(part));
  if (numbers.some((num) => num === null)) return null;
  return [numbers[0] as number, numbers[1] as number, numbers[2] as number, numbers[3] as number];
};

/**
 * Strip outer bracket wrapper from array values.
 * Accepts `[...]` syntax. Returns the inner content, or null if not array syntax.
 */
const unwrapArray = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).trim();
  }
  return null;
};

const parseRamp = (raw: string): { position: number; color: [number, number, number, number] }[] | null => {
  const inner = unwrapArray(raw);
  if (inner === null) return null;
  if (!inner) return [];
  const entries = splitTopLevelParams(inner);
  const result: { position: number; color: [number, number, number, number] }[] = [];
  for (const entry of entries) {
    const parts = splitKeyValue(entry);
    if (!parts) return null;
    const position = parseNumber(parts.key);
    if (position === null) return null;
    const color = parseRgba(parts.value);
    if (!color) return null;
    result.push({ position, color });
  }
  return result;
};

const parseCurve = (raw: string): { x: number; y: number }[] | null => {
  const inner = unwrapArray(raw);
  if (inner === null) return null;
  if (!inner) return [];
  const entries = splitTopLevelParams(inner);
  const result: { x: number; y: number }[] = [];
  for (const entry of entries) {
    const point = entry.trim();
    if (!point.startsWith('(') || !point.endsWith(')')) return null;
    const innerPoint = point.slice(1, -1);
    const coords = splitTopLevelParams(innerPoint);
    if (coords.length !== 2) return null;
    const x = parseNumber(coords[0]);
    const y = parseNumber(coords[1]);
    if (x === null || y === null) return null;
    result.push({ x, y });
  }
  return result;
};

const parsePalette = (raw: string): [number, number, number, number][] | null => {
  const inner = unwrapArray(raw);
  if (inner === null) return null;
  if (!inner) return [];
  const entries = splitTopLevelParams(inner);
  const result: [number, number, number, number][] = [];
  for (const entry of entries) {
    const color = parseRgba(entry);
    if (!color) return null;
    result.push(color);
  }
  return result;
};

const expectedFormatHint = (paramSpec: ParamSpec): string => {
  if (paramSpec.ui_hint.type === 'ColorPalette') {
    return 'Expected ColorPalette: [rgba(r, g, b, a), rgba(r, g, b, a), ...] with values 0..1';
  }
  if (paramSpec.ui_hint.type === 'ColorRamp') {
    return 'Expected ColorRamp: [0.0: rgba(r, g, b, a), 1.0: rgba(r, g, b, a), ...] with positions 0..1';
  }
  if (paramSpec.ui_hint.type === 'CurveEditor') {
    return 'Expected CurvePoints: [(0.0, 0.0), (0.5, 0.7), (1.0, 1.0)] with x,y 0..1';
  }
  if (paramSpec.ui_hint.type === 'Dropdown' && 'data' in paramSpec.ui_hint) {
    return `Expected one of: ${paramSpec.ui_hint.data.map(o => `"${o}"`).join(', ')}`;
  }
  switch (paramSpec.ty) {
    case 'Float': return 'Expected a number, e.g. 5.0';
    case 'Int': return 'Expected an integer, e.g. 10';
    case 'Bool': return 'Expected true or false';
    case 'String': return 'Expected a quoted string, e.g. "hello"';
    case 'Color': return 'Expected rgba(r, g, b, a) with values 0..1';
    default: return `Expected a ${paramSpec.ty} value`;
  }
};

const parseParamValue = (paramSpec: ParamSpec, raw: string): DslParamValue | null => {
  const trimmed = raw.trim();
  if (paramSpec.ui_hint.type === 'Dropdown' && 'data' in paramSpec.ui_hint) {
    const options = paramSpec.ui_hint.data;
    const unquoted = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
    // Accept snake_case string → resolve to index
    const labelFromSnake = snakeToLabel(unquoted, options);
    if (labelFromSnake !== undefined) {
      const index = options.indexOf(labelFromSnake);
      return { type: 'dropdown', value: labelToSnake(labelFromSnake), index };
    }
    // Accept exact label match (case-insensitive) for robustness
    const exactMatch = options.find(o => o.toLowerCase() === unquoted.toLowerCase());
    if (exactMatch !== undefined) {
      const index = options.indexOf(exactMatch);
      return { type: 'dropdown', value: labelToSnake(exactMatch), index };
    }
    // Accept legacy integer index
    const num = parseNumber(unquoted);
    if (num !== null) {
      const idx = Math.round(num);
      if (idx >= 0 && idx < options.length) {
        return { type: 'dropdown', value: labelToSnake(options[idx]), index: idx };
      }
    }
    return null;
  }

  // Complex structured types — route by ui_hint before ty, because ty is
  // misleading on these params (e.g. ColorPalette has ty:Color, ColorRamp
  // has ty:Float, CurveEditor has ty:Float).
  if (paramSpec.ui_hint.type === 'ColorPalette') {
    const palette = parsePalette(trimmed);
    return palette ? { type: 'palette', value: palette } : null;
  }
  if (paramSpec.ui_hint.type === 'ColorRamp') {
    const ramp = parseRamp(trimmed);
    return ramp ? { type: 'ramp', value: ramp } : null;
  }
  if (paramSpec.ui_hint.type === 'CurveEditor') {
    const curve = parseCurve(trimmed);
    return curve ? { type: 'curve', value: curve } : null;
  }

  switch (paramSpec.ty) {
    case 'Float': {
      const value = parseNumber(trimmed);
      return value === null ? null : { type: 'float', value };
    }
    case 'Int': {
      const value = parseNumber(trimmed);
      return value === null ? null : { type: 'int', value: Math.round(value) };
    }
    case 'Bool': {
      if (trimmed === 'true') return { type: 'bool', value: true };
      if (trimmed === 'false') return { type: 'bool', value: false };
      return null;
    }
    case 'String': {
      const assetString = parseAssetConstructor(trimmed);
      if (assetString !== null) {
        return { type: 'string', value: assetString };
      }
      if (trimmed.startsWith('"""') && trimmed.endsWith('"""')) {
        let value = trimmed.slice(3, -3);
        if (value.startsWith('\n')) value = value.slice(1);
        if (value.endsWith('\n')) value = value.slice(0, -1);
        return { type: 'string', value };
      }
      const value = trimmed.startsWith('"') && trimmed.endsWith('"')
        ? (() => {
            try {
              return JSON.parse(trimmed) as string;
            } catch {
              return trimmed.slice(1, -1);
            }
          })()
        : trimmed;
      return { type: 'string', value };
    }
    case 'Color': {
      const color = parseRgba(trimmed);
      return color ? { type: 'color', value: color } : null;
    }
    case 'Field':
    case 'Image':
    case 'Mask':
      return { type: 'string', value: trimmed };
    default:
      return null;
  }
};

const parseAssetConstructor = (raw: string): string | null => {
  const trimmed = raw.trim();
  const match = /^(image|sequence|video)\s*\(([\s\S]*)\)$/.exec(trimmed);
  if (match) {
    const entries = splitTopLevelParams(match[2]);
    const first = entries[0]?.trim();
    if (first?.startsWith('"') && first.endsWith('"')) {
      try {
        return JSON.parse(first) as string;
      } catch {
        return first.slice(1, -1);
      }
    }
    return null;
  }

  if (trimmed.startsWith('images(') && trimmed.endsWith(')')) {
    return trimmed;
  }

  return null;
};

interface LogicalLine {
  text: string;
  /** 1-based line number where this logical line starts in the original input */
  startLine: number;
}

/**
 * Join continuation lines: when a line has unclosed `(`, `[`, or `"`,
 * subsequent lines are merged into the same logical line until balanced.
 * Comments and blank lines inside continuations are stripped.
 */
export const joinContinuationLines = (input: string): LogicalLine[] => {
  const rawLines = input.split(/\r?\n/);
  const result: LogicalLine[] = [];
  let buffer = '';
  let startLine = 1;
  let depth = 0; // tracks ( and [ nesting
  let state: ScanState = { stringMode: 'none', escaped: false };

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // Outside a continuation: skip blank lines and full-line comments
    if (depth === 0 && state.stringMode === 'none' && buffer === '') {
      if (!trimmed || trimmed.startsWith('#')) {
        result.push({ text: raw, startLine: i + 1 });
        continue;
      }
    }

    // Start a new logical line if buffer is empty
    if (buffer === '') {
      startLine = i + 1;
      buffer = trimmed;
    } else {
      if (state.stringMode === 'triple') {
        buffer += `\n${raw}`;
      } else {
        // Inside continuation: strip inline comments on continuation lines,
        // collapse whitespace
        const stripped = stripInlineComment(raw).trim();
        if (stripped) {
          buffer += ' ' + stripped;
        }
      }
    }

    // Scan the current raw line to update depth/string state
    for (let j = 0; j < raw.length;) {
      const char = raw[j];
      if (state.stringMode === 'none') {
        if (char === '(' || char === '[') depth += 1;
        if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
      }
      const next = advanceScanner(raw, j, state);
      state = next.state;
      j = next.nextIndex;
    }

    // If balanced, emit the logical line
    if (depth === 0 && state.stringMode === 'none') {
      result.push({ text: buffer, startLine });
      buffer = '';
    }
  }

  // Flush any remaining buffer (unclosed brackets — will produce parse errors downstream)
  if (buffer) {
    result.push({ text: buffer, startLine });
  }

  return result;
};

export function parseDsl(input: string, nodeSpecs: NodeSpec[], context?: ParseContext): ParseResult {
  const errors: ParseError[] = [];
  const nodes = new Map<string, DslNode>();
  const connections: DslConnection[] = [];
  const nodeSpans = new Map<string, DslSourceSpan>();
  const connectionSpans = new Map<string, DslSourceSpan>();
  const specById = new Map(nodeSpecs.map((spec) => [spec.id, spec]));
  const graphBody = findGraphBody(input);

  if (graphBody === null && hasNonDocumentShellContent(input)) {
    return {
      ast: { nodes, connections },
      errors: [{ line: 1, message: 'Expected a graph { ... } block' }],
      sourceMap: { nodeSpans, connectionSpans },
    };
  }

  const logicalLines = joinContinuationLines(graphBody ?? stripDocumentShell(input));
  for (const { text: line, startLine: lineNumber } of logicalLines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith('#')) continue;
    if (VERSION_REGEX.test(trimmedLine)) continue;

    const withoutComment = stripInlineComment(line).trim();
    if (!withoutComment) continue;
    if (VERSION_REGEX.test(withoutComment)) continue;

    const mutedNodeMatch = withoutComment.match(MUTED_NODE_REGEX);
    const nodeMatch = mutedNodeMatch ?? withoutComment.match(NODE_REGEX);
    if (nodeMatch) {
      const muted = Boolean(mutedNodeMatch);
      const handle = nodeMatch[1];
      const nodeType = nodeMatch[2];
      const paramsSection = nodeMatch[3];

      if (nodes.has(handle)) {
        errors.push({ line: lineNumber, message: `Duplicate handle '${handle}'` });
        continue;
      }

      const baseId = pascalToSnake(nodeType);
      const existingGpuScriptTypeId = (() => {
        if (baseId !== 'gpu_script') return null;
        const nodeId = context?.handleMap?.getNodeId(handle);
        const typeId = nodeId ? context?.currentNodes?.get(nodeId)?.typeId : undefined;
        return typeId?.startsWith('gpu_script::') ? typeId : null;
      })();
      // Try gpu_kernel:: prefix first (most nodes are GPU kernels now)
      const gpuId = `gpu_kernel::${baseId}`;
      const nodeTypeId = existingGpuScriptTypeId
        ?? (specById.has(gpuId) ? gpuId : baseId);
      const spec = specById.get(nodeTypeId);
      if (!spec) {
        errors.push({ line: lineNumber, message: `Unknown node type '${nodeType}'` });
      }

      const params = new Map<string, DslParamValue>();
      const paramSpecByKey = new Map((spec?.params ?? []).map((param) => [param.key, param]));
      const entries = splitTopLevelParams(paramsSection.trim());
      for (const entry of entries) {
        if (!entry.trim()) continue;
        const pair = splitKeyValue(entry);
        if (!pair) {
          errors.push({ line: lineNumber, message: `Invalid param syntax '${entry}'` });
          continue;
        }
        const paramKey = pair.key.startsWith('input.') ? pair.key.slice('input.'.length) : pair.key;
        const paramSpec = paramSpecByKey.get(paramKey);
        if (!paramSpec && nodeTypeId.startsWith('gpu_script') && paramKey === 'script') {
          const parsedScript = parseParamValue({
            key: 'script',
            label: 'Script',
            ty: 'String',
            default: { String: '' },
            ui_hint: { type: 'TextArea' },
            promotable: false,
          }, pair.value);
          if (!parsedScript) {
            errors.push({ line: lineNumber, message: `Invalid value for 'script'. Expected a multiline or quoted string.` });
            continue;
          }
          params.set(paramKey, parsedScript);
          continue;
        }
        if (!paramSpec) {
          errors.push({ line: lineNumber, message: `Unknown param '${pair.key}' on ${nodeType}` });
          continue;
        }
        const parsed = parseParamValue(paramSpec, pair.value);
        if (!parsed) {
          const hint = expectedFormatHint(paramSpec);
          errors.push({ line: lineNumber, message: `Invalid value for '${pair.key}'. ${hint}` });
          continue;
        }
        params.set(paramKey, parsed);
      }

      nodes.set(handle, { handle, nodeType, nodeTypeId, params, muted, line: lineNumber });
      const trimmedLine = withoutComment.trim();
      nodeSpans.set(handle, {
        startLine: lineNumber,
        startCol: 0,
        endLine: lineNumber,
        endCol: trimmedLine.length,
      });
      continue;
    }

    const connectionMatch = withoutComment.match(ARROW_CONNECTION_REGEX);
    if (connectionMatch) {
      const fromHandle = connectionMatch[1];
      const fromPort = connectionMatch[2];
      const toHandle = connectionMatch[3];
      const toPort = connectionMatch[4];
      connections.push({ fromHandle, fromPort, toHandle, toPort, line: lineNumber });
      const trimmedLine = withoutComment.trim();
      connectionSpans.set(`${fromHandle}.${fromPort}->${toHandle}.${toPort}`, {
        startLine: lineNumber,
        startCol: 0,
        endLine: lineNumber,
        endCol: trimmedLine.length,
      });
      continue;
    }

    errors.push({ line: lineNumber, message: 'Unrecognized DSL line' });
  }

  const ast: DslAst = { nodes, connections };
  const sourceMap: DslSourceMap = { nodeSpans, connectionSpans };
  return { ast, errors, sourceMap };
}
