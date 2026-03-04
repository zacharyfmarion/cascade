import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { DockviewApi, SerializedDockview } from 'dockview';

const LAYOUT_STORAGE_KEY = 'cascade-layout';
const LAYOUT_VERSION_KEY = 'cascade-layout-version';
/** Bump this when default layout changes to invalidate stale cached layouts. */
const LAYOUT_VERSION = 5;

export type WorkspacePreset = 'compositing' | 'viewing' | 'minimal';

function addPresetPanels(api: DockviewApi, preset: WorkspacePreset) {
  switch (preset) {
    case 'compositing': {
      api.addPanel({ id: 'node-library', component: 'node-library', title: 'Node Library', initialWidth: 300, minimumWidth: 300, maximumWidth: 300 });
      api.addPanel({ id: 'node-canvas', component: 'node-canvas', title: 'Node Editor', position: { referencePanel: 'node-library', direction: 'right' } });
      api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'node-canvas', direction: 'right' }, initialWidth: 260 });
      api.addPanel({ id: 'dsl-editor', component: 'dsl-editor', title: 'DSL', position: { referencePanel: 'inspector' } });
      api.addPanel({ id: 'viewer', component: 'viewer', title: 'Viewer', position: { referencePanel: 'inspector', direction: 'below' } });
      api.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: 'node-canvas', direction: 'below' }, initialHeight: 40 });
      break;
    }
    case 'viewing': {
      api.addPanel({ id: 'viewer', component: 'viewer', title: 'Viewer' });
      api.addPanel({ id: 'node-canvas', component: 'node-canvas', title: 'Node Editor', position: { referencePanel: 'viewer', direction: 'right' } });
      api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector', position: { referencePanel: 'node-canvas', direction: 'below' }, initialHeight: 260 });
      api.addPanel({ id: 'node-library', component: 'node-library', title: 'Node Library', position: { referenceGroup: api.groups[api.groups.length - 1].id } });
      api.addPanel({ id: 'timeline', component: 'timeline', title: 'Timeline', position: { referencePanel: 'viewer', direction: 'below' }, initialHeight: 40 });
      break;
    }
    case 'minimal': {
      api.addPanel({ id: 'node-canvas', component: 'node-canvas', title: 'Node Editor' });
      api.addPanel({ id: 'viewer', component: 'viewer', title: 'Viewer', position: { referencePanel: 'node-canvas', direction: 'right' } });
      break;
    }
  }
}

export function applyDefaultLayout(api: DockviewApi) {
  addPresetPanels(api, 'compositing');
}

interface LayoutState {
  dockviewApi: DockviewApi | null;
  setDockviewApi: (api: DockviewApi) => void;
  saveLayout: () => void;
  loadLayout: () => SerializedDockview | null;
  resetLayout: () => void;
  applyWorkspacePreset: (preset: WorkspacePreset) => void;
}

export const useLayoutStore = create<LayoutState>()(
  devtools(
    (set, get) => ({
      dockviewApi: null,

      setDockviewApi: (api) => set({ dockviewApi: api }),

      saveLayout: () => {
        const { dockviewApi } = get();
        if (!dockviewApi) return;
        try {
          const json = dockviewApi.toJSON();
          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(json));
          localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
        } catch (e) {
          console.error('Failed to save layout:', e);
        }
      },

      loadLayout: () => {
        const version = localStorage.getItem(LAYOUT_VERSION_KEY);
        if (version !== String(LAYOUT_VERSION)) {
          localStorage.removeItem(LAYOUT_STORAGE_KEY);
          localStorage.removeItem(LAYOUT_VERSION_KEY);
          return null;
        }
        const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!saved) return null;
        try {
          return JSON.parse(saved) as SerializedDockview;
        } catch (e) {
          console.error('Failed to parse saved layout:', e);
          return null;
        }
      },

      resetLayout: () => {
        localStorage.removeItem(LAYOUT_STORAGE_KEY);
        const { dockviewApi } = get();
        if (dockviewApi) {
          applyDefaultLayout(dockviewApi);
          get().saveLayout();
        }
      },

      applyWorkspacePreset: (preset) => {
        const { dockviewApi } = get();
        if (!dockviewApi) return;
        dockviewApi.clear();
        addPresetPanels(dockviewApi, preset);
        get().saveLayout();
      },
    }),
    { name: 'LayoutStore' }
  )
);
