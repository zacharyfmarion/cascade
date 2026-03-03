import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeDropZone } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { pendingImageFiles } from './pendingImageFiles';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const ImageInputNode: React.FC<NodeProps> = (props) => {
  const loadImageFile = useGraphStore(s => s.loadImageFile);
  const getImageData = useGraphStore(s => s.getImageData);
  const data = props.data as NodeData;
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

  // Recover thumbnail from engine for embedded images (e.g. after undo/redo)
  useEffect(() => {
    if (thumbnail) return;
    let revoked = false;
    getImageData(props.id).then(bytes => {
      if (revoked || !bytes) return;
      const url = URL.createObjectURL(new File([bytes.buffer as ArrayBuffer], 'image.png', { type: 'image/png' }));
      setThumbnail(url);
      setFileName('(embedded)');
    });
    return () => { revoked = true; };
  }, [props.id, getImageData, thumbnail]);

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
    fileInputRef.current?.click();
  }, []);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon('load_image', 'Input')}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
