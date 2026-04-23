import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface SettingsState {
  // --- Modal visibility ---
  isSettingsOpen: boolean;
  settingsInitialTab: string | null;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;

  isAboutOpen: boolean;
  openAbout: () => void;
  closeAbout: () => void;

  isShortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;

  isAiAssistantOpen: boolean;
  openAiAssistant: () => void;
  closeAiAssistant: () => void;
  toggleAiAssistant: () => void;

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
  analyticsEnabled: boolean;
  setAnalyticsEnabled: (enabled: boolean) => void;

  // --- Performance ---
  livePreviewScale: number;  // 0.25, 0.5, 0.75, 1.0
  setLivePreviewScale: (scale: number) => void;
  previewIdleDelay: number;  // ms, default 300
  setPreviewIdleDelay: (ms: number) => void;
  maxUndoSteps: number;
  setMaxUndoSteps: (steps: number) => void;

  // --- Playback ---
  defaultFps: number;
  setDefaultFps: (fps: number) => void;
  loopPlayback: boolean;
  setLoopPlayback: (loop: boolean) => void;

  // --- AI ---
  aiApiKey: string;
  setAiApiKey: (key: string) => void;

  // --- AI Assistant ---
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  aiAssistantModel: string;
  setAiAssistantModel: (model: string) => void;

  // --- Project ---
  projectWidth: number;
  projectHeight: number;
  setProjectFormat: (width: number, height: number) => void;
}

const STORAGE_KEY = 'cascade-settings';

const DEFAULT_SETTINGS = {
  snapToGrid: true,
  gridSize: 15,
  showMinimap: false,
  showTimings: false,
  analyticsEnabled: true,
  livePreviewScale: 0.3,
  previewIdleDelay: 300,
  maxUndoSteps: 50,
  defaultFps: 24,
  loopPlayback: true,
  aiApiKey: '',
  anthropicApiKey: '',
  aiAssistantModel: 'claude-sonnet-4-6',
  projectWidth: 1920,
  projectHeight: 1080,
};

export function loadSettings() {
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
          analyticsEnabled,
          livePreviewScale,
          previewIdleDelay,
          maxUndoSteps,
          defaultFps,
          loopPlayback,
          aiApiKey,
          anthropicApiKey,
          aiAssistantModel,
          projectWidth,
          projectHeight,
        } = get();
        
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            snapToGrid,
            gridSize,
            showMinimap,
            showTimings,
            analyticsEnabled,
            livePreviewScale,
            previewIdleDelay,
            maxUndoSteps,
            defaultFps,
            loopPlayback,
            aiApiKey,
            anthropicApiKey,
            aiAssistantModel,
            projectWidth,
            projectHeight,
          }));
        } catch (e) {
          console.error('Failed to save settings:', e);
        }
      };

      return {
        isSettingsOpen: false,
        settingsInitialTab: null,
        openSettings: (tab?: string) => set({ isSettingsOpen: true, settingsInitialTab: tab ?? null }),
        closeSettings: () => set({ isSettingsOpen: false, settingsInitialTab: null }),

        isAboutOpen: false,
        openAbout: () => set({ isAboutOpen: true }),
        closeAbout: () => set({ isAboutOpen: false }),

        isShortcutsOpen: false,
        openShortcuts: () => set({ isShortcutsOpen: true }),
        closeShortcuts: () => set({ isShortcutsOpen: false }),

        isAiAssistantOpen: false,
        openAiAssistant: () => set({ isAiAssistantOpen: true }),
        closeAiAssistant: () => set({ isAiAssistantOpen: false }),
        toggleAiAssistant: () => set((state) => ({ isAiAssistantOpen: !state.isAiAssistantOpen })),

        snapToGrid: initial.snapToGrid,
        setSnapToGrid: (snap) => { set({ snapToGrid: snap }); save(); },
        
        gridSize: initial.gridSize,
        setGridSize: (size) => { set({ gridSize: size }); save(); },
        
        showMinimap: initial.showMinimap,
        setShowMinimap: (show) => { set({ showMinimap: show }); save(); },

        showTimings: initial.showTimings,
        setShowTimings: (show) => { set({ showTimings: show }); save(); },

        analyticsEnabled: initial.analyticsEnabled,
        setAnalyticsEnabled: (enabled) => { set({ analyticsEnabled: enabled }); save(); },

        livePreviewScale: initial.livePreviewScale,
        setLivePreviewScale: (scale) => { set({ livePreviewScale: scale }); save(); },
        
        previewIdleDelay: initial.previewIdleDelay,
        setPreviewIdleDelay: (ms) => { set({ previewIdleDelay: ms }); save(); },

        maxUndoSteps: initial.maxUndoSteps,
        setMaxUndoSteps: (steps) => { set({ maxUndoSteps: steps }); save(); },

        defaultFps: initial.defaultFps,
        setDefaultFps: (fps) => { set({ defaultFps: fps }); save(); },
        
        loopPlayback: initial.loopPlayback,
        setLoopPlayback: (loop) => { set({ loopPlayback: loop }); save(); },

        aiApiKey: initial.aiApiKey,
        setAiApiKey: (key) => { set({ aiApiKey: key }); save(); },

        anthropicApiKey: initial.anthropicApiKey,
        setAnthropicApiKey: (key) => { set({ anthropicApiKey: key }); save(); },
        aiAssistantModel: initial.aiAssistantModel,
        setAiAssistantModel: (model) => { set({ aiAssistantModel: model }); save(); },

        projectWidth: initial.projectWidth,
        projectHeight: initial.projectHeight,
        setProjectFormat: (width, height) => { set({ projectWidth: width, projectHeight: height }); save(); },
      };
    },
    { name: 'SettingsStore' }
  )
);
