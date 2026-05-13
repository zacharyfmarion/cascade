import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { JobProgress } from '../../../engine/bridge';
import { getEngine, isSequenceInfo, isTauri, kernel } from '../kernel';
import { makeEngineError, parseEngineError } from '../../../engine/engineError';

export interface BatchExportSliceState {
  renderProgress: JobProgress | null;
  isRendering: boolean;
}

export interface BatchExportSliceActions {
  exportImage: (nodeId: string) => void;
  exportAllImages: () => Promise<void>;
  exportExr: (nodeId: string) => void;
  renderBatch: (nodeId: string) => Promise<void>;
  renderSequence: (nodeId: string) => Promise<void>;
  renderVideo: (nodeId: string) => Promise<void>;
  cancelRender: () => Promise<void>;
}

export type BatchExportSlice = BatchExportSliceState & BatchExportSliceActions;

const stringParamValue = (param: unknown, fallback: string): string => (
  param && typeof param === 'object' && 'String' in param && typeof (param as { String?: unknown }).String === 'string'
    ? (param as { String: string }).String
    : fallback
);

const sanitizeFilenameStem = (value: string): string => {
  const sanitized = Array.from(value)
    .map((ch) => ('\\/:*?"<>|'.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return sanitized.length > 0 ? sanitized : 'export';
};

const batchOutputFilename = (
  template: string,
  sourceFilename: string,
  index: number,
  width: number,
  height: number,
  ext: string,
): string => {
  const sourceName = sourceFilename.replace(/\.[^.]*$/, '') || sourceFilename;
  const stem = (template.trim() || '{name}')
    .replaceAll('{name}', sourceName)
    .replaceAll('{index}', String(index))
    .replaceAll('{index1}', String(index + 1))
    .replaceAll('{width}', String(width))
    .replaceAll('{height}', String(height))
    .replaceAll('{ext}', ext);
  return `${sanitizeFilenameStem(stem)}.${ext}`;
};

const dedupeFilename = (filename: string, used: Set<string>): string => {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let suffix = 1;
  while (true) {
    const candidate = `${stem}_${suffix}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
};

const DEFAULT_SEQUENCE_START_FRAME = 0;
const DEFAULT_SEQUENCE_END_FRAME = 100;

const upstreamSequenceRange = (
  exportNodeId: string,
  nodes: GraphState['nodes'],
  connections: GraphState['connections'],
  sequenceInfoMap: GraphState['sequenceInfoMap'],
): { start: number; end: number } | null => {
  const ranges: Array<{ start: number; end: number }> = [];
  const visited = new Set<string>();
  const queue = [exportNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    for (const connection of connections) {
      if (connection.toNode !== nodeId) continue;

      const sourceNode = nodes.get(connection.fromNode);
      if (!sourceNode) continue;

      const info = sequenceInfoMap.get(connection.fromNode);
      if (
        info
        && info.frame_count > 0
        && (sourceNode.typeId === 'load_image_sequence' || sourceNode.typeId === 'load_video')
      ) {
        ranges.push(isSequenceInfo(info)
          ? { start: info.first_frame, end: info.last_frame }
          : { start: 0, end: info.frame_count - 1 });
        continue;
      }

      queue.push(connection.fromNode);
    }
  }

  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map(range => range.start)),
    end: Math.max(...ranges.map(range => range.end)),
  };
};

const exportNodeExtension = (node: { params: Record<string, unknown> }): string => {
  const formatParam = node.params['format'];
  const formatIdx = formatParam && typeof formatParam === 'object' && 'Int' in formatParam
    ? Number((formatParam as { Int: unknown }).Int)
    : 0;
  return formatIdx === 1 ? 'jpg' : 'png';
};

const pathBasename = (path: string): string => (
  path.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
);

const sanitizeFilename = (value: string): string => {
  const sanitized = Array.from(value)
    .map((ch) => ('\\/:*?"<>|'.includes(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return sanitized.length > 0 ? sanitized : 'export';
};

const exportFilename = (
  outputPath: string,
  fallbackStem: string,
  extension: string,
): string => {
  const base = pathBasename(outputPath) || fallbackStem;
  const withExtension = /\.[A-Za-z0-9]+$/.test(base) ? base : `${base}.${extension}`;
  return sanitizeFilename(withExtension);
};

const joinNativePath = (directory: string, filename: string): string => {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${filename}`;
};

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

    if (isTauri()) {
      const eng = getEngine();
      import('@tauri-apps/plugin-dialog').then(({ save }) =>
        save({
          filters: [{ name: 'Image', extensions: [extension] }],
          defaultPath: `export.${extension}`,
        })
      ).then(async path => {
        if (!path) return;
        if (eng.exportImageToPath) {
          await eng.exportImageToPath(nodeId, frame, path);
        }
      }).catch(e => {
        console.error('exportImage failed:', e);
        set({ lastError: parseEngineError(e) });
      });
      return;
    }

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

  exportAllImages: async () => {
    const state = get();
    const activeContext = state.editingStack[state.editingStack.length - 1];
    if (activeContext && activeContext.id !== 'root') {
      const error = makeEngineError('Export All Images is only available from the root graph');
      set({ lastError: error });
      get().pushToast('error', 'Export All Failed', error.message);
      return;
    }

    const exportNodes = Array.from(state.nodes.values())
      .filter(node => node.typeId === 'export_image')
      .sort((a, b) => (
        a.position.y - b.position.y
        || a.position.x - b.position.x
        || a.id.localeCompare(b.id)
      ));

    if (exportNodes.length === 0) {
      const error = makeEngineError('No Export Image nodes found');
      set({ lastError: error });
      get().pushToast('error', 'Export All Failed', error.message);
      return;
    }

    const frame = state.currentFrame;
    const usedNames = new Set<string>();
    const exportItems = exportNodes.map((node, index) => {
      const extension = exportNodeExtension(node);
      const outputPath = stringParamValue(node.params['output_path'], '');
      const filename = dedupeFilename(
        exportFilename(outputPath, `export_${index + 1}`, extension),
        usedNames,
      );
      return { nodeId: node.id, filename };
    });

    const eng = getEngine();
    kernel.webRenderCancelled = false;
    set({
      isRendering: true,
      lastError: null,
      renderProgress: {
        job_id: 'export-all',
        current_frame: 0,
        total_frames: exportItems.length,
        completed: false,
        error: null,
      },
    });

    try {
      if (isTauri()) {
        if (!eng.exportImageToPath) {
          throw makeEngineError('Export-to-folder is not supported by this engine');
        }
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          directory: true,
          multiple: false,
          title: 'Choose Export Folder',
        });
        const outputDir = Array.isArray(selected) ? selected[0] : selected;
        if (!outputDir) {
          set({ isRendering: false, renderProgress: null });
          return;
        }
        let exportedCount = 0;
        for (const item of exportItems) {
          if (kernel.webRenderCancelled) break;
          await eng.exportImageToPath(item.nodeId, frame, joinNativePath(outputDir, item.filename));
          exportedCount += 1;
          set({
            renderProgress: {
              job_id: 'export-all',
              current_frame: exportedCount,
              total_frames: exportItems.length,
              completed: false,
              error: null,
            },
          });
        }
        set({
          isRendering: false,
          renderProgress: {
            job_id: 'export-all',
            current_frame: exportedCount,
            total_frames: exportItems.length,
            completed: true,
            error: kernel.webRenderCancelled ? 'Cancelled' : null,
          },
        });
        if (!kernel.webRenderCancelled) {
          get().pushToast('success', 'Images Exported', `${exportedCount} files saved`);
        }
        return;
      }

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let exportedCount = 0;
      for (const item of exportItems) {
        if (kernel.webRenderCancelled) break;
        const bytes = await eng.exportImage(item.nodeId, frame);
        zip.file(item.filename, bytes);
        exportedCount += 1;
        set({
          renderProgress: {
            job_id: 'export-all',
            current_frame: exportedCount,
            total_frames: exportItems.length,
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
        a.download = 'exports.zip';
        a.click();
        URL.revokeObjectURL(url);
        get().pushToast('success', 'Images Exported', `${exportedCount} files downloaded`);
      }
      set({
        isRendering: false,
        renderProgress: {
          job_id: 'export-all',
          current_frame: exportedCount,
          total_frames: exportItems.length,
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
          job_id: 'export-all',
          current_frame: 0,
          total_frames: exportItems.length,
          completed: true,
          error: error.message,
        },
      });
      get().pushToast('error', 'Export All Failed', error.message);
    }
  },

  exportExr: async (nodeId) => {
    const eng = getEngine();

    if (isTauri()) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
          filters: [{ name: 'OpenEXR Image', extensions: ['exr'] }],
          defaultPath: 'export.exr',
        });
        if (!path) return;
        if (eng.exportImageToPath) {
          await eng.exportImageToPath(nodeId, get().currentFrame, path);
        }
        get().pushToast('success', 'EXR Exported', 'File saved');
      } catch (e: unknown) {
        console.error('exportExr failed:', e);
        set({ lastError: parseEngineError(e) });
        get().pushToast('error', 'EXR Export Failed', String(e));
      }
      return;
    }

    if (!eng.evaluateBytesOutput) {
      console.warn('evaluateBytesOutput not supported by engine');
      return;
    }
    try {
      const bytes = await Promise.resolve(eng.evaluateBytesOutput(nodeId, 'exr_bytes'));
      const buffer = bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : Uint8Array.from(bytes).buffer;
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'export.exr';
      a.click();
      URL.revokeObjectURL(url);
      get().pushToast('success', 'EXR Exported', 'File download started');
    } catch (e: unknown) {
      console.error('exportExr failed:', e);
      set({ lastError: parseEngineError(e) });
      get().pushToast('error', 'EXR Export Failed', String(e));
    }
  },

  renderBatch: async (nodeId) => {
    const eng = getEngine();
    const node = get().nodes.get(nodeId);
    if (!node) return;
    const formatIdx = node.params['format'] && 'Int' in node.params['format']
      ? node.params['format'].Int : 0;
    const ext = formatIdx === 1 ? 'jpg' : 'png';
    const filenameTemplate = stringParamValue(node.params['filename_template'], '{name}');
    if (isTauri() && eng.renderBatch) {
      const outputDir = stringParamValue(node.params['output_dir'], '');
      if (!outputDir) {
        set({ lastError: makeEngineError('Output folder not set') });
        return;
      }
      set({ isRendering: true, renderProgress: null, lastError: null });
      try {
        await eng.renderBatch(nodeId);
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
        } catch (e) {
          clearInterval(pollInterval);
          set({ isRendering: false, lastError: parseEngineError(e) });
        }
      }, 250);
      return;
    }
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
      const usedNames = new Set<string>();

      for (let frame = 0; frame < totalFrames; frame++) {
        if (kernel.webRenderCancelled) break;
        const preview = await eng.renderViewer(nodeId, frame);
        const bytes = await eng.exportImage(nodeId, frame);
        const width = preview && 'width' in preview ? preview.width : 0;
        const height = preview && 'height' in preview ? preview.height : 0;
        const filename = dedupeFilename(
          batchOutputFilename(filenameTemplate, filenames[frame] ?? String(frame), frame, width, height, ext),
          usedNames,
        );
        zip.file(filename, bytes);
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

    if (isTauri() && eng.renderSequence) {
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

    // Use detected sequence range for default export nodes. User-edited frame
    // ranges still win over sequence metadata.
    if (
      startFrame === DEFAULT_SEQUENCE_START_FRAME
      && endFrame === DEFAULT_SEQUENCE_END_FRAME
    ) {
      const detectedRange = upstreamSequenceRange(
        nodeId,
        get().nodes,
        get().connections,
        get().sequenceInfoMap,
      );
      if (detectedRange) {
        startFrame = detectedRange.start;
        endFrame = detectedRange.end;
      } else if (hasSequenceNodes && sequenceLength > 0) {
        startFrame = sequenceStart;
        endFrame = sequenceLength;
      }
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
