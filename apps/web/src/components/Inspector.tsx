import React from 'react';
import { useGraphStore } from '../store/graphStore';
import { NodeSlider } from './nodes/NodeSlider';
import { ScriptNodeEditor } from './ScriptNodeEditor';
import { ColorRampEditor } from './ColorRampEditor';
import type { ParamSpec, ParamValue, ColorStop, PortSpec } from '../store/types';
import { createParamValue, extractParamValue } from '../store/types';

const ParamControl: React.FC<{
  nodeId: string;
  paramSpec: ParamSpec;
  value: ParamValue;
  onLive: (key: string, value: ParamValue) => void;
  onCommit: (key: string, value: ParamValue) => void;
  onChange: (key: string, value: ParamValue) => void;
}> = ({ paramSpec, value, onLive, onCommit, onChange }) => {
  const rawValue = extractParamValue(value);

  if (paramSpec.ui_hint.type === 'Hidden') return null;

  return (
    <div style={{ marginBottom: '8px' }}>
      {(paramSpec.ui_hint.type === 'Slider' || paramSpec.ui_hint.type === 'NumberInput') && (
        <NodeSlider
          label={paramSpec.label}
          value={Number(rawValue)}
          min={paramSpec.min ?? 0}
          max={paramSpec.max ?? 1}
          step={paramSpec.step ?? 0.01}
          onChange={(v) => onLive(paramSpec.key, createParamValue(paramSpec.ty, v))}
          onChangeCommit={(v) => onCommit(paramSpec.key, createParamValue(paramSpec.ty, v))}
        />
      )}

      {paramSpec.ui_hint.type === 'Checkbox' && (
        <label style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8rem',
          cursor: 'pointer',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>{paramSpec.label}</span>
          <input
            type="checkbox"
            checked={Boolean(rawValue)}
            onChange={(e) => onChange(paramSpec.key, createParamValue(paramSpec.ty, e.target.checked))}
            style={{ accentColor: 'var(--accent-primary)' }}
          />
        </label>
      )}

      {paramSpec.ui_hint.type === 'Dropdown' && (
        <label style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8rem',
          cursor: 'pointer',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>{paramSpec.label}</span>
          <select
            value={Number(rawValue)}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onChange(paramSpec.key, createParamValue(paramSpec.ty, v));
            }}
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '3px',
              fontSize: '0.8rem',
              padding: '2px 6px',
              maxWidth: '120px',
              cursor: 'pointer',
            }}
          >
            {paramSpec.ui_hint.data.map((opt: string, idx: number) => (
              <option key={opt} value={idx}>{opt}</option>
            ))}
          </select>
        </label>
      )}

      {paramSpec.ui_hint.type === 'ColorRamp' && (() => {
        const stops: ColorStop[] = 'ColorRamp' in value
          ? (value as { ColorRamp: ColorStop[] }).ColorRamp
          : [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }];
        return (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {paramSpec.label}
            </div>
            <ColorRampEditor
              stops={stops}
              onChange={(newStops) => onChange(paramSpec.key, { ColorRamp: newStops })}
            />
          </div>
        );
      })()}

      {paramSpec.ui_hint.type === 'FilePicker' && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          File selection handled in node
        </div>
      )}
    </div>
  );
};

export const Inspector: React.FC = () => {
  const selectedNodeIds = useGraphStore(s => s.selectedNodeIds);
  const nodes = useGraphStore(s => s.nodes);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const enterGroup = useGraphStore(s => s.enterGroup);
  const editingStack = useGraphStore(s => s.editingStack);

  const selectedNodeId = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds).pop()! : null;
  const selectedNode = selectedNodeId ? nodes.get(selectedNodeId) : null;
  const spec = selectedNode ? nodeSpecs.find(s => s.id === selectedNode.typeId) : null;

  const isGroupNode = selectedNode?.typeId.startsWith('group::') ?? false;
  const isGroupIO = selectedNode?.typeId === 'group_input' || selectedNode?.typeId === 'group_output';
  const isInsideGroup = editingStack.length > 1;

  if (selectedNode && selectedNode.typeId.startsWith('gpu_script')) {
    return <ScriptNodeEditor nodeId={selectedNode.id} typeId={selectedNode.typeId} />;
  }

  if (!selectedNode || !spec) {
    return (
      <div className="panel" style={{ width: '100%', height: '100%' }}>
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {selectedNodeIds.size > 1
            ? `${selectedNodeIds.size} nodes selected`
            : 'Select a node to inspect'}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ width: '100%', height: '100%' }}>
      <div style={{ padding: '16px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>
          {spec.display_name}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          {spec.description}
        </div>

        {isGroupNode && (
          <div style={{ marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => enterGroup(selectedNode.id)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #4a6fa5, #2d4a7d)',
                color: 'var(--text-primary)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              Edit Group
            </button>
          </div>
        )}

        {isGroupIO && isInsideGroup && (
          <div style={{ marginBottom: '16px', padding: '8px', background: 'var(--bg-surface)', borderRadius: 4 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
              {selectedNode.typeId === 'group_input' ? 'Group Inputs' : 'Group Outputs'}
            </div>
            <PortList
              ports={selectedNode.typeId === 'group_input' ? spec.outputs : spec.inputs}
            />
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '16px' }}>
          {spec.params.map(p => (
            <ParamControl
              key={p.key}
              nodeId={selectedNode.id}
              paramSpec={p}
              value={selectedNode.params[p.key] || p.default}
              onLive={(key, val) => setParamLive(selectedNode.id, key, val)}
              onCommit={(key, val) => setParamCommit(selectedNode.id, key, val)}
              onChange={(key, val) => setParam(selectedNode.id, key, val)}
            />
          ))}
          {spec.params.length === 0 && !isGroupIO && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              No parameters
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PortList: React.FC<{ ports: PortSpec[] }> = ({ ports }) => {
  if (ports.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>
        No ports defined. Use the node's + button to add ports.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {ports.map(port => (
        <div
          key={port.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            padding: '2px 4px',
            borderRadius: 3,
            background: 'var(--bg-primary)',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>{port.label}</span>
          <span style={{
            color: 'var(--text-muted)',
            fontSize: '0.65rem',
            padding: '1px 4px',
            background: 'var(--bg-surface)',
            borderRadius: 2,
          }}>
            {port.ty}
          </span>
        </div>
      ))}
    </div>
  );
};
