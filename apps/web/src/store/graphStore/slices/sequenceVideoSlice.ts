import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { ParamValue } from '../../types';
import type { SequenceInfo, VideoInfo } from '../../../engine/bridge';
import { sequenceFrameManager } from '../../../engine/sequenceFrameManager';
import { makeEngineError } from '../../../engine/engineError';
import { perfLog, perfLogDuration, perfNow } from '../../../utils/perf';
import {
  MEDIA_NAV_PREVIEW_SCALE,
  getEngine,
  isSequenceInfo,
  kernel,
  markGraphMutation,
} from '../kernel';
import { useSettingsStore } from '../../settingsStore';

const PANEL_VIEWER_NODE_TYPES = new Set(['viewer', 'compare_viewer']);

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
  recomputeSequenceState: () => void;
}

export type SequenceVideoSlice = SequenceVideoSliceState & SequenceVideoSliceActions;

export const createSequenceVideoSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  SequenceVideoSlice
> = (set, get) => {
  const transportRange = () => {
    const activeId = get().activeTransportSourceId;
    const active = activeId ? get().mediaIteratorInfoMap.get(activeId) : null;
    return active
      ? { start: active.startFrame, end: active.endFrame }
      : { start: get().sequenceStart, end: get().sequenceLength || 999 };
  };

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
    get().recomputeMediaIteratorState();
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

    recomputeSequenceState,

    setCurrentFrame: (frame) => {
      const startTime = perfNow();
      const { start, end } = transportRange();
      const nextFrame = Math.max(start, Math.min(frame, end));
      set({ currentFrame: nextFrame });

      const previewScale = get().activeTransportSourceId ? MEDIA_NAV_PREVIEW_SCALE : undefined;
      const { nodes } = get();
      let triggeredViewers = 0;
      perfLog('media.setCurrentFrame', {
        requestedFrame: frame,
        nextFrame,
        start,
        end,
        previewScale,
        activeTransportSourceId: get().activeTransportSourceId,
      });
      for (const [viewerId, node] of nodes) {
        if (PANEL_VIEWER_NODE_TYPES.has(node.typeId)) {
          triggeredViewers++;
          get().triggerRender(viewerId, previewScale);
        }
      }
      perfLogDuration('media.setCurrentFrame.dispatch', startTime, {
        nextFrame,
        triggeredViewers,
      });
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
      const { info, pattern } = eng.registerSequenceFiles
        ? await eng.registerSequenceFiles(nodeId, files)
        : sequenceFrameManager.setFiles(nodeId, files);

      if (eng.setSequenceInfo) {
        await eng.setSequenceInfo(nodeId, info);
      }

      await get().setParam(nodeId, 'pattern', { String: pattern } as ParamValue);

      if (info.frame_count > 0) {
        if (eng.prepareSequenceFrame) {
          const change = await eng.prepareSequenceFrame(nodeId, info.first_frame);
          if (change) {
            get().applyNodeInterfaceChange(nodeId, change);
          }
        } else if (eng.loadSequenceFrameData) {
          const frameData = await sequenceFrameManager.getFrameData(nodeId, info.first_frame);
          if (frameData) {
            const change = await eng.loadSequenceFrameData(nodeId, info.first_frame, frameData);
            get().applyNodeInterfaceChange(nodeId, change);
          }
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
        const newNodes = new Map(get().nodes);
        const node = newNodes.get(nodeId);
        if (node) {
          const source = path.startsWith('file://') ? path : `file://${path}`;
          newNodes.set(nodeId, {
            ...node,
            params: { ...node.params, file_path: { String: source } as ParamValue },
          });
        }
        markGraphMutation(set, 'ui');
        set({ nodes: newNodes, sequenceInfoMap: newInfoMap, dirty: true });
        get().refreshDslShadowFromGraph();
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
      const { currentFrame } = get();
      const { start, end } = transportRange();
      const startFrame = currentFrame >= end ? start : currentFrame;
      set({ isPlaying: true, currentFrame: startFrame, playbackFps: null });
      kernel.playbackAborted = false;

      const loop = async () => {
        let prevFrameStart: number | null = null;
        const fpsWindow: number[] = [];
        const FPS_WINDOW_SIZE = 20;

        while (!kernel.playbackAborted) {
          const frameStart = performance.now();
          const { fps, loopPlayback } = get();
          const { start: seqStart, end: endFrame } = transportRange();
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
          const prefetchStart = next > endFrame
            ? (loopPlayback ? seqStart : null)
            : next;

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
            if (prefetchStart !== null) {
              get().prefetchSequenceFrames(prefetchStart, 2);
            }
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
      const { currentFrame } = get();
      const { end } = transportRange();
      if (currentFrame < end) {
        set({ currentFrame: currentFrame + 1 });
        get().triggerAllViewers();
      }
    },

    stepBackward: () => {
      if (get().isPlaying) get().pause();
      const { currentFrame } = get();
      const { start } = transportRange();
      if (currentFrame > start) {
        set({ currentFrame: currentFrame - 1 });
        get().triggerAllViewers();
      }
    },

    goToStart: () => {
      if (get().isPlaying) get().pause();
      set({ currentFrame: transportRange().start });
      get().triggerAllViewers();
    },

    goToEnd: () => {
      if (get().isPlaying) get().pause();
      set({ currentFrame: transportRange().end });
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
