import type { KeyCombo, ShortcutDefinition, ShortcutCategory } from './types';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const MOD_LABEL = isMac ? '\u2318' : 'Ctrl';
const SHIFT_LABEL = isMac ? '\u21E7' : 'Shift';
const ALT_LABEL = isMac ? '\u2325' : 'Alt';

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  arrowleft: '\u2190',
  arrowright: '\u2192',
  arrowup: '\u2191',
  arrowdown: '\u2193',
  tab: 'Tab',
  enter: 'Enter',
  escape: 'Esc',
  backspace: isMac ? '\u232B' : 'Backspace',
  delete: isMac ? '\u2326' : 'Del',
  home: 'Home',
  end: 'End',
  '?': '?',
  ',': ',',
};

/** Format a KeyCombo for display in the UI. */
export function formatKeyCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.mod) parts.push(MOD_LABEL);
  if (combo.alt) parts.push(ALT_LABEL);
  if (combo.shift) parts.push(SHIFT_LABEL);
  const keyLabel = KEY_LABELS[combo.key] ?? combo.key.toUpperCase();
  parts.push(keyLabel);
  return isMac ? parts.join('') : parts.join('+');
}

/** Format the first key combo of a shortcut definition as a display string. */
export function formatShortcutKeys(def: ShortcutDefinition): string {
  if (def.keys.length === 0) return '';
  return formatKeyCombo(def.keys[0]);
}

export interface ShortcutGroup {
  title: string;
  items: { action: string; shortcut: string }[];
}

/** Group registry definitions by category for modal display. */
export function groupByCategory(defs: ShortcutDefinition[]): ShortcutGroup[] {
  const order: ShortcutCategory[] = ['General', 'Node Graph', 'Playback', 'Viewer'];
  const groups = new Map<string, { action: string; shortcut: string }[]>();

  for (const def of defs) {
    const cat = def.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push({
      action: def.label,
      shortcut: formatShortcutKeys(def),
    });
  }

  return order
    .filter(cat => groups.has(cat))
    .map(cat => ({ title: cat, items: groups.get(cat)! }));
}
