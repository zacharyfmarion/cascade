import type {
  DslAst,
  DslConnection,
  DslCustomNodeDefinition,
  DslNode,
  DslParamDeclaration,
  DslParamValue,
  DslPortDeclaration,
  DslSourceMap,
  DslSourceSpan,
} from './types';
import { pascalToSnake, labelToSnake, snakeToLabel } from './types';
import type { NodeInstance, NodeSpec, ParamDefault, ParamSpec, PortSpec, ValueType } from '../../store/types';
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
const CUSTOM_NODE_HEADER_REGEX = /^node\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(group|gpu)\s*\{/;
const SECTION_HEADER_REGEX = /^(inputs|outputs|params|graph)\s*\{/;

type StringMode = 'none' | 'double' | 'triple';

type ScanState = {
  stringMode: StringMode;
  escaped: boolean;
};

export interface ParseContext {
  currentNodes?: Map<string, NodeInstance>;
  handleMap?: HandleMap;
}

const virtualLoadImagePathParam: ParamSpec = {
  key: 'path',
  label: 'Path',
  ty: 'String',
  default: { String: '' },
  ui_hint: { type: 'FilePicker' },
  promotable: false,
};

const getParamSpec = (nodeTypeId: string, paramSpecByKey: Map<string, ParamSpec>, key: string): ParamSpec | undefined => {
  if (nodeTypeId === 'load_image' && key === 'path') return virtualLoadImagePathParam;
  return paramSpecByKey.get(key);
};

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

interface DocumentBlock {
  kind: 'graph' | 'custom';
  name?: string;
  customKind?: 'group' | 'gpu';
  body: string;
  startLine: number;
  bodyLineOffset: number;
  startIndex: number;
  endIndex: number;
}

interface SectionBlock {
  name: string;
  body: string;
  startLine: number;
  bodyLineOffset: number;
}

const lineNumberAt = (input: string, index: number): number =>
  input.slice(0, index).split(/\r?\n/).length;

const findBalancedBlock = (
  input: string,
  openIndex: number,
): { body: string; endIndex: number; bodyLineOffset: number } | null => {
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
          return { body: input.slice(bodyStart, i), endIndex: i + 1, bodyLineOffset: lineOffset };
        }
      }
    }
    const next = advanceScanner(input, i, state);
    state = next.state;
    i = next.nextIndex;
  }

  return null;
};

