import { getRuntimeSurface } from '../platform/runtime';


const STORAGE_KEY = 'cascade-analytics-debug';
const MAX_ENTRIES = 200;
const MAX_CAPTURES = 100;
const MAX_REQUESTS = 100;
const MAX_DEPTH = 4;

type DebugValue =
  | string
  | number
  | boolean
  | null
  | DebugValue[]
  | { [key: string]: DebugValue };

export interface AnalyticsDebugEntry {
  timestamp: string;
  kind: string;
  data?: DebugValue;
}

export interface AnalyticsDebugCapture {
  timestamp: string;
  source: string;
  eventName: string;
  allowed: boolean;
  properties?: DebugValue;
}

export interface AnalyticsDebugRequest {
  timestamp: string;
  stage: 'attempt' | 'response';
  url?: string;
  method?: string;
  transport?: string;
  statusCode?: number;
  hasData?: boolean;
  payload?: DebugValue;
}

export interface AnalyticsDebugBootstrapState {
  analyticsEnabled?: boolean;
  initAttempted?: boolean;
  initialized?: boolean;
  keyPresent?: boolean;
  hostPresent?: boolean;
  host?: string | null;
  runtimeSurface?: 'web' | 'desktop';
  distinctId?: string | null;
}

export interface AnalyticsDebugSnapshot {
  enabled: boolean;
  bootstrap: AnalyticsDebugBootstrapState;
  entries: AnalyticsDebugEntry[];
  captures: AnalyticsDebugCapture[];
  requests: AnalyticsDebugRequest[];
}

export interface AnalyticsDebugGlobal extends AnalyticsDebugSnapshot {
  clear: () => void;
  getSnapshot: () => AnalyticsDebugSnapshot;
}

type AnalyticsDebugHost = typeof globalThis & {
  __CASCADE_ANALYTICS_DEBUG__?: AnalyticsDebugGlobal;
  location?: { search?: string };
};

function limitPush<T>(items: T[], value: T, max: number) {
  items.push(value);
  if (items.length > max) {
    items.splice(0, items.length - max);
  }
}

function now() {
  return new Date().toISOString();
}

function getGlobalScope(): AnalyticsDebugHost {
  return globalThis as AnalyticsDebugHost;
}

