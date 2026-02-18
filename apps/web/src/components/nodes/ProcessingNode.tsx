import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import { NodeColorPicker } from './NodeColorPicker';
import { NodeDropdown, NodeCheckbox, NodeNumberInput, NodeSection } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue, ParamSpec, ValueType } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';

const CONNECTABLE_HINTS = ['Slider', 'NumberInput', 'Checkbox', 'ColorPicker'];
const SCALAR_TYPES: ValueType[] = ['Float', 'Int', 'Bool', 'Color'];

const isConnectableParam = (p: ParamSpec): boolean =>
  p.promotable && SCALAR_TYPES.includes(p.ty) && CONNECTABLE_HINTS.includes(p.ui_hint.type);

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
  inputDefaults?: Record<string, ParamValue>;
};

export const ProcessingNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec, params } = data;
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const setParam = useGraphStore(s => s.setParam);

  const handleLive = useCallback(
    (key: string, ty: string, value: number | [number, number, number, number]) => {
      setParamLive(props.id, key, createParamValue(ty, value));
    },
    [props.id, setParamLive]
  );

  const handleCommit = useCallback(
    (key: string, ty: string, value: number | [number, number, number, number]) => {
      setParamCommit(props.id, key, createParamValue(ty, value));
    },
    [props.id, setParamCommit]
  );

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon(spec.id, spec.category)}>
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
                onChange={(v) => handleLive(p.key, p.ty, v)}
                onChangeCommit={(v) => handleCommit(p.key, p.ty, v)}
              />
            );
          }

          if (p.ui_hint.type === 'ColorPicker') {
            return (
              <NodeColorPicker
                key={p.key}
                label={p.label}
                value={rawValue as [number, number, number, number]}
                onChange={(v) => handleLive(p.key, p.ty, v)}
                onChangeCommit={(v) => handleCommit(p.key, p.ty, v)}
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
                onChange={(v) => handleLive(p.key, p.ty, v)}
                onChangeCommit={(v) => handleCommit(p.key, p.ty, v)}
              />
            );
          }

          if (p.ui_hint.type === 'Dropdown') {
            const dropdownData = p.ui_hint.data;
            const isStringParam = 'String' in (p.default as ParamValue);
            if (isStringParam) {
              return (
                <NodeDropdown
                  key={p.key}
                  label={p.label}
                  value={dropdownData.indexOf(String(rawValue))}
                  options={dropdownData}
                  onChange={(v) => setParam(props.id, p.key, { String: dropdownData[v] })}
                />
              );
            }
            return (
              <NodeDropdown
                key={p.key}
                label={p.label}
                value={Number(rawValue)}
                options={dropdownData}
                onChange={(v) => setParam(props.id, p.key, createParamValue(p.ty, v))}
              />
            );
          }

          if (p.ui_hint.type === 'TextArea') {
            return (
              <div key={p.key} className="node-text-input nopan nodrag nowheel" onPointerDown={(e) => e.stopPropagation()}>
                <div className="node-text-input__label">{p.label}</div>
                <textarea
                  className="node-text-input__field"
                  value={String(rawValue)}
                  onChange={(e) => setParam(props.id, p.key, { String: e.target.value })}
                  placeholder={p.label}
                  rows={2}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
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
