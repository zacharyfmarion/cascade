import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ParamValue } from '../../types';
import type { SequenceInfo, VideoInfo } from '../../../engine/bridge';
import { sequenceFrameManager } from '../../../engine/sequenceFrameManager';
import { makeEngineError } from '../../../engine/engineError';
import { getEngine, kernel } from '../kernel';
import { useSettingsStore } from '../../settingsStore';

export interface SequenceVideoSliceState {
  currentFrame: number;
  hasSequenceNodes: boolean;
  sequenceLength: number;
  sequenceStart: number;
  sequenceInfoMap: Map<string, SequenceInfo | VideoInfo>;
  isPlaying: boolean;
  fps: number;
  loopPlayback: boolean;
  playbackFps: number | null;
}

export interface SequenceVideoSliceActions {
  setCurrentFrame: (frame: number) => void;
  setSequenceDirectory: (nodeId: string, directory: string) => Promise<void>;
  setSequenceFiles: (nodeId: string, files: File[]) => Promise<void>;
  loadVideoFile: (nodeId: string, path: string) => Promise<VideoInfo | null>;
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  setFps: (fps: number) => void;
  setLoopPlayback: (loop: boolean) => void;
}

export type SequenceVideoSlice = SequenceVideoSliceState & SequenceVideoSliceActions;