function getStorageItem(key: string) {
  if (typeof localStorage === 'undefined') return null;

  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function toDebugValue(value: unknown, depth = 0): DebugValue {
  if (depth >= MAX_DEPTH) return '[max-depth]';
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'undefined':
      return '[undefined]';
    case 'function':
      return '[function]';
    case 'bigint':
      return String(value);
    case 'symbol':
      return String(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(entry => toDebugValue(entry, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    const result: Record<string, DebugValue> = {};
    for (const [key, entry] of entries) {
      result[key] = toDebugValue(entry, depth + 1);
    }
    return result;
  }

  return String(value);
}

export function isAnalyticsDebugEnabled() {
  const params = new URLSearchParams(getGlobalScope().location?.search ?? '');
  return (
    params.get('__cascade_analytics_debug') === 'true' ||
    params.get('__posthog_debug') === 'true' ||
    getStorageItem(STORAGE_KEY) === 'true'
  );
}

export function getAnalyticsDebugState(): AnalyticsDebugGlobal {
  const scope = getGlobalScope();
  const existing = scope.__CASCADE_ANALYTICS_DEBUG__;
  if (existing) {
    existing.enabled = isAnalyticsDebugEnabled();
    return existing;
  }

  const state: AnalyticsDebugGlobal = {
    enabled: isAnalyticsDebugEnabled(),
    bootstrap: {
      runtimeSurface: getRuntimeSurface(),
      distinctId: getStorageItem('cascade-analytics-distinct-id'),
    },
    entries: [],
    captures: [],
    requests: [],
    clear: () => {
      state.bootstrap = {
        runtimeSurface: getRuntimeSurface(),
        distinctId: getStorageItem('cascade-analytics-distinct-id'),
      };
      state.entries = [];
      state.captures = [];
      state.requests = [];
    },
    getSnapshot: () => ({
      enabled: state.enabled,
      bootstrap: { ...state.bootstrap },
      entries: [...state.entries],
      captures: [...state.captures],
      requests: [...state.requests],
    }),
  };

  scope.__CASCADE_ANALYTICS_DEBUG__ = state;
  return state;
}

function debugLog(kind: string, data?: unknown) {
  const state = getAnalyticsDebugState();
  if (!state.enabled) return;

  if (data === undefined) {
    console.log(`[analytics-debug] ${kind}`);
  } else {
    console.log(`[analytics-debug] ${kind}`, data);
  }
}

export function recordAnalyticsDebug(kind: string, data?: unknown) {
  const state = getAnalyticsDebugState();
  const normalized = data === undefined ? undefined : toDebugValue(data);
  limitPush(
    state.entries,
    {
      timestamp: now(),
      kind,
      data: normalized,
    },
    MAX_ENTRIES
  );
  debugLog(kind, normalized);
}

export function updateAnalyticsBootstrap(patch: Partial<AnalyticsDebugBootstrapState>) {
  const state = getAnalyticsDebugState();
  state.bootstrap = {
    ...state.bootstrap,
    ...patch,
  };
  recordAnalyticsDebug('bootstrap.update', patch);
}

export function syncAnalyticsDebugDistinctId() {
  updateAnalyticsBootstrap({
    distinctId: getStorageItem('cascade-analytics-distinct-id'),
  });
}

export function recordAnalyticsCapture(
  source: string,
  eventName: string,
  properties: unknown,
  allowed: boolean
) {
  const state = getAnalyticsDebugState();
  const capture: AnalyticsDebugCapture = {
    timestamp: now(),
    source,
    eventName,
    allowed,
    properties: toDebugValue(properties),
  };
  limitPush(state.captures, capture, MAX_CAPTURES);
  recordAnalyticsDebug('capture.recorded', capture);
}

export function recordAnalyticsRequest(
  stage: AnalyticsDebugRequest['stage'],
  request: Omit<AnalyticsDebugRequest, 'timestamp' | 'stage'>
) {
  const state = getAnalyticsDebugState();
  const entry: AnalyticsDebugRequest = {
    timestamp: now(),
    stage,
    ...request,
  };
  limitPush(state.requests, entry, MAX_REQUESTS);
  recordAnalyticsDebug(`request.${stage}`, entry);
}

export function instrumentPostHogClient(client: unknown) {
  const instrumentedClient = client as Record<string, unknown> & {
    _send_request?: (request: Record<string, unknown>) => unknown;
    __cascadeAnalyticsDebugInstrumented?: boolean;
  };

  if (instrumentedClient.__cascadeAnalyticsDebugInstrumented) return;
  instrumentedClient.__cascadeAnalyticsDebugInstrumented = true;

  const wrapMethod = (methodName: string, beforeCall?: (args: unknown[]) => void) => {
    const original = instrumentedClient[methodName];
    if (typeof original !== 'function') return;

    instrumentedClient[methodName] = function wrappedMethod(this: unknown, ...args: unknown[]) {
      beforeCall?.(args);
      return (original as (...methodArgs: unknown[]) => unknown).apply(this, args);
    };
  };

  const wrapSendRequest = () => {
    const original = instrumentedClient._send_request;
    if (typeof original !== 'function') return;

    const sendRequest = original as (request: Record<string, unknown>) => unknown;
    if ((sendRequest as { __cascadeAnalyticsDebugWrapped?: boolean }).__cascadeAnalyticsDebugWrapped) return;

    const wrappedSendRequest = function wrapped(this: unknown, request: Record<string, unknown>) {
      const callback = request.callback;
      const wrappedRequest = {
        ...request,
        callback:
          typeof callback === 'function'
            ? (response: Record<string, unknown>) => {
                recordAnalyticsRequest('response', {
                  url: typeof request.url === 'string' ? request.url : undefined,
                  method: typeof request.method === 'string' ? request.method : undefined,
                  transport: typeof request.transport === 'string' ? request.transport : undefined,
                  statusCode:
                    typeof response.statusCode === 'number' ? response.statusCode : undefined,
                  hasData: request.data !== undefined,
                  payload: toDebugValue(response),
                });
                return callback(response);
              }
            : callback,
      };

      recordAnalyticsRequest('attempt', {
        url: typeof request.url === 'string' ? request.url : undefined,
        method: typeof request.method === 'string' ? request.method : undefined,
        transport: typeof request.transport === 'string' ? request.transport : undefined,
        hasData: request.data !== undefined,
        payload: toDebugValue(request.data),
      });

      return sendRequest.call(this, wrappedRequest);
    };

    (wrappedSendRequest as typeof wrappedSendRequest & { __cascadeAnalyticsDebugWrapped?: boolean }).__cascadeAnalyticsDebugWrapped = true;
    instrumentedClient._send_request = wrappedSendRequest;
  };

  const originalInit = instrumentedClient.init;
  if (typeof originalInit === 'function') {
    instrumentedClient.init = function wrappedInit(this: unknown, ...args: unknown[]) {
      const [token, config] = args;
      recordAnalyticsDebug('client.init.called', {
        tokenPresent: Boolean(token),
        config,
      });
      const result = (originalInit as (...methodArgs: unknown[]) => unknown).apply(this, args);
      wrapSendRequest();
      return result;
    };
  }
  wrapMethod('capture', args => {
    const [eventName, properties] = args;
    recordAnalyticsCapture('posthog.capture', String(eventName), properties, true);
  });
  wrapMethod('identify', args => {
    const [distinctId] = args;
    recordAnalyticsDebug('client.identify.called', { distinctId });
  });
  wrapMethod('register', args => {
    const [properties] = args;
    recordAnalyticsDebug('client.register.called', properties);
  });
  wrapMethod('opt_in_capturing', args => {
    recordAnalyticsDebug('client.opt_in.called', args[0]);
  });
  wrapMethod('opt_out_capturing', () => {
    recordAnalyticsDebug('client.opt_out.called');
  });

  wrapSendRequest();
}

export function resetAnalyticsDebugForTests() {
  delete getGlobalScope().__CASCADE_ANALYTICS_DEBUG__;
}
