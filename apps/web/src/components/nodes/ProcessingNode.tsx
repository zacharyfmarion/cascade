import React, { useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSlider } from './NodeSlider';
import { NodeColorPicker } from './NodeColorPicker';
import { NodeDropdown, NodeCheckbox, NodeNumberInput, NodeTextArea, NodeSection } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue, isConnectableParam } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
  inputDefaults?: Record<string, ParamValue>;
};

const isAiCategory = (category: string) => category === 'AI';

export const ProcessingNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { spec } = data;
  const params = useGraphStore(s => s.nodes.get(props.id)?.params ?? {});
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const setParam = useGraphStore(s => s.setParam);
  const runAiNode = useGraphStore(s => s.runAiNode);
  const aiStatus = useGraphStore(s => s.aiNodeStatuses[props.id] ?? 'idle');
  const isStale = useGraphStore(s => s.aiNodeStale[props.id] ?? false);

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

  const hasTextArea = spec.params.some(p => p.ui_hint.type === 'TextArea') ||
    spec.inputs.some(i => i.ui_hint?.type === 'TextArea');

  return (
    <BaseNode {...props} data={data} headerIcon={getNodeIcon(spec.id, spec.category)} maxWidth={hasTextArea ? 'none' : undefined}>
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
              <NodeTextArea
                key={p.key}
                label={p.label}
                value={String(rawValue)}
                onChange={(v) => setParam(props.id, p.key, { String: v })}
                placeholder={p.label}
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
        {isAiCategory(spec.category) && (
          <div className="nopan nodrag" style={{ marginTop: 4 }}>
            {isStale && (
              <div style={{
                fontSize: '0.65rem',
                color: 'var(--status-danger)',
                marginBottom: 3,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <span style={{ fontSize: '0.8rem' }}>⚠</span>
                Inputs changed — re-run to update
              </div>
            )}
            <button
              type="button"
              className="ai-run-btn"
              disabled={aiStatus === 'running'}
              onClick={() => runAiNode(props.id)}
              style={{
                width: '100%',
                padding: '5px 8px',
                border: isStale
                  ? '1px solid var(--status-danger)'
                  : aiStatus === 'complete'
                    ? '1px solid var(--status-success)'
                    : '1px solid transparent',
                borderRadius: 4,
                cursor: aiStatus === 'running' ? 'wait' : 'pointer',
                fontSize: '0.75rem',
                fontWeight: 500,
                background: 'var(--accent-primary)',
                color: 'var(--bg-primary)',
                opacity: aiStatus === 'running' ? 0.7 : 1,
              }}
            >
              {aiStatus === 'running'
                ? 'Running…'
                : isStale
                  ? 'Re-run (stale)'
                  : aiStatus === 'complete'
                    ? 'Re-run'
                    : 'Run'}
            </button>
            {aiStatus.startsWith('error:') && (
              <div style={{
                fontSize: '0.65rem',
                color: 'var(--status-danger)',
                marginTop: 2,
                wordBreak: 'break-word',
              }}>
                {aiStatus.slice(6)}
              </div>
            )}
          </div>
        )}
      </NodeSection>
    </BaseNode>
  );
};
