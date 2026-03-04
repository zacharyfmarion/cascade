import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLayoutStore } from '../store/layoutStore';
import type { WorkspacePreset } from '../store/layoutStore';
import { isTextInputFocused } from '../shortcuts/focusDetection';

// ── Menu item types ─────────────────────────────────────────────

export type MenuActionItem = {
  type: 'action';
  id: string;
  label: string;
  shortcut?: string;
};

export type MenuSeparator = {
  type: 'separator';
};

export type MenuSubmenuItem = {
  type: 'submenu';
  label: string;
  items: MenuItemDef[];
};

export type MenuItemDef = MenuActionItem | MenuSeparator | MenuSubmenuItem;

export type MenuDef = {
  label: string;
  items: MenuItemDef[];
};

// ── Platform detection ──────────────────────────────────────────

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

function modKey(): string {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return isMac ? '⌘' : 'Ctrl';
}

// ── Menu definition ─────────────────────────────────────────────

export function getMenuBarDef(): MenuDef[] {
  const mod = modKey();

  return [
    {
      label: 'File',
      items: [
        { type: 'action', id: 'file.save', label: 'Save Project', shortcut: `${mod}+S` },
        { type: 'action', id: 'file.open', label: 'Open Project', shortcut: `${mod}+O` },
        { type: 'separator' },
        { type: 'action', id: 'file.settings', label: 'Settings', shortcut: `${mod}+,` },
      ],
    },
    {
      label: 'Edit',
      items: [
        { type: 'action', id: 'edit.undo', label: 'Undo', shortcut: `${mod}+Z` },
        { type: 'action', id: 'edit.redo', label: 'Redo', shortcut: `${mod}+Shift+Z` },
        { type: 'separator' },
        { type: 'action', id: 'edit.selectAll', label: 'Select All', shortcut: `${mod}+A` },
        { type: 'action', id: 'edit.deselectAll', label: 'Deselect All' },
        { type: 'action', id: 'edit.delete', label: 'Delete Selected', shortcut: 'Del' },
      ],
    },
    {
      label: 'View',
      items: [
        {
          type: 'submenu',
          label: 'Workspace',
          items: [
            { type: 'action', id: 'view.workspace.compositing', label: 'Compositing' },
            { type: 'action', id: 'view.workspace.viewing', label: 'Viewing' },
            { type: 'action', id: 'view.workspace.minimal', label: 'Minimal' },
          ],
        },
        { type: 'separator' },
        { type: 'action', id: 'view.resetLayout', label: 'Reset Layout' },
      ],
    },
    {
      label: 'Help',
      items: [
        { type: 'action', id: 'help.shortcuts', label: 'Keyboard Shortcuts', shortcut: '?' },
        { type: 'separator' },
  { type: 'action', id: 'help.about', label: 'About Cascade' },
      ],
    },
  ];
}

// ── Action dispatcher ───────────────────────────────────────────

export function handleMenuAction(id: string): void {
  const graphStore = useGraphStore.getState();
  const settingsStore = useSettingsStore.getState();
  const layoutStore = useLayoutStore.getState();

  switch (id) {
    case 'file.save':
      graphStore.saveProject();
      break;
    case 'file.open':
      if (isTauri() && graphStore.loadProjectFromPath) {
        graphStore.loadProjectFromPath();
      } else {
        document.getElementById('menu-file-input')?.click();
      }
      break;
    case 'file.settings':
      settingsStore.openSettings();
      break;

    case 'edit.undo':
      // In Tauri, menu accelerators fire even when Monaco is focused.
      // Gate undo/redo so the editor handles its own undo natively.
      if (!isTextInputFocused()) graphStore.undo();
      break;
    case 'edit.redo':
      if (!isTextInputFocused()) graphStore.redo();
      break;
    case 'edit.selectAll': {
      const allIds = Array.from(graphStore.nodes.keys());
      graphStore.setSelectedNodes(allIds);
      break;
    }
    case 'edit.deselectAll':
      graphStore.setSelectedNodes([]);
      break;
    case 'edit.delete': {
      const selected = Array.from(graphStore.selectedNodeIds);
      for (const nodeId of selected) {
        graphStore.removeNode(nodeId);
      }
      break;
    }

    case 'view.workspace.compositing':
      layoutStore.applyWorkspacePreset('compositing' as WorkspacePreset);
      break;
    case 'view.workspace.viewing':
      layoutStore.applyWorkspacePreset('viewing' as WorkspacePreset);
      break;
    case 'view.workspace.minimal':
      layoutStore.applyWorkspacePreset('minimal' as WorkspacePreset);
      break;
    case 'view.resetLayout':
      layoutStore.resetLayout();
      break;

    case 'help.shortcuts':
      settingsStore.openShortcuts();
      break;
    case 'help.about':
      settingsStore.openAbout();
      break;

    default:
      console.warn(`Unknown menu action: ${id}`);
  }
}
