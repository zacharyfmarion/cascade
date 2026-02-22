import type { NodeSpec, ParamSpec, PortSpec, ValueType } from '../../store/types';
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

const getParamSpec = (spec: NodeSpec, key: string): ParamSpec | undefined =>
  spec.params.find(param => param.key === key);

const getInputSpec = (spec: NodeSpec, name: string): PortSpec | undefined =>
  spec.inputs.find(input => input.name === name);

const getOutputSpec = (spec: NodeSpec, name: string): PortSpec | undefined =>
  spec.outputs.find(output => output.name === name);

const addError = (errors: ValidationError[], error: ValidationError) => {
  errors.push(error);
};

const addWarning = (warnings: ValidationWarning[], warning: ValidationWarning) => {
  warnings.push(warning);
};

const validateNodeParams = (node: DslNode, spec: NodeSpec, errors: ValidationError[]) => {
  const validKeys = spec.params.map(param => param.key);
  for (const [paramKey, paramValue] of node.params.entries()) {
    const paramSpec = getParamSpec(spec, paramKey);
    if (!paramSpec) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Unknown param "${paramKey}" on ${node.nodeType}. Valid params: ${validKeys.join(', ')}`,
      });
      continue;
    }

    const actualType = dslValueType(paramValue);
    const expectedType = paramSpec.ty;
    if (actualType !== expectedType) {
      addError(errors, {
        line: node.line,
        message: `Line ${node.line}: Param "${paramKey}" expects ${expectedLabel(expectedType)}, got "${dslValueLabel(paramValue)}"`,
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

const validateConnections = (ast: DslAst, specById: Map<string, NodeSpec>, errors: ValidationError[]) => {
  const handles = Array.from(ast.nodes.keys());
  const handleSuggestions = handles;

  const inputConnectionLines = new Map<string, number>();
  const edgeLine = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  handles.forEach(handle => adjacency.set(handle, []));

  const addEdge = (from: string, to: string) => {
    const list = adjacency.get(from);
    if (list) list.push(to);
  };

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

    const fromSpec = specById.get(fromNode.nodeTypeId);
    const toSpec = specById.get(toNode.nodeTypeId);
    if (!fromSpec || !toSpec) continue;

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

    const outputSpec = getOutputSpec(fromSpec, conn.fromPort);
    if (!outputSpec) {
      const validOutputs = fromSpec.outputs.map(output => output.name).join(', ');
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Node "${fromNode.handle}" (${fromNode.nodeType}) has no output port "${conn.fromPort}". Valid outputs: ${validOutputs}`,
      });
      continue;
    }

    const inputSpec = getInputSpec(toSpec, conn.toPort);
    if (!inputSpec) {
      const validInputs = toSpec.inputs.map(input => input.name).join(', ');
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Node "${toNode.handle}" (${toNode.nodeType}) has no input port "${conn.toPort}". Valid inputs: ${validInputs}`,
      });
      continue;
    }

    if (outputSpec.ty !== inputSpec.ty) {
      addError(errors, {
        line: conn.line,
        message: `Line ${conn.line}: Cannot connect ${outputSpec.ty} output to ${inputSpec.ty} input`,
      });
    }

    addEdge(conn.fromHandle, conn.toHandle);
    edgeLine.set(`${conn.fromHandle}->${conn.toHandle}`, conn.line);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];
  let cycleError: ValidationError | null = null;

  const dfs = (node: string) => {
    if (cycleError) return;
    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const next of adjacency.get(node) ?? []) {
      if (cycleError) break;
      if (!visited.has(next)) {
        dfs(next);
      } else if (stack.has(next)) {
        const startIndex = path.indexOf(next);
        const cyclePath = startIndex >= 0 ? path.slice(startIndex).concat(next) : [next, node, next];
        const line = edgeLine.get(`${node}->${next}`) ?? 1;
        cycleError = {
          line,
          message: `Line ${line}: Connection creates a cycle: ${cyclePath.join(' → ')}`,
        };
      }
    }

    stack.delete(node);
    path.pop();
  };

  for (const handle of handles) {
    if (!visited.has(handle)) dfs(handle);
    if (cycleError) break;
  }

  if (cycleError) addError(errors, cycleError);
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
  validateConnections(ast, specById, errors);
  validateWarnings(ast, warnings);

  return { valid: errors.length === 0, errors, warnings };
};