const findDocumentBlocks = (input: string): DocumentBlock[] => {
  const blocks: DocumentBlock[] = [];
  let depth = 0;
  let state: ScanState = { stringMode: 'none', escaped: false };

  for (let i = 0; i < input.length;) {
    const char = input[i];
    if (state.stringMode === 'none') {
      if (depth === 0) {
        const rest = input.slice(i);
        const customMatch = rest.match(CUSTOM_NODE_HEADER_REGEX);
        if (customMatch?.index === 0) {
          const openIndex = i + customMatch[0].lastIndexOf('{');
          const balanced = findBalancedBlock(input, openIndex);
          if (balanced) {
            blocks.push({
              kind: 'custom',
              name: customMatch[1],
              customKind: customMatch[2] as 'group' | 'gpu',
              body: balanced.body,
              startLine: lineNumberAt(input, i),
              bodyLineOffset: balanced.bodyLineOffset,
              startIndex: i,
              endIndex: balanced.endIndex,
            });
            i = balanced.endIndex;
            continue;
          }
        }

        if (/^graph\s*\{/.test(rest)) {
          const openIndex = i + rest.indexOf('{');
          const balanced = findBalancedBlock(input, openIndex);
          if (balanced) {
            blocks.push({
              kind: 'graph',
              body: balanced.body,
              startLine: lineNumberAt(input, i),
              bodyLineOffset: balanced.bodyLineOffset,
              startIndex: i,
              endIndex: balanced.endIndex,
            });
            i = balanced.endIndex;
            continue;
          }
        }
      }

      if (char === '{') depth += 1;
      if (char === '}') depth = Math.max(0, depth - 1);
    }
    const next = advanceScanner(input, i, state);
    state = next.state;
    i = next.nextIndex;
  }

  return blocks;
};

const findGraphBody = (input: string): string | null => {
  const graph = findDocumentBlocks(input).find(block => block.kind === 'graph');
  return graph ? `${'\n'.repeat(graph.bodyLineOffset)}${graph.body}` : null;
};

const stripDocumentShell = (input: string): string => {
  const graphBody = findGraphBody(input);
  if (graphBody !== null) return graphBody;
  return input;
};

const hasNonDocumentShellContent = (input: string): boolean =>
  findDocumentBlocks(input)
    .sort((a, b) => b.startIndex - a.startIndex)
    .reduce((text, block) => `${text.slice(0, block.startIndex)}${text.slice(block.endIndex)}`, input)
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
  if (/^(param|input)\.[a-z][a-z0-9_]*$/.test(trimmed)) {
    return { type: 'ref', value: trimmed };
  }
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

const parseGraphStatements = (
  body: string,
  nodeSpecs: NodeSpec[],
  context: ParseContext | undefined,
  errors: ParseError[],
  nodes: Map<string, DslNode>,
  connections: DslConnection[],
  nodeSpans?: Map<string, DslSourceSpan>,
  connectionSpans?: Map<string, DslSourceSpan>,
) => {
  const specById = new Map(nodeSpecs.map((spec) => [spec.id, spec]));
  const logicalLines = joinContinuationLines(body);
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
      const groupId = `group::${baseId}`;
      const nodeTypeId = existingGpuScriptTypeId
        ?? (specById.has(gpuId) ? gpuId : specById.has(groupId) ? groupId : baseId);
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
        const paramSpec = getParamSpec(nodeTypeId, paramSpecByKey, paramKey);
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
      nodeSpans?.set(handle, {
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
      connectionSpans?.set(`${fromHandle}.${fromPort}->${toHandle}.${toPort}`, {
        startLine: lineNumber,
        startCol: 0,
        endLine: lineNumber,
        endCol: trimmedLine.length,
      });
      continue;
    }

    errors.push({ line: lineNumber, message: 'Unrecognized DSL line' });
  }
};

const valueTypeToParamType = (valueType: string): ParamSpec['ty'] | null => {
  switch (valueType.toLowerCase()) {
    case 'float': return 'Float';
    case 'int': return 'Int';
    case 'bool': return 'Bool';
    case 'string': return 'String';
    case 'color': return 'Color';
    case 'image': return 'Image';
    case 'mask': return 'Mask';
    case 'field': return 'Field';
    default: return null;
  }
};

const declarationParamSpec = (name: string, valueType: string): ParamSpec | null => {
  const ty = valueTypeToParamType(valueType);
  if (!ty) return null;
  return {
    key: name,
    label: name,
    ty,
    default: ty === 'Bool'
      ? { Bool: false }
      : ty === 'Int'
        ? { Int: 0 }
        : ty === 'Float'
          ? { Float: 0 }
          : ty === 'Color'
            ? { Color: [0, 0, 0, 1] }
            : { String: '' },
    ui_hint: ty === 'Bool' ? { type: 'Checkbox' } : { type: 'NumberInput' },
    promotable: true,
  };
};

const parseDeclarationExtras = (
  tokens: string[],
  startIndex: number,
): { min?: number; max?: number; step?: number } => {
  const extras: { min?: number; max?: number; step?: number } = {};
  for (let i = startIndex; i < tokens.length - 1; i += 2) {
    const value = parseNumber(tokens[i + 1]);
    if (value === null) continue;
    if (tokens[i] === 'min') extras.min = value;
    if (tokens[i] === 'max') extras.max = value;
    if (tokens[i] === 'step') extras.step = value;
  }
  return extras;
};

const parsePortDeclaration = (line: string, lineNumber: number, errors: ParseError[]): DslPortDeclaration | null => {
  const withoutComment = stripInlineComment(line).trim();
  if (!withoutComment) return null;
  const match = /^([a-z]+)\s+([a-z][a-z0-9_]*\??)(?:\s*=\s*([^\s]+))?(.*)$/.exec(withoutComment);
  if (!match) {
    errors.push({ line: lineNumber, message: `Invalid port declaration '${withoutComment}'` });
    return null;
  }
  const valueType = match[1];
  const rawName = match[2];
  const optional = rawName.endsWith('?');
  const name = optional ? rawName.slice(0, -1) : rawName;
  const spec = declarationParamSpec(name, valueType);
  if (!spec) {
    errors.push({ line: lineNumber, message: `Unknown port type '${valueType}'` });
    return null;
  }
  const tokens = match[4].trim().split(/\s+/).filter(Boolean);
  const defaultValue = match[3] ? parseParamValue(spec, match[3]) ?? undefined : undefined;
  return { valueType, name, optional, defaultValue, ...parseDeclarationExtras(tokens, 0), line: lineNumber };
};

const parseParamDeclaration = (line: string, lineNumber: number, errors: ParseError[]): DslParamDeclaration | null => {
  const withoutComment = stripInlineComment(line).trim();
  if (!withoutComment) return null;
  const match = /^([a-z]+)\s+([a-z][a-z0-9_]*)\s*=\s*([^\s]+)(.*)$/.exec(withoutComment);
  if (!match) {
    errors.push({ line: lineNumber, message: `Invalid param declaration '${withoutComment}'` });
    return null;
  }
  const valueType = match[1];
  const name = match[2];
  const spec = declarationParamSpec(name, valueType);
  if (!spec) {
    errors.push({ line: lineNumber, message: `Unknown param type '${valueType}'` });
    return null;
  }
  const defaultValue = parseParamValue(spec, match[3]);
  if (!defaultValue) {
    errors.push({ line: lineNumber, message: `Invalid default value for param '${name}'` });
    return null;
  }
  const tokens = match[4].trim().split(/\s+/).filter(Boolean);
  return { valueType, name, defaultValue, ...parseDeclarationExtras(tokens, 0), line: lineNumber };
};

const findSectionBlocks = (body: string, bodyLineOffset: number): SectionBlock[] => {
  const sections: SectionBlock[] = [];
  let state: ScanState = { stringMode: 'none', escaped: false };
  let depth = 0;

  for (let i = 0; i < body.length;) {
    const char = body[i];
    if (state.stringMode === 'none') {
      if (depth === 0) {
        const rest = body.slice(i).trimStart();
        const leading = body.slice(i).length - rest.length;
        const sectionMatch = rest.match(SECTION_HEADER_REGEX);
        if (sectionMatch?.index === 0) {
          const headerIndex = i + leading;
          const openIndex = headerIndex + sectionMatch[0].lastIndexOf('{');
          const balanced = findBalancedBlock(body, openIndex);
          if (balanced) {
            sections.push({
              name: sectionMatch[1],
              body: `${'\n'.repeat(bodyLineOffset + balanced.bodyLineOffset)}${balanced.body}`,
              startLine: bodyLineOffset + lineNumberAt(body, headerIndex),
              bodyLineOffset: bodyLineOffset + balanced.bodyLineOffset,
            });
            i = balanced.endIndex;
            continue;
          }
        }
      }
      if (char === '{') depth += 1;
      if (char === '}') depth = Math.max(0, depth - 1);
    }
    const next = advanceScanner(body, i, state);
    state = next.state;
    i = next.nextIndex;
  }

  return sections;
};

const parseDeclarations = <T>(
  section: SectionBlock | undefined,
  errors: ParseError[],
  parseLine: (line: string, lineNumber: number, errors: ParseError[]) => T | null,
): T[] => {
  if (!section) return [];
  const declarations: T[] = [];
  for (const { text, startLine } of joinContinuationLines(section.body)) {
    const parsed = parseLine(text, startLine, errors);
    if (parsed) declarations.push(parsed);
  }
  return declarations;
};

const parseTripleQuotedSection = (body: string, sectionName: string, line: number, errors: ParseError[]): string => {
  const match = new RegExp(`${sectionName}\\s+"""([\\s\\S]*?)"""`).exec(body);
  if (!match) {
    errors.push({ line, message: `Expected ${sectionName} """...""" block` });
    return '';
  }
  let value = match[1];
  if (value.startsWith('\n')) value = value.slice(1);
  if (value.endsWith('\n')) value = value.slice(0, -1);
  return value;
};

const parseCustomDefinitions = (
  blocks: DocumentBlock[],
  nodeSpecs: NodeSpec[],
  context: ParseContext | undefined,
  errors: ParseError[],
): Map<string, DslCustomNodeDefinition> => {
  const definitions = new Map<string, DslCustomNodeDefinition>();
  for (const block of blocks.filter((candidate) => candidate.kind === 'custom')) {
    if (!block.name || !block.customKind) continue;
    if (definitions.has(block.name)) {
      errors.push({ line: block.startLine, message: `Duplicate custom node '${block.name}'` });
      continue;
    }
    const sections = findSectionBlocks(block.body, block.bodyLineOffset);
    const sectionByName = new Map(sections.map(section => [section.name, section]));
    const inputs = parseDeclarations(sectionByName.get('inputs'), errors, parsePortDeclaration);
    const outputs = parseDeclarations(sectionByName.get('outputs'), errors, parsePortDeclaration);

    if (block.customKind === 'gpu') {
      definitions.set(block.name, {
        kind: 'gpu',
        name: block.name,
        line: block.startLine,
        inputs,
        outputs,
        code: parseTripleQuotedSection(block.body, 'code', block.startLine, errors),
      });
      continue;
    }

    const params = parseDeclarations(sectionByName.get('params'), errors, parseParamDeclaration);
    const graphNodes = new Map<string, DslNode>();
    const graphConnections: DslConnection[] = [];
    const graphSection = sectionByName.get('graph');
    if (graphSection) {
      parseGraphStatements(graphSection.body, nodeSpecs, context, errors, graphNodes, graphConnections);
    }
    definitions.set(block.name, {
      kind: 'group',
      name: block.name,
      line: block.startLine,
      inputs,
      outputs,
      params,
      graph: { nodes: graphNodes, connections: graphConnections },
    });
  }
  return definitions;
};

const dslDefaultToParamDefault = (value: DslParamValue): ParamDefault => {
  switch (value.type) {
    case 'float':
      return { Float: value.value };
    case 'int':
      return { Int: value.value };
    case 'bool':
      return { Bool: value.value };
    case 'color':
      return { Color: value.value };
    case 'ramp':
      return { ColorRamp: value.value };
    case 'curve':
      return { CurvePoints: value.value };
    case 'palette':
      return { ColorPalette: value.value };
    case 'string':
    case 'ref':
    case 'dropdown':
      return { String: value.value };
    default:
      return { String: '' };
  }
};

const fallbackDefaultForType = (ty: ValueType): ParamDefault => {
  switch (ty) {
    case 'Float': return { Float: 0 };
    case 'Int': return { Int: 0 };
    case 'Bool': return { Bool: false };
    case 'Color': return { Color: [0, 0, 0, 1] };
    default: return { String: '' };
  }
};

const labelFromName = (name: string): string =>
  name
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const declarationToPortSpec = (declaration: DslPortDeclaration): PortSpec => {
  const ty = valueTypeToParamType(declaration.valueType) ?? 'String';
  return {
    name: declaration.name,
    label: labelFromName(declaration.name),
    ty,
    default: declaration.defaultValue ? dslDefaultToParamDefault(declaration.defaultValue) : undefined,
    min: declaration.min,
    max: declaration.max,
    step: declaration.step,
    ui_hint: ty === 'Bool' ? { type: 'Checkbox' } : ty === 'Float' || ty === 'Int' ? { type: 'Slider' } : undefined,
  };
};

const declarationToParamSpec = (declaration: DslParamDeclaration | DslPortDeclaration): ParamSpec => {
  const ty = valueTypeToParamType(declaration.valueType) ?? 'String';
  const defaultValue = 'defaultValue' in declaration && declaration.defaultValue
    ? dslDefaultToParamDefault(declaration.defaultValue)
    : fallbackDefaultForType(ty);
  return {
    key: declaration.name,
    label: labelFromName(declaration.name),
    ty,
    default: defaultValue,
    min: declaration.min,
    max: declaration.max,
    step: declaration.step,
    ui_hint: ty === 'Bool' ? { type: 'Checkbox' } : ty === 'Float' || ty === 'Int' ? { type: 'Slider' } : { type: 'TextArea' },
    promotable: true,
  };
};

const isScalarDeclaration = (declaration: DslPortDeclaration): boolean =>
  ['float', 'int', 'bool', 'color', 'string'].includes(declaration.valueType.toLowerCase());

export const customDefinitionToNodeSpec = (definition: DslCustomNodeDefinition): NodeSpec => {
  if (definition.kind === 'gpu') {
    return {
      id: pascalToSnake(definition.name),
      display_name: labelFromName(pascalToSnake(definition.name)),
      category: 'GPU',
      description: 'Custom GPU node defined in DSL',
      inputs: definition.inputs.filter(input => !isScalarDeclaration(input)).map(declarationToPortSpec),
      outputs: definition.outputs.map(declarationToPortSpec),
      params: definition.inputs.filter(isScalarDeclaration).map(declarationToParamSpec),
    };
  }

  return {
    id: `group::${pascalToSnake(definition.name)}`,
    display_name: labelFromName(pascalToSnake(definition.name)),
    category: 'Custom',
    description: 'Custom group node defined in DSL',
    inputs: definition.inputs.map(declarationToPortSpec),
    outputs: definition.outputs.map(declarationToPortSpec),
    params: definition.params.map(declarationToParamSpec),
  };
};

export function parseDsl(input: string, nodeSpecs: NodeSpec[], context?: ParseContext): ParseResult {
  const errors: ParseError[] = [];
  const nodes = new Map<string, DslNode>();
  const connections: DslConnection[] = [];
  const nodeSpans = new Map<string, DslSourceSpan>();
  const connectionSpans = new Map<string, DslSourceSpan>();
  const blocks = findDocumentBlocks(input);
  const graphBlock = blocks.find(block => block.kind === 'graph');

  if (!graphBlock && hasNonDocumentShellContent(input)) {
    return {
      ast: { nodes, connections, customNodes: new Map() },
      errors: [{ line: 1, message: 'Expected a graph { ... } block' }],
      sourceMap: { nodeSpans, connectionSpans },
    };
  }

  const customNodes = parseCustomDefinitions(blocks, nodeSpecs, context, errors);
  const parseSpecs = [...nodeSpecs, ...Array.from(customNodes.values()).map(customDefinitionToNodeSpec)];
  const graphBody = graphBlock
    ? `${'\n'.repeat(graphBlock.bodyLineOffset)}${graphBlock.body}`
    : stripDocumentShell(input);
  parseGraphStatements(graphBody, parseSpecs, context, errors, nodes, connections, nodeSpans, connectionSpans);

  const ast: DslAst = { nodes, connections, customNodes };
  const sourceMap: DslSourceMap = { nodeSpans, connectionSpans };
  return { ast, errors, sourceMap };
}
