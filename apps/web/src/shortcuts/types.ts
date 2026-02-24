/**
 * Shortcut context determines when a shortcut is eligible to fire.
 *
 * - 'global': Always fires, even in text inputs (e.g. Cmd+S to save).
 * - 'app': Fires unless a text input / code editor is focused (e.g. M, F, Space).
 */
export type ShortcutContext = 'global' | 'app';

/** Display category for grouping in the ShortcutsModal. */
export type ShortcutCategory = 'General' | 'Node Graph' | 'Playback' | 'Viewer';

/** A normalised key combination used for matching. */
export interface KeyCombo {
  key: string; // lowercase e.key value, e.g. 'm', 'z', ' ', 'arrowleft', '?'
  mod: boolean; // Cmd (mac) or Ctrl (win/linux)
  shift: boolean;
  alt: boolean;
}

/** A single shortcut definition in the registry. */
export interface ShortcutDefinition {
  /** Stable identifier, e.g. 'node.mute', 'file.save'. */
  id: string;
  /** Human-readable label for the shortcuts modal. */
  label: string;
  /** Display grouping in the shortcuts modal. */
  category: ShortcutCategory;
  /** One or more key combos that trigger this shortcut (first match wins). */
  keys: KeyCombo[];
  /** When the shortcut is allowed to fire. */
  context: ShortcutContext;
  /** Optional runtime guard (e.g. only when sequence nodes exist). */
  when?: () => boolean;
  /** Whether to allow e.repeat events (default: false). */
  repeat?: boolean;
}

/** A registered handler that can be attached/detached at runtime. */
export type ShortcutHandler = (e: KeyboardEvent) => void;
