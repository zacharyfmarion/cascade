import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Hexagon } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import { NodeNumberInput, NodeSection } from './NodePrimitives';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue, ParamSpec, ValueType } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';

const CONNECTABLE_HINTS = ['Slider', 'NumberInput', 'Checkbox'];
const SCALAR_TYPES: ValueType[] = ['Float', 'Int', 'Bool'];

const isConnectableParam = (p: ParamSpec): boolean =>
  p.promotable && SCALAR_TYPES.includes(p.ty) && CONNECTABLE_HINTS.includes(p.ui_hint.type);

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

export const GroupNodeComponent: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const enterGroup = useGraphStore(s => s.enterGroup);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);

  const handleDoubleClick = useCallback(() => {
    enterGroup(props.id);
  }, [props.id, enterGroup]);

  return (
    <BaseNode
      {...props}
      data={data}
      headerIcon={<Hexagon size={12} />}
      headerTag="Group"
      onHeaderDoubleClick={handleDoubleClick}
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

      <div className="node-hint">
        Double-click or Tab to edit
      </div>
    </BaseNode>
  );
};
