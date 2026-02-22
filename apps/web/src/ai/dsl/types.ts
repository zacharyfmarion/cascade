export interface DslAst {
  nodes: Map<string, DslNode>;
  connections: DslConnection[];
}

export interface DslNode {
  handle: string;
  nodeType: string;
  nodeTypeId: string;
  params: Map<string, DslParamValue>;
  muted: boolean;
  line: number;
}

export type DslParamValue =
  | { type: 'float'; value: number }
  | { type: 'int'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'color'; value: [number, number, number, number] }
  | { type: 'ramp'; value: { position: number; color: [number, number, number, number] }[] }
  | { type: 'curve'; value: { x: number; y: number }[] }
  | { type: 'palette'; value: [number, number, number, number][] };

export interface DslConnection {
  fromHandle: string;
  fromPort: string;
  toHandle: string;
  toPort: string;
  line: number;
}

export type GraphMutation =
  | { type: 'addNode'; handle: string; typeId: string; params: Map<string, DslParamValue>; muted: boolean }
  | { type: 'removeNode'; handle: string }
  | { type: 'setParam'; handle: string; paramKey: string; value: DslParamValue }
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
        .toLowerCase()
    )
    .join('::');

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
