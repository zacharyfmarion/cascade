import type { NodeSpec, ParamDefault, ParamSpec, PortSpec, UiHint, ValueType } from '../../store/types';
import type {
  DslAst,
  DslCustomNodeDefinition,
  DslGroupDefinition,
  DslGpuDefinition,
  DslNode,
  DslParamValue,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from './types';
import { snakeToPascal } from './types';

const CUSTOM_SPEC_DESCRIPTIONS = new Set([
  'Custom GPU node defined in DSL',
  'Custom group node defined in DSL',
]);

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
    case 'ref':
      return 'Field';
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
    case 'ref':
      return 'reference';
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

const INPUT_DEFAULT_TYPES = new Set<ValueType>(['Float', 'Int', 'Bool', 'Color', 'String']);

const fallbackDefaultForInputType = (ty: ValueType): ParamDefault => {
  switch (ty) {
    case 'Float': return { Float: 0 };
    case 'Int': return { Int: 0 };
    case 'Bool': return { Bool: false };
    case 'Color': return { Color: [0, 0, 0, 1] };
    default: return { String: '' };
  }
};

const uiHintForInputType = (ty: ValueType): UiHint => {
  switch (ty) {
    case 'Bool': return { type: 'Checkbox' };
    case 'Color': return { type: 'ColorPicker' };
    case 'String': return { type: 'TextArea' };
    default: return { type: 'NumberInput' };
  }
};

const inputPortToParamSpec = (port: PortSpec): ParamSpec | null => {
  if (!INPUT_DEFAULT_TYPES.has(port.ty)) return null;
  return {
    key: port.name,
    label: port.label,
    ty: port.ty,
    default: port.default ?? fallbackDefaultForInputType(port.ty),
    min: port.min,
    max: port.max,
    step: port.step,
    ui_hint: port.ui_hint ?? uiHintForInputType(port.ty),
    promotable: true,
  };
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

const validateNodeInputDefaults = (node: DslNode, spec: NodeSpec, errors: ValidationError[]) => {
  const validKeys = spec.inputs
    .filter(input => inputPortToParamSpec(input) !== null)
    .map(input => input.name);

  for (const [portName, inputValue] of node.inputDefaults.entries()) {
    const portSpec = spec.inputs.find(input => input.name === portName);
    const paramSpec = portSpec ? inputPortToParamSpec(portSpec) : null;
    if (!paramSpec) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Unknown input default "${portName}" on ${node.nodeType}. Valid input defaults: ${validKeys.join(', ')}`,
      });
      continue;
    }

    if (!isParamTypeMatch(paramSpec, inputValue)) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Input default "${portName}" expects ${expectedLabelForParam(paramSpec)}, got "${dslValueLabel(inputValue)}"`,
      });
      continue;
    }

    if ((paramSpec.min !== undefined || paramSpec.max !== undefined)
      && (inputValue.type === 'float' || inputValue.type === 'int')) {
      const value = inputValue.value;
      const min = paramSpec.min ?? value;
      const max = paramSpec.max ?? value;
      if (value < min || value > max) {
        addError(errors, {
          line: node.line,
          message: `Line ${node.line}: Input default "${portName}" must be between ${min} and ${max}, got ${value}`,
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
    validateNodeInputDefaults(node, spec, errors);
  }
};

// ---------------------------------------------------------------------------
// Custom definition validation
// ---------------------------------------------------------------------------

const collectDuplicates = <T extends { name: string; line: number }>(
  items: T[],
  label: string,
  definitionName: string,
  errors: ValidationError[],
): Set<string> => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) {
      addError(errors, {
        line: item.line,
        message: `Line ${item.line}: Duplicate ${label} "${item.name}" in definition "${definitionName}"`,
      });
      dupes.add(item.name);
    }
    seen.add(item.name);
  }
  return seen;
};

const validateGpuDefinition = (
  definition: DslGpuDefinition,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) => {
  if (definition.outputs.length === 0) {
    addError(errors, {
      line: definition.line,
      message: `Line ${definition.line}: GPU node "${definition.name}" must declare at least one output`,
    });
  }
  if (!definition.code.trim()) {
    addError(errors, {
      line: definition.line,
      message: `Line ${definition.line}: GPU node "${definition.name}" has an empty code block`,
    });
  }
  collectDuplicates(definition.inputs, 'input', definition.name, errors);
  collectDuplicates(definition.outputs, 'output', definition.name, errors);

  // Warn if there are no image inputs (unusual for a GPU node)
  const hasImageInput = definition.inputs.some(
    input => input.valueType === 'image' || input.valueType === 'mask',
  );
  if (!hasImageInput && definition.inputs.length > 0) {
    warnings.push({
      line: definition.line,
      message: `GPU node "${definition.name}" has no image or mask inputs`,
    });
  }
};

