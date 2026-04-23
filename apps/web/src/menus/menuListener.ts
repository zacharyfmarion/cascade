import { useEffect } from 'react';
import { isDesktopRuntime } from '../platform/runtime';
import { handleMenuAction } from './menuDefinition';

export function useTauriMenuListener(): void {
  useEffect(() => {
    if (!isDesktopRuntime()) return;

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
