export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';
export type ErrorDomain = 'graph' | 'eval' | 'io' | 'runtime' | 'internal';

export interface EngineError {
  code: string;
  message: string;
  severity: ErrorSeverity;
  domain: ErrorDomain;
  nodeId?: string;
  nodeType?: string;
}

export function parseEngineError(e: unknown): EngineError {
  if (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'message' in e &&
    typeof (e as Record<string, unknown>).code === 'string' &&
    typeof (e as Record<string, unknown>).message === 'string'
  ) {
    const obj = e as Record<string, unknown>;
    const result: EngineError = {
      code: obj.code as string,
      message: obj.message as string,
      severity: (typeof obj.severity === 'string' ? obj.severity : 'error') as ErrorSeverity,
      domain: (typeof obj.domain === 'string' ? obj.domain : 'runtime') as ErrorDomain,
    };
    // serde serializes as snake_case: node_id, node_type
    if (typeof obj.node_id === 'string') result.nodeId = obj.node_id;
    if (typeof obj.node_type === 'string') result.nodeType = obj.node_type;
    return result;
  }

  if (e instanceof Error) {
    return {
      code: 'UNKNOWN',
      message: e.message,
      severity: 'error',
      domain: 'runtime',
    };
  }

  if (typeof e === 'string') {
    return {
      code: 'UNKNOWN',
      message: e,
      severity: 'error',
      domain: 'runtime',
    };
  }

  return {
    code: 'UNKNOWN',
    message: String(e),
    severity: 'error',
    domain: 'runtime',
  };
}

export function makeEngineError(
  message: string,
  code: string = 'CLIENT_ERROR',
  domain: ErrorDomain = 'runtime'
): EngineError {
  return { code, message, severity: 'error', domain };
}
