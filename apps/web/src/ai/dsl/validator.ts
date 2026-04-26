import type { NodeSpec, ParamSpec, ValueType } from '../../store/types';
import type {
  DslAst,
  DslNode,
  DslParamValue,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from './types';
import { snakeToPascal } from './types';

export const levenshteinDistance = (a: string, b: string): number => {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const dp: number[][] = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) dp[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) dp[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[aLen][bLen];
};

const findClosestMatch = (target: string, candidates: string[]): string | null => {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = levenshteinDistance(target, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= 3 ? best : null;
};

const dslValueType = (value: DslParamValue): ValueType => {
  switch (value.type) {
    case 'float':
      return 'Float';
    case 'int':
      return 'Int';
    case 'bool':
      return 'Bool';
    case 'string':
      return 'String';
    case 'color':
      return 'Color';
    case 'ramp':
    case 'curve':
    case 'palette':
      return 'Field';
    default:
      return 'String';
  }
};

const dslValueLabel = (value: DslParamValue): string => {
  switch (value.type) {
    case 'float':
    case 'int':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'string':
      return 'string';
    case 'color':
      return 'color';
    case 'ramp':
      return 'ramp';
    case 'curve':
      return 'curve';
    case 'palette':
      return 'palette';
    default:
      return 'unknown';
  }
};

const expectedLabel = (valueType: ValueType): string => {
  if (valueType === 'Float' || valueType === 'Int') return 'number';
  if (valueType === 'Bool') return 'boolean';
  if (valueType === 'String') return 'string';
  if (valueType === 'Color') return 'color';
  if (valueType === 'Field') return 'field';
  return valueType.toLowerCase();
};

const virtualLoadImagePathParam: ParamSpec = {
  key: 'path',
  label: 'Path',
  ty: 'String',
  default: { String: '' },
  ui_hint: { type: 'FilePicker' },
  promotable: false,
};

const getParamSpec = (node: DslNode, spec: NodeSpec, key: string): ParamSpec | undefined => {
  if (node.nodeTypeId === 'load_image' && key === 'path') return virtualLoadImagePathParam;
  return spec.params.find(param => param.key === key);
};


const addError = (errors: ValidationError[], error: ValidationError) => {
  errors.push(error);
};

const addWarning = (warnings: ValidationWarning[], warning: ValidationWarning) => {
  warnings.push(warning);
};

/**
 * Check whether a DSL param value matches its paramSpec.
 * Complex param types (ColorPalette, ColorRamp, CurveEditor) have misleading
 * `ty` values (e.g. ColorPalette has ty:'Color'), so we must route by ui_hint
 * first — exactly as the parser does.
 */
const isParamTypeMatch = (paramSpec: ParamSpec, paramValue: DslParamValue): boolean => {
  // Complex types: route by ui_hint, not ty
  if (paramSpec.ui_hint.type === 'ColorPalette') return paramValue.type === 'palette';
  if (paramSpec.ui_hint.type === 'ColorRamp') return paramValue.type === 'ramp';
  if (paramSpec.ui_hint.type === 'CurveEditor') return paramValue.type === 'curve';
  if (paramSpec.ui_hint.type === 'Dropdown') return paramValue.type === 'dropdown';
  // Simple types: compare against ty
  return dslValueType(paramValue) === paramSpec.ty;
};

const expectedLabelForParam = (paramSpec: ParamSpec): string => {
  if (paramSpec.ui_hint.type === 'ColorPalette') return 'palette [rgba(...), ...]';
  if (paramSpec.ui_hint.type === 'ColorRamp') return 'ramp [pos: rgba(...), ...]';
  if (paramSpec.ui_hint.type === 'CurveEditor') return 'curve [(x, y), ...]';
  if (paramSpec.ui_hint.type === 'Dropdown') return 'dropdown option string';
  return expectedLabel(paramSpec.ty);
};

const validateNodeParams = (node: DslNode, spec: NodeSpec, errors: ValidationError[]) => {
  const validKeys = spec.params.map(param => param.key);
  for (const [paramKey, paramValue] of node.params.entries()) {
    if (node.nodeTypeId.startsWith('gpu_script') && paramKey === 'script') {
      if (paramValue.type !== 'string') {
        addError(errors, {
          line: node.line,
          message: `Line ${node.line}: Param "script" expects string, got "${dslValueLabel(paramValue)}"`,
        });
      }
      continue;
    }
    const paramSpec = getParamSpec(node, spec, paramKey);
    if (!paramSpec) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Unknown param "${paramKey}" on ${node.nodeType}. Valid params: ${validKeys.join(', ')}`,
      });
      continue;
    }

    if (!isParamTypeMatch(paramSpec, paramValue)) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Param "${paramKey}" expects ${expectedLabelForParam(paramSpec)}, got "${dslValueLabel(paramValue)}"`,
      });
      continue;
    }

    if ((paramSpec.min !== undefined || paramSpec.max !== undefined)
      && (paramValue.type === 'float' || paramValue.type === 'int')) {
      const value = paramValue.value;
      const min = paramSpec.min ?? value;
      const max = paramSpec.max ?? value;
      if (value < min || value > max) {
        addError(errors, {
          line: node.line,
          message: `Line ${node.line}: Param "${paramKey}" must be between ${min} and ${max}, got ${value}`,
        });
      }
    }
  }
};

