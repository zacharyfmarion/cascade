import React, { useCallback, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Cpu } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import { NodeNumberInput, NodeSection } from './NodePrimitives';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue, isConnectableParam } from '../../store/types';
import { useNodeParams } from '../../store/graphStore/nodeDraftStore';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
  inputDefaults?: Record<string, ParamValue>;
};

export const GpuScriptNodeComponent: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec } = data;
  const committedParams = useGraphStore(s => s.nodes.get(props.id)?.params ?? {});
  const params = useNodeParams(props.id, committedParams);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const renameGpuScriptNode = useGraphStore(s => s.renameGpuScriptNode);

  const nameRef = useRef<HTMLInputElement>(null);

  const handleNameBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (!spec) return;
    const trimmed = e.target.value.trim();
    if (trimmed && trimmed !== spec.display_name) {
      void renameGpuScriptNode(props.id, trimmed);
    } else {
      e.target.value = spec.display_name;
    }
  }, [spec, props.id, renameGpuScriptNode]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      nameRef.current?.blur();
    }
  }, []);

  if (!spec) return null;

  const nameInput = (
    <div
      className="nopan nodrag"
      style={{ padding: '4px 8px 6px', borderBottom: '1px solid var(--border-default)' }}
    >
      <input
        ref={nameRef}
        type="text"
        className="nopan nodrag"
        defaultValue={spec.display_name}
        key={spec.display_name}
        onBlur={handleNameBlur}
        onKeyDown={handleNameKeyDown}
        style={{
          width: '100%',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: '3px',
          padding: '3px 6px',
          fontSize: '0.8rem',
          fontFamily: 'inherit',
          outline: 'none',
          boxSizing: 'border-box',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
        onBlurCapture={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
      />
    </div>
  );

  return (
    <BaseNode
      {...props}
      data={data}
      headerIcon={<Cpu size={12} />}
      headerTag="GPU"
      topContent={nameInput}
    >
      <NodeSection>
        {spec.params.filter(p => !isConnectableParam(p)).map(p => {
          if (p.ui_hint.type === 'Hidden') return null;

          const val = params[p.key] ?? p.default;
          const rawValue = extractParamValue(val);

          if (p.ui_hint.type === 'Slider') {
            return (
              <NodeSlider
                key={p.key}
                label={p.label}
                value={Number(rawValue)}
                min={p.min ?? 0}
                max={p.max ?? 1}
                step={p.step ?? 0.01}
                onChange={(v) => setParamLive(props.id, p.key, createParamValue(p.ty, v))}
                onChangeCommit={(v) => setParamCommit(props.id, p.key, createParamValue(p.ty, v))}
              />
            );
          }

          if (p.ui_hint.type === 'NumberInput') {
            return (
              <NodeNumberInput
                key={p.key}
                label={p.label}
                value={Number(rawValue)}
                min={p.min}
                max={p.max}
                step={p.step ?? 1}
                onChange={(v) => setParamLive(props.id, p.key, createParamValue(p.ty, v))}
                onChangeCommit={(v) => setParamCommit(props.id, p.key, createParamValue(p.ty, v))}
              />
            );
          }

          return null;
        })}
      </NodeSection>
    </BaseNode>
  );
};
