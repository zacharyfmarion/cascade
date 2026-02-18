/**
 * Vitest global setup — provides browser-like globals that stores depend on.
 */

// Minimal localStorage polyfill for Node test environment
const storage = new Map<string, string>();

const localStorageMock: Storage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Minimal document stub for applyTheme (sets CSS vars on documentElement)
if (typeof document === 'undefined') {
  const styleProps = new Map<string, string>();
  const attrs = new Map<string, string>();
  const doc = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => { styleProps.set(name, value); },
        getPropertyValue: (name: string) => styleProps.get(name) ?? '',
      },
      setAttribute: (name: string, value: string) => { attrs.set(name, value); },
      getAttribute: (name: string) => attrs.get(name) ?? null,
    },
    createElement: () => ({
      href: '',
      download: '',
      click: () => {},
      width: 0,
      height: 0,
      getContext: () => null,
    }),
  };
  Object.defineProperty(globalThis, 'document', { value: doc, writable: true });
}

// crypto.randomUUID polyfill (available in Node 19+ but just in case)
if (!globalThis.crypto?.randomUUID) {
  const cryptoMod = await import('node:crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => cryptoMod.randomUUID() },
    writable: true,
  });
}
