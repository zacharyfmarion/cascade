import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SettingsState {
  // --- Modal visibility ---
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;

  // --- Appearance ---
  // (Theme is in themeStore already — just reference it from the Appearance tab UI)

  // --- Canvas ---
  snapToGrid: boolean;
  setSnapToGrid: (snap: boolean) => void;
  gridSize: number;
  setGridSize: (size: number) => void;
  showMinimap: boolean;
  setShowMinimap: (show: boolean) => void;
  showTimings: boolean;
  setShowTimings: (show: boolean) => void;

  // --- Performance ---
  livePreviewScale: number;  // 0.25, 0.5, 0.75, 1.0
  setLivePreviewScale: (scale: number) => void;
  previewIdleDelay: number;  // ms, default 300
  setPreviewIdleDelay: (ms: number) => void;

  // --- Playback ---
  defaultFps: number;  // default 24
  setDefaultFps: (fps: number) => void;
  loopPlayback: boolean;
  setLoopPlayback: (loop: boolean) => void;
}

const STORAGE_KEY = 'compositor-settings';

const DEFAULT_SETTINGS = {
  snapToGrid: true,
  gridSize: 15,
  showMinimap: true,
  showTimings: false,
  livePreviewScale: 0.5,
  previewIdleDelay: 300,
  defaultFps: 24,
  loopPlayback: true,
};

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    (set, get) => {
      const initial = loadSettings();

      const save = () => {
        const {
          snapToGrid,
          gridSize,
          showMinimap,
          showTimings,
          livePreviewScale,
          previewIdleDelay,
          defaultFps,
          loopPlayback,
        } = get();
        
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            snapToGrid,
            gridSize,
            showMinimap,
            showTimings,
            livePreviewScale,
            previewIdleDelay,
            defaultFps,
            loopPlayback,
          }));
        } catch (e) {
          console.error('Failed to save settings:', e);
        }
      };

      return {
        isSettingsOpen: false,
        openSettings: () => set({ isSettingsOpen: true }),
        closeSettings: () => set({ isSettingsOpen: false }),

        snapToGrid: initial.snapToGrid,
        setSnapToGrid: (snap) => { set({ snapToGrid: snap }); save(); },
        
        gridSize: initial.gridSize,
        setGridSize: (size) => { set({ gridSize: size }); save(); },
        
        showMinimap: initial.showMinimap,
        setShowMinimap: (show) => { set({ showMinimap: show }); save(); },
        
        showTimings: initial.showTimings,
        setShowTimings: (show) => { set({ showTimings: show }); save(); },

        livePreviewScale: initial.livePreviewScale,
        setLivePreviewScale: (scale) => { set({ livePreviewScale: scale }); save(); },
        
        previewIdleDelay: initial.previewIdleDelay,
        setPreviewIdleDelay: (ms) => { set({ previewIdleDelay: ms }); save(); },

        defaultFps: initial.defaultFps,
        setDefaultFps: (fps) => { set({ defaultFps: fps }); save(); },
        
        loopPlayback: initial.loopPlayback,
        setLoopPlayback: (loop) => { set({ loopPlayback: loop }); save(); },
      };
    },
    { name: 'SettingsStore' }
  )
);
