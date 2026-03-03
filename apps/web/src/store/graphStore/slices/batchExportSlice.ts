import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { JobProgress } from '../../../engine/bridge';
import { getEngine, kernel } from '../kernel';
import { makeEngineError, parseEngineError } from '../../../engine/engineError';

export interface BatchExportSliceState {
  renderProgress: JobProgress | null;
  isRendering: boolean;
}

export interface BatchExportSliceActions {
  exportImage: (nodeId: string) => void;
  renderBatch: (nodeId: string) => Promise<void>;
  renderSequence: (nodeId: string) => Promise<void>;
  renderVideo: (nodeId: string) => Promise<void>;
  cancelRender: () => Promise<void>;
}

export type BatchExportSlice = BatchExportSliceState & BatchExportSliceActions;

export const createBatchExportSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  BatchExportSlice
> = (set, get) => ({
  renderProgress: null,
  isRendering: false,

  exportImage: (nodeId) => {
    const node = get().nodes.get(nodeId);
    if (!node) return;
    const frame = get().currentFrame;

    const formatParam = node.params['format'];
    const formatIdx = formatParam && 'Int' in formatParam ? formatParam.Int : 0;
    const extension = formatIdx === 1 ? 'jpg' : 'png';
    const mimeType = formatIdx === 1 ? 'image/jpeg' : 'image/png';

    getEngine().exportImage(nodeId, frame).then(bytes => {
      const buffer = bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : Uint8Array.from(bytes).buffer;
      const blob = new Blob([buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export.${extension}`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(e => {
      console.error('exportImage failed:', e);
      set({ lastError: parseEngineError(e) });
    });
  },

  renderBatch: async (nodeId) => {
    const eng = getEngine();
    const node = get().nodes.get(nodeId);
    if (!node) return;
    const formatIdx = node.params['format'] && 'Int' in node.params['format']
      ? node.params['format'].Int : 0;
    const ext = formatIdx === 1 ? 'jpg' : 'png';
    if (!eng.getBatchInfo) {
      set({ lastError: makeEngineError('Batch info not supported') });
      return;
    }
    let totalFrames = 0;
    let filenames: string[] = [];
    try {
      const info = await eng.getBatchInfo(nodeId);
      totalFrames = info.count;
      filenames = info.filenames;
    } catch (e) {
      set({ lastError: parseEngineError(e) });
      return;
    }
    if (totalFrames <= 0) {
      set({ lastError: makeEngineError('No images in batch') });
      return;
    }

    const padding = Math.max(4, String(totalFrames).length);
    kernel.webRenderCancelled = false;
    set({
      isRendering: true,
      lastError: null,
      renderProgress: {
        job_id: 'web-batch',
        current_frame: 0,
        total_frames: totalFrames,
        completed: false,
        error: null,
      },
    });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let renderedCount = 0;
      const usedNames = new Map<string, number>();

      for (let frame = 0; frame < totalFrames; frame++) {
        if (kernel.webRenderCancelled) break;
        const bytes = await eng.exportImage(nodeId, frame);
        let baseName = filenames[frame]
          ?? String(frame).padStart(padding, '0');
        const originalName = baseName;
        const count = usedNames.get(originalName) ?? 0;
        if (count > 0) {
          baseName = `${originalName}_${count}`;
        }
        usedNames.set(originalName, count + 1);

        zip.file(`${baseName}.${ext}`, bytes);
        renderedCount++;
        set({
          renderProgress: {
            job_id: 'web-batch',
            current_frame: renderedCount,
            total_frames: totalFrames,
            completed: false,
            error: null,
          },
        });
      }
      if (!kernel.webRenderCancelled) {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'batch.zip';
        a.click();
        URL.revokeObjectURL(url);
      }

      set({
        isRendering: false,
        renderProgress: {
          job_id: 'web-batch',
          current_frame: renderedCount,
          total_frames: totalFrames,
          completed: true,
          error: kernel.webRenderCancelled ? 'Cancelled' : null,
        },
      });
    } catch (e) {
      const error = parseEngineError(e);
      set({
        isRendering: false,
        lastError: error,
        renderProgress: {
          job_id: 'web-batch',
          current_frame: 0,
          total_frames: totalFrames,
          completed: true,
          error: error.message,
        },
      });
    }
  },

  renderSequence: async (nodeId) => {
    const eng = getEngine();

    if (eng.renderSequence) {
      set({ isRendering: true, renderProgress: null, lastError: null });
      try {
        await eng.renderSequence(nodeId);
      } catch (e) {
        const error = parseEngineError(e);
        console.error('[renderSequence] start failed:', error.message);
        set({
          isRendering: false,
          lastError: error,
          renderProgress: {
            job_id: '',
            current_frame: 0,
            total_frames: 0,
            completed: true,
            error: error.message,
          },
        });
        return;
      }

      if (!eng.getJobProgress) {
        set({ isRendering: false });
        return;
      }

      const pollInterval = setInterval(async () => {
        try {
          const progress = await eng.getJobProgress!();
          if (!progress) return;
          set({ renderProgress: progress });
          if (progress.completed) {
            clearInterval(pollInterval);
            set({
              isRendering: false,
              lastError: progress.error ? makeEngineError(progress.error) : null,
            });
          }
        } catch (e) { clearInterval(pollInterval); set({ isRendering: false, lastError: parseEngineError(e) }); }
      }, 250);
      return;
    }

    const node = get().nodes.get(nodeId);
    if (!node) return;

    const { hasSequenceNodes, sequenceStart, sequenceLength } = get();

    let startFrame = node.params['start_frame'] && 'Int' in node.params['start_frame']
      ? node.params['start_frame'].Int : 0;
    let endFrame = node.params['end_frame'] && 'Int' in node.params['end_frame']
      ? node.params['end_frame'].Int : 100;

    // Use detected sequence range when available — the node params may not
    // have been synced yet due to the async useEffect in the component.
    if (hasSequenceNodes && sequenceLength > 0) {
      startFrame = sequenceStart;
      endFrame = sequenceLength;
    }

    const step = node.params['step'] && 'Int' in node.params['step']
      ? node.params['step'].Int : 1;
    const formatIdx = node.params['format'] && 'Int' in node.params['format']
      ? node.params['format'].Int : 0;

    if (step <= 0 || startFrame > endFrame) {
      set({ lastError: makeEngineError('Invalid frame range') });
      return;
    }

    const totalFrames = Math.floor((endFrame - startFrame) / step) + 1;
    const ext = formatIdx === 1 ? 'jpg' : 'png';
    const padding = Math.max(4, String(endFrame).length);

    kernel.webRenderCancelled = false;
    set({
      isRendering: true,
      lastError: null,
      renderProgress: {
        job_id: 'web',
        current_frame: 0,
        total_frames: totalFrames,
        completed: false,
        error: null,
      },
    });

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let renderedCount = 0;

      for (let frame = startFrame; frame <= endFrame; frame += step) {
        if (kernel.webRenderCancelled) break;

        await get().pushSequenceFrames(frame);
        const bytes = await eng.exportImage(nodeId, frame);

        const frameStr = String(frame).padStart(padding, '0');
        zip.file(`${frameStr}.${ext}`, bytes);

        renderedCount++;
        set({
          renderProgress: {
            job_id: 'web',
            current_frame: renderedCount,
            total_frames: totalFrames,
            completed: false,
            error: null,
          },
        });
      }

      if (!kernel.webRenderCancelled) {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sequence.zip';
        a.click();
        URL.revokeObjectURL(url);
      }

      set({
        isRendering: false,
        renderProgress: {
          job_id: 'web',
          current_frame: renderedCount,
          total_frames: totalFrames,
          completed: true,
          error: kernel.webRenderCancelled ? 'Cancelled' : null,
        },
      });
    } catch (e) {
      const error = parseEngineError(e);
      set({
        isRendering: false,
        lastError: error,
        renderProgress: {
          job_id: 'web',
          current_frame: 0,
          total_frames: totalFrames,
          completed: true,
          error: error.message,
        },
      });
    }
  },

  renderVideo: async (nodeId) => {
    const eng = getEngine();
    if (!eng.renderVideo) {
      set({ lastError: makeEngineError('Video rendering is only available in the desktop app') });
      return;
    }
    set({ isRendering: true, renderProgress: null, lastError: null });
    try {
      await eng.renderVideo(nodeId);
    } catch (e) {
      const error = parseEngineError(e);
      set({
        isRendering: false,
        lastError: error,
        renderProgress: {
          job_id: '',
          current_frame: 0,
          total_frames: 0,
          completed: true,
          error: error.message,
        },
      });
      return;
    }

    if (!eng.getJobProgress) {
      set({ isRendering: false });
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const progress = await eng.getJobProgress!();
        if (!progress) return;
        set({ renderProgress: progress });
        if (progress.completed) {
          clearInterval(pollInterval);
          set({
            isRendering: false,
            lastError: progress.error ? makeEngineError(progress.error) : null,
          });
        }
      } catch (e) { clearInterval(pollInterval); set({ isRendering: false, lastError: parseEngineError(e) }); }
    }, 250);
  },

  cancelRender: async () => {
    const eng = getEngine();
    if (eng.cancelJob) {
      await eng.cancelJob();
    }
    kernel.webRenderCancelled = true;
    set({ isRendering: false });
  },
});