/**
 * Structural validation of connections. Checks only DSL-level concerns:
 * - Unknown handles (with fuzzy suggestions)
 * - Duplicate input connections
 *
 * Semantic checks (type compatibility, port existence, cycles) are handled
 * by Rust via validate_edits() — see semanticValidator.ts.
 */
const validateConnections = (ast: DslAst, errors: ValidationError[]) => {
  const handles = Array.from(ast.nodes.keys());
  const handleSuggestions = handles;
  const inputConnectionLines = new Map<string, number>();
  for (const conn of ast.connections) {
    const fromNode = ast.nodes.get(conn.fromHandle);
    const toNode = ast.nodes.get(conn.toHandle);
    if (!fromNode) {
      const suggestion = findClosestMatch(conn.fromHandle, handleSuggestions);
      const message = suggestion
        ? `Line ${conn.line}: Unknown node "${conn.fromHandle}". Did you mean "${suggestion}"?`
        : `Line ${conn.line}: Unknown node "${conn.fromHandle}".`;
      addError(errors, { line: conn.line, message, suggestion: suggestion ?? undefined });
      continue;
    }
    if (!toNode) {
      const suggestion = findClosestMatch(conn.toHandle, handleSuggestions);
      const message = suggestion
        ? `Line ${conn.line}: Unknown node "${conn.toHandle}". Did you mean "${suggestion}"?`
        : `Line ${conn.line}: Unknown node "${conn.toHandle}".`;
      addError(errors, { line: conn.line, message, suggestion: suggestion ?? undefined });
      continue;
    }
    const inputKey = `${conn.toHandle}.${conn.toPort}`;
    if (inputConnectionLines.has(inputKey)) {
      const prevLine = inputConnectionLines.get(inputKey) ?? conn.line;
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Input "${inputKey}" already connected on line ${prevLine}`,
      });
    } else {
      inputConnectionLines.set(inputKey, conn.line);
    }
  }
};

const validateNodeTypes = (ast: DslAst, specById: Map<string, NodeSpec>, errors: ValidationError[]) => {
  const nodeTypeCandidates = Array.from(specById.values()).map(spec => snakeToPascal(spec.id));
  const seenHandles = new Map<string, number>();

  for (const node of ast.nodes.values()) {
    if (seenHandles.has(node.handle)) {
      const prevLine = seenHandles.get(node.handle) ?? node.line;
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Handle "${node.handle}" already declared on line ${prevLine}`,
      });
      continue;
    }
    seenHandles.set(node.handle, node.line);

    const spec = specById.get(node.nodeTypeId);
    if (!spec) {
      const suggestion = findClosestMatch(node.nodeType, nodeTypeCandidates);
      const message = suggestion
        ? `Line ${node.line}: Unknown node type "${node.nodeType}". Did you mean "${suggestion}"?`
        : `Line ${node.line}: Unknown node type "${node.nodeType}".`;
      addError(errors, { line: node.line, message, suggestion: suggestion ?? undefined });
      continue;
    }

    validateNodeParams(node, spec, errors);
  }
};

const validateWarnings = (ast: DslAst, warnings: ValidationWarning[]) => {
  const connectedHandles = new Set<string>();
  for (const conn of ast.connections) {
    connectedHandles.add(conn.fromHandle);
    connectedHandles.add(conn.toHandle);
  }

  for (const node of ast.nodes.values()) {
    if (!connectedHandles.has(node.handle)) {
      addWarning(warnings, {
        line: node.line,
        message: `Node ${node.handle} has no connections`,
      });
    }
  }

  const hasViewer = Array.from(ast.nodes.values()).some(node => node.nodeTypeId === 'viewer');
  if (!hasViewer) {
    addWarning(warnings, { line: 1, message: 'No viewer node in graph' });
  }
};

export const validateAst = (ast: DslAst, nodeSpecs: NodeSpec[]): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const specById = new Map(nodeSpecs.map(spec => [spec.id, spec]));

  validateNodeTypes(ast, specById, errors);
  validateConnections(ast, errors);
  validateWarnings(ast, warnings);

  return { valid: errors.length === 0, errors, warnings };
};
