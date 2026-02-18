import { useEffect } from 'react';
import { handleMenuAction } from './menuDefinition';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function useTauriMenuListener(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('menu-action', (event) => {
        handleMenuAction(event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
