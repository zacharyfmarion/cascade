import type { DslAst, DslConnection, DslNode, DslParamValue, DslSourceMap, DslSourceSpan } from './types';
import { pascalToSnake } from './types';
import type { NodeSpec, ParamSpec } from '../../store/types';

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

const NODE_REGEX = /^(@muted\s+)?([a-z][a-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*)\((.*)\)$/;
const CONNECTION_REGEX = /^([a-z][a-z0-9_]*)\.([\w]+)\s*<-\s*([a-z][a-z0-9_]*)\.([\w]+)$/;

const stripInlineComment = (line: string): string => {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = false;
    if (!inString && char === '#' && i > 0 && line[i - 1] === ' ') {
      return line.slice(0, i - 1).trimEnd();
    }
  }
  return line;
};

export const splitTopLevelParams = (paramStr: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = '';

  for (let i = 0; i < paramStr.length; i += 1) {
    const char = paramStr[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      current += char;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = false;

    if (!inString) {
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    }

    if (!inString && depth === 0 && char === ',') {
      const trimmed = current.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) parts.push(trimmed);
  return parts;
};

const splitKeyValue = (entry: string): { key: string; value: string } | null => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < entry.length; i += 1) {
    const char = entry[i];
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '"' && !escaped) {
      inString = !inString;
    }
    escaped = false;
    if (!inString) {
      if (char === '(' || char === '[') depth += 1;
      if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    }
    if (!inString && depth === 0 && char === ':') {
      return { key: entry.slice(0, i).trim(), value: entry.slice(i + 1).trim() };
    }
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
  if (paramSpec.ui_hint.type === 'Dropdown') {
    const value = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
    return { type: 'string', value };
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
      const value = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
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
  let inString = false;
  let escaped = false;

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    // Outside a continuation: skip blank lines and full-line comments
    if (depth === 0 && !inString && buffer === '') {
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
      // Inside continuation: strip inline comments on continuation lines,
      // collapse whitespace
      const stripped = stripInlineComment(raw).trim();
      if (stripped) {
        buffer += ' ' + stripped;
      }
    }

    // Scan the current raw line to update depth/string state
    for (let j = 0; j < raw.length; j += 1) {
      const char = raw[j];
      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === '"' && !escaped) {
        inString = !inString;
      }
      escaped = false;
      if (!inString) {
        if (char === '(' || char === '[') depth += 1;
        if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
      }
    }

    // If balanced, emit the logical line
    if (depth === 0 && !inString) {
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

export function parseDsl(input: string, nodeSpecs: NodeSpec[]): ParseResult {
  const errors: ParseError[] = [];
  const nodes = new Map<string, DslNode>();
  const connections: DslConnection[] = [];
  const nodeSpans = new Map<string, DslSourceSpan>();
  const connectionSpans = new Map<string, DslSourceSpan>();
  const specById = new Map(nodeSpecs.map((spec) => [spec.id, spec]));

  const logicalLines = joinContinuationLines(input);
  for (const { text: line, startLine: lineNumber } of logicalLines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith('#')) continue;

    const withoutComment = stripInlineComment(line).trim();
    if (!withoutComment) continue;

    const nodeMatch = withoutComment.match(NODE_REGEX);
    if (nodeMatch) {
      const muted = Boolean(nodeMatch[1]);
      const handle = nodeMatch[2];
      const nodeType = nodeMatch[3];
      const paramsSection = nodeMatch[4];

      if (nodes.has(handle)) {
        errors.push({ line: lineNumber, message: `Duplicate handle '${handle}'` });
        continue;
      }

      const nodeTypeId = pascalToSnake(nodeType);
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
        const paramSpec = paramSpecByKey.get(pair.key);
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
        params.set(pair.key, parsed);
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

    const connectionMatch = withoutComment.match(CONNECTION_REGEX);
    if (connectionMatch) {
      const toHandle = connectionMatch[1];
      const toPort = connectionMatch[2];
      const fromHandle = connectionMatch[3];
      const fromPort = connectionMatch[4];
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
