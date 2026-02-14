import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import { NodeDropdown, NodeCheckbox, NodeSection } from './NodePrimitives';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const ProcessingNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const setParam = useGraphStore(s => s.setParam);

  const handleLive = useCallback(
    (key: string, ty: string, value: number) => {
      setParamLive(props.id, key, createParamValue(ty, value));
    },
    [props.id, setParamLive]
  );

  const handleCommit = useCallback(
    (key: string, ty: string, value: number) => {
      setParamCommit(props.id, key, createParamValue(ty, value));
    },
    [props.id, setParamCommit]
  );

  return (
    <BaseNode {...props} data={data}>
      <NodeSection>
        {spec.params.map(p => {
          if (p.ui_hint.type === 'Hidden') return null;

          const val = params[p.key] ?? p.default;
          const rawValue = extractParamValue(val);

          if (p.ui_hint.type === 'Slider' || p.ui_hint.type === 'NumberInput') {
            return (
              <NodeSlider
                key={p.key}
                label={p.label}
                value={Number(rawValue)}
                min={p.min ?? 0}
                max={p.max ?? 1}
                step={p.step ?? 0.01}
                onChange={(v) => handleLive(p.key, p.ty, v)}
                onChangeCommit={(v) => handleCommit(p.key, p.ty, v)}
              />
            );
          }

          if (p.ui_hint.type === 'Dropdown') {
            return (
              <NodeDropdown
                key={p.key}
                label={p.label}
                value={Number(rawValue)}
                options={p.ui_hint.data}
                onChange={(v) => setParam(props.id, p.key, createParamValue(p.ty, v))}
              />
            );
          }

          if (p.ui_hint.type === 'Checkbox') {
            return (
              <NodeCheckbox
                key={p.key}
                label={p.label}
                checked={Boolean(rawValue)}
                onChange={(checked) => setParam(props.id, p.key, createParamValue(p.ty, checked))}
              />
            );
          }

          return null;
        })}
      </NodeSection>
    </BaseNode>
  );
};
