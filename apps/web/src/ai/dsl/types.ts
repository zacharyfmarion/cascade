export interface DslAst {
  nodes: Map<string, DslNode>;
  connections: DslConnection[];
  customNodes?: Map<string, DslCustomNodeDefinition>;
}

export type DslCustomNodeDefinition = DslGroupDefinition | DslGpuDefinition;

export interface DslPortDeclaration {
  valueType: string;
  name: string;
  optional: boolean;
  defaultValue?: DslParamValue;
  min?: number;
  max?: number;
  step?: number;
  line: number;
}

export interface DslParamDeclaration {
  valueType: string;
  name: string;
  defaultValue: DslParamValue;
  min?: number;
  max?: number;
  step?: number;
  line: number;
}

export interface DslGpuDefinition {
  kind: 'gpu';
  name: string;
  line: number;
  inputs: DslPortDeclaration[];
  outputs: DslPortDeclaration[];
  code: string;
}

export interface DslGroupDefinition {
  kind: 'group';
  name: string;
  line: number;
  inputs: DslPortDeclaration[];
  outputs: DslPortDeclaration[];
  params: DslParamDeclaration[];
  graph: {
    nodes: Map<string, DslNode>;
    connections: DslConnection[];
  };
}

export interface DslNode {
  handle: string;
  nodeType: string;
  nodeTypeId: string;
  params: Map<string, DslParamValue>;
  inputDefaults: Map<string, DslParamValue>;
  muted: boolean;
  line: number;
}

export type DslParamValue =
  | { type: 'float'; value: number }
  | { type: 'int'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'ref'; value: string }
  | { type: 'color'; value: [number, number, number, number] }
  | { type: 'ramp'; value: { position: number; color: [number, number, number, number] }[] }
  | { type: 'curve'; value: { x: number; y: number }[] }
  | { type: 'palette'; value: [number, number, number, number][] }
  | { type: 'dropdown'; value: string; index: number };

export interface DslConnection {
  fromHandle: string;
  fromPort: string;
  toHandle: string;
  toPort: string;
  line: number;
}

export interface DslSourceSpan {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type DslTriviaTargetKind = 'node' | 'connection';

export interface DslSourceTrivia {
  kind: 'comment' | 'blank';
  text: string;
  span: DslSourceSpan;
  inline: boolean;
  targetKind?: DslTriviaTargetKind;
  targetKey?: string;
}

export interface DslSourceMap {
  nodeSpans: Map<string, DslSourceSpan>;
  connectionSpans: Map<string, DslSourceSpan>;
  trivia: DslSourceTrivia[];
}

export type GraphMutation =
  | { type: 'addNode'; handle: string; typeId: string; params: Map<string, DslParamValue>; inputDefaults: Map<string, DslParamValue>; muted: boolean }
  | { type: 'removeNode'; handle: string }
  | { type: 'setParam'; handle: string; paramKey: string; value: DslParamValue }
  | { type: 'setInputDefault'; handle: string; portName: string; value: DslParamValue }
  | { type: 'connect'; fromHandle: string; fromPort: string; toHandle: string; toPort: string }
  | { type: 'disconnect'; toHandle: string; toPort: string }
  | { type: 'setMuted'; handle: string; muted: boolean };

export interface ParseError {
  line: number;
  message: string;
  suggestion?: string;
}

export interface ParseResult {
  ast: DslAst | null;
  errors: ParseError[];
  sourceMap?: DslSourceMap;
}

export interface ValidationError {
  line: number;
  message: string;
  suggestion?: string;
}

export interface ValidationWarning {
  line: number;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export const pascalToSnake = (name: string): string =>
  name
    .split('::')
    .map(part =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-zA-Z])(\d)/g, '$1_$2')
        .toLowerCase()
    )
    .join('::');

/** Convert a dropdown label like "Soft Light" or "Rounded Rectangle" to snake_case. */
export const labelToSnake = (label: string): string =>
  label.replace(/\s+/g, '_').toLowerCase();

/** Convert a snake_case value like "soft_light" back to a display label by matching against options. */
export const snakeToLabel = (snake: string, options: string[]): string | undefined =>
  options.find(opt => labelToSnake(opt) === snake);

export const snakeToPascal = (name: string): string =>
  name
    .split('::')
    .map(part =>
      part
        .split('_')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
    )
    .join('::');
