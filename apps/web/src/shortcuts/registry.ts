import type { ShortcutDefinition } from './types';
import { useGraphStore } from '../store/graphStore';

// Helpers to reduce boilerplate in key definitions
const key = (k: string): { key: string; mod: false; shift: false; alt: false } => ({
  key: k, mod: false, shift: false, alt: false,
});
const mod = (k: string): { key: string; mod: true; shift: false; alt: false } => ({
  key: k, mod: true, shift: false, alt: false,
});
const modShift = (k: string): { key: string; mod: true; shift: true; alt: false } => ({
  key: k, mod: true, shift: true, alt: false,
});
const modAlt = (k: string): { key: string; mod: true; shift: false; alt: true } => ({
  key: k, mod: true, shift: false, alt: true,
});

const hasSequenceNodes = (): boolean => useGraphStore.getState().hasSequenceNodes;

/**
 * Central shortcut registry — single source of truth.
 *
 * Every keyboard shortcut in the app is defined here.
 * The ShortcutsModal reads this array to auto-generate its content.
 * The dispatcher matches keydown events against these definitions.
 *
 * context:
 *   'global' → fires even when a text input / Monaco is focused (e.g. Cmd+S).
 *   'app'    → suppressed when a text input is focused (e.g. M, F, Space).
 */
export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  // ── General ──────────────────────────────────────────────────────
  { id: 'edit.undo',       label: 'Undo',                 category: 'General',    keys: [mod('z')],              context: 'app' },
  { id: 'edit.redo',       label: 'Redo',                 category: 'General',    keys: [modShift('z')],         context: 'app' },
  { id: 'file.new',        label: 'New Project',          category: 'General',    keys: [mod('n')],              context: 'global' },
  { id: 'file.save',       label: 'Save',                 category: 'General',    keys: [mod('s')],              context: 'global' },
  { id: 'file.saveAs',     label: 'Save As',              category: 'General',    keys: [modShift('s')],         context: 'global' },
  { id: 'file.open',       label: 'Open Project',         category: 'General',    keys: [mod('o')],              context: 'global' },
  { id: 'file.settings',   label: 'Settings',             category: 'General',    keys: [mod(',')],              context: 'global' },
  { id: 'help.shortcuts',  label: 'Show Shortcuts',       category: 'General',    keys: [key('?')],              context: 'app' },
  { id: 'ui.toggleAi',     label: 'Toggle AI Assistant',  category: 'General',    keys: [mod('l')],              context: 'global' },

  // ── Node Graph ───────────────────────────────────────────────────
  { id: 'node.copy',       label: 'Copy',                 category: 'Node Graph', keys: [mod('c')],              context: 'app' },
  { id: 'node.cut',        label: 'Cut',                  category: 'Node Graph', keys: [mod('x')],              context: 'app' },
  { id: 'node.paste',      label: 'Paste',                category: 'Node Graph', keys: [mod('v')],              context: 'app' },
  { id: 'node.frame',      label: 'Frame Selection',      category: 'Node Graph', keys: [key('f')],              context: 'app' },
  { id: 'node.group',      label: 'Group Nodes',          category: 'Node Graph', keys: [mod('g')],              context: 'app' },
  { id: 'node.ungroup',    label: 'Ungroup',              category: 'Node Graph', keys: [modAlt('g')],           context: 'app' },
  { id: 'node.mute',       label: 'Mute / Unmute',        category: 'Node Graph', keys: [key('m')],              context: 'app' },
  { id: 'node.tabGroup',   label: 'Enter / Exit Group',   category: 'Node Graph', keys: [key('tab')],            context: 'app' },

  // ── Playback ─────────────────────────────────────────────────────
  { id: 'playback.toggle', label: 'Play / Pause',          category: 'Playback',   keys: [key(' ')],              context: 'app', when: hasSequenceNodes },
  { id: 'playback.back',   label: 'Step Back',             category: 'Playback',   keys: [key('arrowleft')],      context: 'app', when: hasSequenceNodes, repeat: true },
  { id: 'playback.fwd',    label: 'Step Forward',          category: 'Playback',   keys: [key('arrowright')],     context: 'app', when: hasSequenceNodes, repeat: true },
  { id: 'playback.start',  label: 'Go to Start',           category: 'Playback',   keys: [key('home')],           context: 'app', when: hasSequenceNodes },
  { id: 'playback.end',    label: 'Go to End',             category: 'Playback',   keys: [key('end')],            context: 'app', when: hasSequenceNodes },
  { id: 'playback.loop',   label: 'Toggle Loop',           category: 'Playback',   keys: [key('l')],              context: 'app', when: hasSequenceNodes },
];
