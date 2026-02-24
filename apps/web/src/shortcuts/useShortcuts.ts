import { useEffect } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { handleMenuAction } from '../menus/menuDefinition';
import { shortcutDispatcher } from './dispatcher';
import { SHORTCUT_REGISTRY } from './registry';

/**
 * Installs the centralised keyboard shortcut system.
 *
 * Call once from App.tsx. Registers global, menu, and playback handlers.
 * Component-specific shortcuts (NodeCanvas, AI toggle) register themselves
 * via shortcutDispatcher.register() in their own useEffect hooks.
 */
export function useShortcuts(): void {
  const undo = useGraphStore(s => s.undo);
  const redo = useGraphStore(s => s.redo);
  const togglePlayback = useGraphStore(s => s.togglePlayback);
  const stepForward = useGraphStore(s => s.stepForward);
  const stepBackward = useGraphStore(s => s.stepBackward);
  const goToStart = useGraphStore(s => s.goToStart);
  const goToEnd = useGraphStore(s => s.goToEnd);
  const loopPlayback = useGraphStore(s => s.loopPlayback);
  const setLoopPlayback = useGraphStore(s => s.setLoopPlayback);
  const openShortcuts = useSettingsStore(s => s.openShortcuts);

  useEffect(() => {
    shortcutDispatcher.setRegistry(SHORTCUT_REGISTRY);

    const unregisters = [
      // General
      shortcutDispatcher.register('edit.undo', () => undo()),
      shortcutDispatcher.register('edit.redo', () => redo()),
      shortcutDispatcher.register('file.save', () => handleMenuAction('file.save')),
      shortcutDispatcher.register('file.open', () => handleMenuAction('file.open')),
      shortcutDispatcher.register('file.settings', () => handleMenuAction('file.settings')),
      shortcutDispatcher.register('help.shortcuts', () => openShortcuts()),

      // Playback
      shortcutDispatcher.register('playback.toggle', () => togglePlayback()),
      shortcutDispatcher.register('playback.back', () => stepBackward()),
      shortcutDispatcher.register('playback.fwd', () => stepForward()),
      shortcutDispatcher.register('playback.start', () => goToStart()),
      shortcutDispatcher.register('playback.end', () => goToEnd()),
      shortcutDispatcher.register('playback.loop', () => setLoopPlayback(!loopPlayback)),
    ];

    const detach = shortcutDispatcher.attach();

    return () => {
      unregisters.forEach(fn => fn());
      detach();
    };
  }, [undo, redo, togglePlayback, stepForward, stepBackward, goToStart, goToEnd, loopPlayback, setLoopPlayback, openShortcuts]);
}