const validateGroupDefinition = (
  definition: DslGroupDefinition,
  specById: Map<string, NodeSpec>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) => {
  if (definition.outputs.length === 0) {
    addError(errors, {
      line: definition.line,
      message: `Line ${definition.line}: Group node "${definition.name}" must declare at least one output`,
    });
  }

  const inputNames = collectDuplicates(definition.inputs, 'input', definition.name, errors);
  const outputNames = collectDuplicates(definition.outputs, 'output', definition.name, errors);
  const paramNames = collectDuplicates(definition.params, 'param', definition.name, errors);

  // Param names must not shadow input or output port names (would create ambiguous `param.x` refs)
  for (const param of definition.params) {
    if (inputNames.has(param.name) || outputNames.has(param.name)) {
      addError(errors, {
        line: param.line,
        message: `Line ${param.line}: Param "${param.name}" in "${definition.name}" conflicts with a port of the same name`,
      });
    }
  }

  // Reserved handles 'input' and 'output' must not be used for internal nodes
  const internalHandles = new Set<string>();
  const seenInternalHandles = new Set<string>();
  for (const node of definition.graph.nodes.values()) {
    if (node.handle === 'input' || node.handle === 'output') {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Handle "${node.handle}" is reserved and cannot be used in "${definition.name}" internal graph`,
      });
    } else if (seenInternalHandles.has(node.handle)) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Duplicate handle "${node.handle}" in "${definition.name}" internal graph`,
      });
    } else {
      seenInternalHandles.add(node.handle);
      internalHandles.add(node.handle);
    }
  }

  // Validate internal node types
  for (const node of definition.graph.nodes.values()) {
    if (!specById.has(node.nodeTypeId)) {
      const nodeTypeCandidates = Array.from(specById.values()).map(spec => snakeToPascal(spec.id));
      const suggestion = findClosestMatch(node.nodeType, nodeTypeCandidates);
      const message = suggestion
        ? `Line ${node.line}: Unknown node type "${node.nodeType}" in "${definition.name}" internal graph. Did you mean "${suggestion}"?`
        : `Line ${node.line}: Unknown node type "${node.nodeType}" in "${definition.name}" internal graph`;
      addError(errors, { line: node.line, message, suggestion: suggestion ?? undefined });
    }
  }

  // Validate param.xxx references in internal node params
  for (const node of definition.graph.nodes.values()) {
    for (const [, paramValue] of node.params) {
      if (paramValue.type === 'ref' && paramValue.value.startsWith('param.')) {
        const refName = paramValue.value.slice('param.'.length);
        if (!paramNames.has(refName)) {
          addError(errors, {
            line: node.line,
            message: `Line ${node.line}: Reference "param.${refName}" in "${definition.name}" refers to an undeclared param`,
          });
        }
      }
    }
  }

  // Validate internal graph connections
  const validFromHandles = new Set([...internalHandles, 'input']);
  const validToHandles = new Set([...internalHandles, 'output']);

  for (const conn of definition.graph.connections) {
    if (!validFromHandles.has(conn.fromHandle)) {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Unknown source "${conn.fromHandle}" in "${definition.name}" internal graph`,
      });
    } else if (conn.fromHandle === 'input' && !inputNames.has(conn.fromPort)) {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Connection references undeclared input port "${conn.fromPort}" in "${definition.name}"`,
      });
    }

    if (conn.toHandle === 'input') {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Cannot connect TO "input" in "${definition.name}" internal graph`,
      });
    } else if (!validToHandles.has(conn.toHandle)) {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Unknown destination "${conn.toHandle}" in "${definition.name}" internal graph`,
      });
    } else if (conn.toHandle === 'output' && !outputNames.has(conn.toPort)) {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Connection references undeclared output port "${conn.toPort}" in "${definition.name}"`,
      });
    }

    if (conn.fromHandle === 'output') {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Cannot connect FROM "output" in "${definition.name}" internal graph`,
      });
    }
  }

  // Warn if a declared output port is never driven
  const drivenOutputPorts = new Set(
    definition.graph.connections
      .filter(conn => conn.toHandle === 'output')
      .map(conn => conn.toPort),
  );
  for (const output of definition.outputs) {
    if (!drivenOutputPorts.has(output.name)) {
      warnings.push({
        line: output.line,
        message: `Output port "${output.name}" of "${definition.name}" is never connected internally`,
      });
    }
  }
};

const validateCustomDefinitions = (
  ast: DslAst,
  nodeSpecs: NodeSpec[],
  specById: Map<string, NodeSpec>,
  errors: ValidationError[],
  warnings: ValidationWarning[],
) => {
  if (!ast.customNodes) return;
  for (const definition of ast.customNodes.values()) {
    validateCustomDefinitionNameCollision(definition, nodeSpecs, errors);
    if (definition.kind === 'gpu') {
      validateGpuDefinition(definition, errors, warnings);
    } else {
      validateGroupDefinition(definition, specById, errors, warnings);
    }
  }
};

const typeNamesForSpec = (spec: NodeSpec): string[] => {
  const names = new Set<string>();
  names.add(snakeToPascal(spec.id));
  if (spec.id.startsWith('gpu_kernel::')) {
    names.add(snakeToPascal(spec.id.slice('gpu_kernel::'.length)));
  }
  if (spec.display_name) {
    names.add(spec.display_name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(''));
  }
  return Array.from(names).filter(Boolean);
};

const isDslGeneratedCustomSpec = (spec: NodeSpec): boolean =>
  CUSTOM_SPEC_DESCRIPTIONS.has(spec.description);

const validateCustomDefinitionNameCollision = (
  definition: DslCustomNodeDefinition,
  nodeSpecs: NodeSpec[],
  errors: ValidationError[],
) => {
  const collidingSpec = nodeSpecs.find(spec =>
    !isDslGeneratedCustomSpec(spec)
    && typeNamesForSpec(spec).includes(definition.name)
  );
  if (!collidingSpec) return;

  addError(errors, {
    line: definition.line,
    message: `Line ${definition.line}: Custom node "${definition.name}" conflicts with a built-in node type. Use a distinct name such as "${definition.name}Image".`,
  });
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

  validateCustomDefinitions(ast, nodeSpecs, specById, errors, warnings);
  validateNodeTypes(ast, specById, errors);
  validateConnections(ast, errors);
  validateWarnings(ast, warnings);

  return { valid: errors.length === 0, errors, warnings };
};
