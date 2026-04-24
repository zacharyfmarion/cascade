import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ColorManagementInfo } from '../../../engine/bridge';
import { getEngine } from '../kernel';
import { useSettingsStore } from '../../settingsStore';

export interface ColorSliceState {
  colorManagement: ColorManagementInfo | null;
}

export interface ColorSliceActions {
  loadColorManagementInfo: () => Promise<void>;
  getViewsForDisplay: (display: string) => Promise<string[]>;
  setDisplayView: (display: string, view: string) => Promise<void>;
  setProjectFormat: (width: number, height: number) => Promise<void>;
  loadOcioConfig: (path: string) => Promise<void>;
  loadOcioFromEnv: () => Promise<void>;
  resetColorManagement: () => Promise<void>;
}

export type ColorSlice = ColorSliceState & ColorSliceActions;

export const createColorSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  ColorSlice
> = (set, get) => ({
  colorManagement: null,

  loadColorManagementInfo: async () => {
    const eng = getEngine();
    if (eng.getColorManagementInfo) {
      const info = await eng.getColorManagementInfo();
      set({ colorManagement: info });
    }
  },

  getViewsForDisplay: async (display: string) => {
    const eng = getEngine();
    if (eng.getViewsForDisplay) {
      return eng.getViewsForDisplay(display);
    }
    return [];
  },

  setDisplayView: async (display: string, view: string) => {
    const eng = getEngine();
    if (eng.setDisplayView) {
      await eng.setDisplayView(display, view);
      const cm = get().colorManagement;
      if (cm) {
        set({ colorManagement: { ...cm, activeDisplay: display, activeView: view } });
      }
      get().renderAllViewersAsync();
    }
  },

  setProjectFormat: async (width: number, height: number) => {
    const eng = getEngine();
    if (eng.setProjectFormat) {
      await eng.setProjectFormat(width, height);
      useSettingsStore.getState().setProjectFormat(width, height);
      get().renderAllViewersAsync();
    }
  },

  loadOcioConfig: async (path: string) => {
    const eng = getEngine();
    if (eng.loadOcioConfig) {
      await eng.loadOcioConfig(path);
      await get().loadColorManagementInfo();
      get().renderAllViewersAsync();
    }
  },

  loadOcioFromEnv: async () => {
    const eng = getEngine();
    if (eng.loadOcioFromEnv) {
      await eng.loadOcioFromEnv();
      await get().loadColorManagementInfo();
      get().renderAllViewersAsync();
    }
  },

  resetColorManagement: async () => {
    const eng = getEngine();
    if (eng.resetColorManagement) {
      await eng.resetColorManagement();
      await get().loadColorManagementInfo();
      get().renderAllViewersAsync();
    }
  },
});
