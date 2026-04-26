import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeDropZone } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { pendingImageFiles } from './pendingImageFiles';
import { isDesktopRuntime } from '../../platform/runtime';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const getStringParam = (value: ParamValue | undefined): string | null =>
  value && 'String' in value && value.String ? value.String : null;

const getImagePathDisplayName = (path: string): string => {
  const normalized = path.replace(/^file:\/\//, '').replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name || path;
};

const createThumbnailUrl = (bytes: Uint8Array, fileName: string): string => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new File([buffer], fileName));
};

export const ImageInputNode: React.FC<NodeProps> = (props) => {
  const loadImageFile = useGraphStore(s => s.loadImageFile);
  const loadImagePath = useGraphStore(s => s.loadImagePath);
  const getImageData = useGraphStore(s => s.getImageData);
  const data = props.data as NodeData;
  const imagePath = getStringParam(data.params.path);
  const [fileName, setFileName] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for a pending image file from canvas drop/paste
  useEffect(() => {
    const pending = pendingImageFiles.get(props.id);
    if (pending) {
      pendingImageFiles.delete(props.id);
      Promise.resolve().then(() => {
        setFileName(pending.name || 'Pasted image');
        const url = URL.createObjectURL(pending);
        setThumbnail(url);
      });
      return;
    }
  }, [props.id]);

  // Refresh thumbnail when the semantic file path changes, including DSL edits.
  useEffect(() => {
    if (!imagePath) return;
    let cancelled = false;
    const name = getImagePathDisplayName(imagePath);
    setFileName(name);
    getImageData(props.id).then(bytes => {
      if (cancelled) return;
      if (!bytes) {
        setThumbnail(null);
        return;
      }
      setThumbnail(createThumbnailUrl(bytes, name));
    });
    return () => { cancelled = true; };
  }, [props.id, getImageData, imagePath]);

  // Recover thumbnail from engine for embedded images (e.g. after undo/redo)
  useEffect(() => {
    if (thumbnail || imagePath) return;
    let revoked = false;
    getImageData(props.id).then(bytes => {
      if (revoked || !bytes) return;
      setThumbnail(createThumbnailUrl(bytes, 'image.png'));
      setFileName('(embedded)');
    });
    return () => { revoked = true; };
  }, [props.id, getImageData, imagePath, thumbnail]);

  useEffect(() => {
    return () => {
      if (thumbnail) {
        URL.revokeObjectURL(thumbnail);
      }
    };
  }, [thumbnail]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    loadImageFile(props.id, file);
  }, [props.id, loadImageFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  }, [handleFile]);

  const onClick = useCallback(() => {
    if (isDesktopRuntime()) {
      void (async () => {
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({
            multiple: false,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'exr'] }],
          });
          if (!selected || Array.isArray(selected)) return;
          setFileName(getImagePathDisplayName(selected));
          await loadImagePath(props.id, selected);
          const bytes = await getImageData(props.id);
          if (bytes) {
            setThumbnail(createThumbnailUrl(bytes, getImagePathDisplayName(selected)));
          }
        } catch (err) {
          console.error('Failed to open image:', err);
        }
      })();
      return;
    }
    fileInputRef.current?.click();
  }, [getImageData, loadImagePath, props.id]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_image', 'Input')}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.exr"
        onChange={onFileSelect}
        style={{ display: 'none' }}
      />
      <NodeDropZone onClick={onClick} onDrop={onDrop} hasContent={!!thumbnail}>
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={fileName || 'loaded image'}
            className="node-thumbnail"
          />
        ) : (
          'Drop image or click to select'
        )}
        <div className="node-thumbnail-label">
          {fileName || 'No file'}
        </div>
      </NodeDropZone>
    </BaseNode>
  );
};
