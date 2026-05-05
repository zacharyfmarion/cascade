export type RuntimeSurface = 'web' | 'desktop';

type RuntimeHost = Record<string, unknown>;

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
const TAURI_FLAG_KEY = 'isTauri';

const getDefaultHost = (): RuntimeHost | undefined => {
  if (typeof window !== 'undefined') {
    return window as unknown as RuntimeHost;
  }

  if (typeof globalThis !== 'undefined') {
    return globalThis as RuntimeHost;
  }

  return undefined;
};

export function getRuntimeSurface(host: RuntimeHost | undefined = getDefaultHost()): RuntimeSurface {
  return host && (TAURI_INTERNALS_KEY in host || host[TAURI_FLAG_KEY] === true) ? 'desktop' : 'web';
}

export function isDesktopRuntime(host?: RuntimeHost): boolean {
  return getRuntimeSurface(host) === 'desktop';
}

export function isWebRuntime(host?: RuntimeHost): boolean {
  return getRuntimeSurface(host) === 'web';
}