export const createSequenceVideoSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  SequenceVideoSlice
> = (set, get) => {
  const isSequenceInfo = (info: SequenceInfo | VideoInfo): info is SequenceInfo => (
    'first_frame' in info && 'last_frame' in info
  );

  const recomputeSequenceState = () => {
    const { nodes, sequenceInfoMap } = get();
    let hasSeq = false;
    for (const [, node] of nodes) {
      if (node.typeId === 'load_image_sequence' || node.typeId === 'load_video') {
        hasSeq = true;
        break;
      }
    }

    let maxEnd = 0;
    let minStart = Infinity;
    for (const [, info] of sequenceInfoMap) {
      if (info.frame_count > 0 && isSequenceInfo(info)) {
        minStart = Math.min(minStart, info.first_frame);
        maxEnd = Math.max(maxEnd, info.last_frame);
      }
    }

    if (minStart === Infinity) minStart = 0;

    set({
      hasSequenceNodes: hasSeq,
      sequenceLength: maxEnd,
      sequenceStart: minStart,
    });
  };

  return {
    currentFrame: 0,
    hasSequenceNodes: false,
    sequenceLength: 0,
    sequenceStart: 0,
    sequenceInfoMap: new Map(),
    isPlaying: false,
    fps: useSettingsStore.getState().defaultFps,
    loopPlayback: useSettingsStore.getState().loopPlayback,
    playbackFps: null,

    setCurrentFrame: (frame) => {
      set({ currentFrame: frame });
      void get().renderAllViewersAsync();
    },

    setSequenceDirectory: async (nodeId, directory) => {
      const eng = getEngine();
      if (!eng.setSequenceDirectory) {
        set({ lastError: makeEngineError('Image sequences are only available in the desktop app') });
        return;
      }
      const info = await eng.setSequenceDirectory(nodeId, directory);
      const newInfoMap = new Map(get().sequenceInfoMap);
      newInfoMap.set(nodeId, info);
      set({ sequenceInfoMap: newInfoMap });
      recomputeSequenceState();

      const { currentFrame, sequenceStart, sequenceLength } = get();
      if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
        set({ currentFrame: sequenceStart });
      }

      get().triggerAllViewers();
    },

    setSequenceFiles: async (nodeId, files) => {
      const eng = getEngine();
      const { info, pattern } = sequenceFrameManager.setFiles(nodeId, files);

      if (eng.setSequenceInfo) {
        await eng.setSequenceInfo(nodeId, info);
      }

      await get().setParam(nodeId, 'pattern', { String: pattern } as ParamValue);

      if (info.frame_count > 0) {
        const frameData = await sequenceFrameManager.getFrameData(nodeId, info.first_frame);
        if (frameData && eng.loadSequenceFrameData) {
          await eng.loadSequenceFrameData(nodeId, info.first_frame, frameData);
        }
      }

      const newInfoMap = new Map(get().sequenceInfoMap);
      newInfoMap.set(nodeId, info);
      set({ sequenceInfoMap: newInfoMap });
      recomputeSequenceState();

      const { currentFrame, sequenceStart, sequenceLength } = get();
      if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
        set({ currentFrame: sequenceStart });
      }

      get().triggerAllViewers();
    },

    loadVideoFile: async (nodeId, path) => {
      const eng = getEngine();
      if (!eng.loadVideoFile) return null;
      try {
        const info = await eng.loadVideoFile(nodeId, path);

        const seqInfo: SequenceInfo = {
          frame_count: info.frame_count,
          first_frame: 0,
          last_frame: info.frame_count > 0 ? info.frame_count - 1 : 0,
        };
        const newInfoMap = new Map(get().sequenceInfoMap);
        newInfoMap.set(nodeId, seqInfo);
        set({ sequenceInfoMap: newInfoMap, dirty: true });
        recomputeSequenceState();

        const { currentFrame, sequenceStart, sequenceLength } = get();
        if (info.frame_count > 0 && (currentFrame < sequenceStart || currentFrame > sequenceLength)) {
          set({ currentFrame: sequenceStart });
        }

        get().triggerAllViewers();
        return info;
      } catch (e) {
        console.error('loadVideoFile failed:', e);
        return null;
      }
    },

    play: () => {
      if (get().isPlaying) return;
      const { currentFrame, sequenceLength, sequenceStart } = get();
      const end = sequenceLength || 999;
      const startFrame = currentFrame >= end ? sequenceStart : currentFrame;
      set({ isPlaying: true, currentFrame: startFrame, playbackFps: null });
      kernel.playbackAborted = false;

      const loop = async () => {
        let prevFrameStart: number | null = null;
        const fpsWindow: number[] = [];
        const FPS_WINDOW_SIZE = 20;

        while (!kernel.playbackAborted) {
          const frameStart = performance.now();
          const { fps, sequenceLength: seqLen, loopPlayback, sequenceStart: seqStart } = get();
          const endFrame = seqLen || 999;
          const interval = 1000 / fps;

          if (prevFrameStart !== null) {
            const frameDelta = frameStart - prevFrameStart;
            fpsWindow.push(1000 / frameDelta);
            if (fpsWindow.length > FPS_WINDOW_SIZE) fpsWindow.shift();
          }
          prevFrameStart = frameStart;

          await get().renderAllViewersAsync();
          await kernel.renderLock;

          if (kernel.playbackAborted) break;

          if (fpsWindow.length > 0) {
            const avgFps = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length;
            set({ playbackFps: avgFps });
          }

          const { currentFrame: cur } = get();
          const next = cur + 1;

          if (next > endFrame) {
            if (loopPlayback) {
              set({ currentFrame: seqStart });
            } else {
              get().pause();
              return;
            }
          } else {
            set({ currentFrame: next });
          }

          const renderTime = performance.now() - frameStart;
          const remaining = interval - renderTime;
          if (remaining > 0) {
            await new Promise<void>(resolve => {
              kernel.playbackTimeoutId = setTimeout(resolve, remaining);
            });
          }
        }
      };

      void loop();
    },

    pause: () => {
      kernel.playbackAborted = true;
      if (kernel.playbackTimeoutId !== null) {
        clearTimeout(kernel.playbackTimeoutId);
        kernel.playbackTimeoutId = null;
      }
      set({ isPlaying: false, playbackFps: null });
    },

    togglePlayback: () => {
      if (get().isPlaying) {
        get().pause();
      } else {
        get().play();
      }
    },

    stepForward: () => {
      if (get().isPlaying) get().pause();
      const { currentFrame, sequenceLength } = get();
      const end = sequenceLength || 999;
      if (currentFrame < end) {
        set({ currentFrame: currentFrame + 1 });
        get().triggerAllViewers();
      }
    },

    stepBackward: () => {
      if (get().isPlaying) get().pause();
      const { currentFrame, sequenceStart } = get();
      if (currentFrame > sequenceStart) {
        set({ currentFrame: currentFrame - 1 });
        get().triggerAllViewers();
      }
    },

    goToStart: () => {
      if (get().isPlaying) get().pause();
      set({ currentFrame: get().sequenceStart });
      get().triggerAllViewers();
    },

    goToEnd: () => {
      if (get().isPlaying) get().pause();
      const end = get().sequenceLength || 999;
      set({ currentFrame: end });
      get().triggerAllViewers();
    },

    setFps: (fps) => {
      set({ fps });
      if (get().isPlaying) {
        get().pause();
        get().play();
      }
    },

    setLoopPlayback: (loop_) => {
      set({ loopPlayback: loop_ });
    },
  };
};
