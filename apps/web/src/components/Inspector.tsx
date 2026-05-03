import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { NodeSlider } from './nodes/NodeSlider';
import { NodeColorPicker } from './nodes/NodeColorPicker';
import { NodeNumberInput } from './nodes/NodePrimitives';
import { ScriptNodeEditor } from './ScriptNodeEditor';
import { ColorRampEditor } from './ColorRampEditor';
import { CurveEditor } from './nodes/CurveEditor';
import type { ParamSpec, ParamValue, ColorStop, CurvePoint, PortSpec, NodeSpec, ValueType } from '../store/types';
import { createParamValue, extractParamValue, isConnectableParam } from '../store/types';
import { useNodeParams } from '../store/graphStore/nodeDraftStore';
import { Button } from './ui/Button';
import { IconButton as UiIconButton } from './ui/IconButton';
import { Toggle } from './ui/Toggle';

const ParamControl: React.FC<{
  nodeId: string;
  paramSpec: ParamSpec;
  value: ParamValue;
  onLive: (key: string, value: ParamValue) => void;
  onCommit: (key: string, value: ParamValue) => void;
  onChange: (key: string, value: ParamValue) => void;
}> = ({ nodeId, paramSpec, value, onLive, onCommit, onChange }) => {
  const rawValue = extractParamValue(value);
  const paramToggleId = `param-toggle-${nodeId}-${paramSpec.key}`;

  if (paramSpec.ui_hint.type === 'Hidden') return null;

  return (
    <div style={{ marginBottom: '8px' }}>
      {paramSpec.ui_hint.type === 'Slider' && (
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

      {paramSpec.ui_hint.type === 'ColorPicker' && (
        <NodeColorPicker
          label={paramSpec.label}
          value={rawValue as [number, number, number, number]}
          onChange={(v) => onLive(paramSpec.key, createParamValue(paramSpec.ty, v))}
          onChangeCommit={(v) => onCommit(paramSpec.key, createParamValue(paramSpec.ty, v))}
        />
      )}

      {paramSpec.ui_hint.type === 'NumberInput' && (
        <NodeNumberInput
          label={paramSpec.label}
          value={Number(rawValue)}
          min={paramSpec.min}
          max={paramSpec.max}
          step={paramSpec.step ?? 1}
          onChange={(v) => onLive(paramSpec.key, createParamValue(paramSpec.ty, v))}
          onChangeCommit={(v) => onCommit(paramSpec.key, createParamValue(paramSpec.ty, v))}
        />
      )}

      {paramSpec.ui_hint.type === 'Checkbox' && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8rem',
          cursor: 'pointer',
        }}>
          <label htmlFor={paramToggleId} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>{paramSpec.label}</label>
          <Toggle
            id={paramToggleId}
            checked={Boolean(rawValue)}
            onChange={(checked) => onChange(paramSpec.key, createParamValue(paramSpec.ty, checked))}
          />
        </div>
      )}

      {paramSpec.ui_hint.type === 'Dropdown' && (() => {
        const isStringParam = 'String' in (paramSpec.default as ParamValue);
        return (
          <label style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{paramSpec.label}</span>
            <select
              value={isStringParam ? String(rawValue) : Number(rawValue)}
              onChange={(e) => {
                if (isStringParam) {
                  onChange(paramSpec.key, { String: e.target.value });
                } else {
                  const v = parseInt(e.target.value, 10);
                  onChange(paramSpec.key, createParamValue(paramSpec.ty, v));
                }
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
                <option key={opt} value={isStringParam ? opt : idx}>{opt}</option>
              ))}
            </select>
          </label>
        );
      })()}

      {paramSpec.ui_hint.type === 'TextArea' && (
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {paramSpec.label}
          </div>
          <textarea
            value={String(rawValue)}
            onChange={(e) => onChange(paramSpec.key, { String: e.target.value })}
            placeholder={paramSpec.label}
            rows={3}
            style={{
              width: '100%',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '3px',
              fontSize: '0.8rem',
              padding: '6px 8px',
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          />
        </div>
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
              onLive={(newStops) => onLive(paramSpec.key, { ColorRamp: newStops })}
              onCommit={(newStops) => onCommit(paramSpec.key, { ColorRamp: newStops })}
            />
          </div>
        );
      })()}

      {paramSpec.ui_hint.type === 'CurveEditor' && (() => {
        const pts: CurvePoint[] = 'CurvePoints' in value
          ? (value as { CurvePoints: CurvePoint[] }).CurvePoints
          : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
        return (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              {paramSpec.label}
            </div>
            <CurveEditor
              points={pts}
              onChange={(newPts) => onChange(paramSpec.key, { CurvePoints: newPts })}
              onChangeLive={(newPts) => onLive(paramSpec.key, { CurvePoints: newPts })}
              onChangeCommit={(newPts) => onCommit(paramSpec.key, { CurvePoints: newPts })}
              width={280}
              height={200}
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

const GroupNameEditor: React.FC<{
  nodeId: string;
  spec: NodeSpec;
  enterGroup: (nodeId: string) => void;
  renameGroup: (nodeId: string, name: string) => void;
}> = ({ nodeId, spec, enterGroup, renameGroup }) => {
  const [groupName, setGroupName] = useState(spec.display_name);
  const renameTimerRef = useRef<number | null>(null);

  const commitGroupName = useCallback((nextName: string) => {
    if (nextName === spec.display_name) return;
    renameGroup(nodeId, nextName);
  }, [nodeId, renameGroup, spec.display_name]);

  const scheduleGroupRename = useCallback((nextName: string) => {
    if (renameTimerRef.current) {
      window.clearTimeout(renameTimerRef.current);
    }
    renameTimerRef.current = window.setTimeout(() => {
      renameTimerRef.current = null;
      commitGroupName(nextName);
    }, 500);
  }, [commitGroupName]);

  useEffect(() => () => {
    if (renameTimerRef.current) {
      window.clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
  }, []);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ marginBottom: '8px' }}>
        <label style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '0.8rem',
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>Name</span>
          <input
            type="text"
            value={groupName}
            onChange={(e) => {
              const nextName = e.target.value;
              setGroupName(nextName);
              scheduleGroupRename(nextName);
            }}
            onBlur={(e) => {
              if (renameTimerRef.current) {
                window.clearTimeout(renameTimerRef.current);
                renameTimerRef.current = null;
              }
              commitGroupName(e.target.value);
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            style={{
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '3px',
              padding: '6px 8px',
              fontSize: '0.85rem',
              width: '100%',
              outline: 'none',
            }}
          />
        </label>
      </div>
      <Button
        size="md"
        variant="secondary"
        onClick={() => enterGroup(nodeId)}
        style={{
          width: '100%',
          fontWeight: 600,
        }}
      >
        Edit Group
      </Button>
    </div>
  );
};

export const NodeInspectorParams: React.FC<{
  nodeId: string;
  spec: NodeSpec;
  committedParams: Record<string, ParamValue>;
}> = ({ nodeId, spec, committedParams }) => {
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);
  const params = useNodeParams(nodeId, committedParams);

  return (
    <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: '16px' }}>
      {spec.params
        .filter(p => !isConnectableParam(p))
        .map(p => (
          <ParamControl
            key={p.key}
            nodeId={nodeId}
            paramSpec={p}
            value={params[p.key] || p.default}
            onLive={(key, val) => setParamLive(nodeId, key, val)}
            onCommit={(key, val) => setParamCommit(nodeId, key, val)}
            onChange={(key, val) => setParam(nodeId, key, val)}
          />
        ))}
      {spec.params.filter(p => !isConnectableParam(p)).length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          No parameters
        </div>
      )}
    </div>
  );
};

export const Inspector: React.FC = () => {
  const selectedNodeIds = useGraphStore(s => s.selectedNodeIds);
  const nodes = useGraphStore(s => s.nodes);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const enterGroup = useGraphStore(s => s.enterGroup);
  const renameGroup = useGraphStore(s => s.renameGroup);
  const editingStack = useGraphStore(s => s.editingStack);
  const frames = useGraphStore(s => s.frames);
  const selectedFrameId = useGraphStore(s => s.selectedFrameId);
  const updateFrame = useGraphStore(s => s.updateFrame);
  const removeFrame = useGraphStore(s => s.removeFrame);

  const selectedNodeId = selectedNodeIds.size > 0 ? Array.from(selectedNodeIds).pop()! : null;
  const selectedNode = selectedNodeId ? nodes.get(selectedNodeId) : null;
  const spec = selectedNode ? nodeSpecs.find(s => s.id === selectedNode.typeId) : null;
  const selectedFrame = selectedFrameId ? frames.get(selectedFrameId) : null;

  const isGroupNode = selectedNode?.typeId.startsWith('group::') ?? false;
  const isGroupIO = selectedNode?.typeId === 'group_input' || selectedNode?.typeId === 'group_output';
  const isInsideGroup = editingStack.length > 1;

  const groupIoPortsKey = useMemo(() => {
    if (!selectedNode || !spec || !isGroupIO) return 'none';
    const ports = selectedNode.typeId === 'group_input' ? spec.outputs : spec.inputs;
    return ports.map((port, idx) => {
      const defaultValue = port.default ? JSON.stringify(port.default) : '';
      return `${idx}:${port.name}:${port.label}:${port.ty}:${port.min ?? ''}:${port.max ?? ''}:${port.step ?? ''}:${defaultValue}`;
    }).join('|');
  }, [isGroupIO, selectedNode, spec]);

  if (selectedNode && selectedNode.typeId.startsWith('gpu_script')) {
    return <ScriptNodeEditor nodeId={selectedNode.id} typeId={selectedNode.typeId} />;
  }

  if (selectedFrame) {
    return (
      <div className="panel" style={{ width: '100%', height: '100%' }}>
        <div style={{ padding: '16px' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>
            Frame
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Visual grouping — does not affect processing
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Label</span>
              <input
                type="text"
                value={selectedFrame.label}
                onChange={(e) => updateFrame(selectedFrame.id, { label: e.target.value })}
                style={{
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '3px',
                  padding: '6px 8px',
                  fontSize: '0.85rem',
                  width: '100%',
                  outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
              />
            </label>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Color</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['purple', 'blue', 'green', 'orange', 'red', 'gray'].map(colorKey => (
                <button
                  key={colorKey}
                  type="button"
                  onClick={() => updateFrame(selectedFrame.id, { color: colorKey })}
                  title={colorKey}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    border: selectedFrame.color === colorKey
                      ? '2px solid var(--accent-primary)'
                      : '1px solid var(--border-default)',
                    cursor: 'pointer',
                    background: colorKey === 'purple' ? 'rgba(108, 92, 231, 0.5)'
                      : colorKey === 'blue' ? 'rgba(60, 120, 220, 0.5)'
                      : colorKey === 'green' ? 'rgba(46, 204, 113, 0.5)'
                      : colorKey === 'orange' ? 'rgba(230, 160, 40, 0.5)'
                      : colorKey === 'red' ? 'rgba(231, 76, 60, 0.5)'
                      : 'rgba(200, 200, 200, 0.3)',
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>

          <Button
            size="md"
            variant="danger"
            onClick={() => removeFrame(selectedFrame.id)}
            style={{
              width: '100%',
            }}
          >
            Delete Frame
          </Button>
        </div>
      </div>
    );
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
          <GroupNameEditor
            key={`${selectedNode.id}:${spec.display_name}`}
            nodeId={selectedNode.id}
            spec={spec}
            enterGroup={enterGroup}
            renameGroup={renameGroup}
          />
        )}

        {isGroupIO && isInsideGroup && (
          <div style={{ marginBottom: '16px' }}>
            <GroupIOEditor
              key={`${selectedNode.id}:${groupIoPortsKey}`}
              nodeId={selectedNode.id}
              isInput={selectedNode.typeId === 'group_input'}
              spec={spec}
            />
          </div>
        )}

        {!isGroupIO && (
          <NodeInspectorParams
            nodeId={selectedNode.id}
            spec={spec}
            committedParams={selectedNode.params}
          />
        )}


      </div>
    </div>
  );
};

const VALUE_TYPES: ValueType[] = ['Image', 'Mask', 'Float', 'Int', 'Bool', 'Color', 'Field'];

type EditablePort = {
  id: string;
  name: string;
  label: string;
  ty: ValueType;
  default?: number | boolean;
  min?: number;
  max?: number;
  step?: number;
};

const getDefaultValue = (port: PortSpec): number | boolean | undefined => {
  if (!port.default) return undefined;
  if ('Float' in port.default) return port.default.Float;
  if ('Int' in port.default) return port.default.Int;
  if ('Bool' in port.default) return port.default.Bool;
  return undefined;
};

/** Derive a stable internal port name from a human-readable label. */
const labelToName = (label: string): string => {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'port';
};

/** Deduplicate port names in-place, appending _2, _3, etc. for collisions. */
const deduplicateNames = (specs: PortSpec[]): PortSpec[] => {
  const seen = new Map<string, number>();
  return specs.map(spec => {
    const count = seen.get(spec.name) ?? 0;
    seen.set(spec.name, count + 1);
    if (count === 0) return spec;
    let suffix = count + 1;
    while (seen.has(`${spec.name}_${suffix}`)) { suffix++; }
    const uniqueName = `${spec.name}_${suffix}`;
    seen.set(uniqueName, 1);
    return { ...spec, name: uniqueName };
  });
};

const toPortSpec = (port: EditablePort): PortSpec => {
  const base: PortSpec = {
    name: port.name || labelToName(port.label),
    label: port.label,
    ty: port.ty,
  };

  if (port.ty === 'Float') {
    if (typeof port.default === 'number') base.default = { Float: port.default };
    if (typeof port.min === 'number') base.min = port.min;
    if (typeof port.max === 'number') base.max = port.max;
    if (typeof port.step === 'number') base.step = port.step;
  }

  if (port.ty === 'Int') {
    if (typeof port.default === 'number') base.default = { Int: Math.round(port.default) };
    if (typeof port.min === 'number') base.min = Math.round(port.min);
    if (typeof port.max === 'number') base.max = Math.round(port.max);
    if (typeof port.step === 'number') base.step = Math.round(port.step);
  }

  if (port.ty === 'Bool') {
    if (typeof port.default === 'boolean') base.default = { Bool: port.default };
  }

  return base;
};

const SectionHeader: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '20px',
    marginBottom: '10px',
    paddingBottom: '4px',
    borderBottom: '1px solid var(--border-default)'
  }}>
    <div style={{
      fontSize: '0.75rem',
      fontWeight: 600,
      color: 'var(--text-primary)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {children}
    </div>
    {action}
  </div>
);

const Label: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <div title={title} style={{
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }}>
    {children}
  </div>
);

const InputGroup: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, ...style }}>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', ...style }}>
    {children}
  </div>
);

const PortCard: React.FC<{ children: React.ReactNode; onRemove: () => void }> = ({ children, onRemove }) => (
  <div style={{
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '8px',
    position: 'relative'
  }}>
    <UiIconButton
      size="sm"
      onClick={onRemove}
      title="Remove port"
      style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
      }}
    >
      ×
    </UiIconButton>
    <div style={{ marginRight: '16px' }}>
      {children}
    </div>
  </div>
);

const IconButton: React.FC<{ onClick: () => void; children: React.ReactNode; title?: string }> = ({ onClick, children, title }) => (
  <UiIconButton size="sm" onClick={onClick} title={title}>
    {children}
  </UiIconButton>
);

const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-default)',
      borderRadius: '3px',
      color: 'var(--text-primary)',
      padding: '6px 8px',
      fontSize: '0.8rem',
      width: '100%',
      outline: 'none',
      ...props.style,
    }}
    onFocus={e => {
      e.currentTarget.style.borderColor = 'var(--accent-primary)';
      props.onFocus?.(e);
    }}
    onBlur={e => {
      e.currentTarget.style.borderColor = 'var(--border-default)';
      props.onBlur?.(e);
    }}
  />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-default)',
      borderRadius: '3px',
      color: 'var(--text-primary)',
      padding: '5px 8px',
      fontSize: '0.8rem',
      cursor: 'pointer',
      outline: 'none',
      width: '100%',
      ...props.style,
    }}
  />
);

const AddButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <Button
    size="md"
    variant="ghost"
    onClick={onClick}
    style={{
      border: '1px dashed var(--border-default)',
      width: '100%',
      textAlign: 'center'
    }}
  >
    {children}
  </Button>
);

const GroupIOEditor: React.FC<{
  nodeId: string;
  isInput: boolean;
  spec: NodeSpec;
}> = ({ nodeId, isInput, spec }) => {
  const updateGroupInterface = useGraphStore(s => s.updateGroupInterface);
  const ports = useMemo(() => (isInput ? spec.outputs : spec.inputs).filter(p => !p.name.startsWith('__add_')), [isInput, spec.outputs, spec.inputs]);
  const [editablePorts, setEditablePorts] = useState<EditablePort[]>(() => (
    ports.map((p, i) => ({
      id: `${nodeId}_${i}_${p.name}`,
      name: p.name,
      label: p.label,
      ty: p.ty,
      default: getDefaultValue(p),
      min: p.min,
      max: p.max,
      step: p.step,
    }))
  ));

  const commitPorts = useCallback((nextPorts?: EditablePort[]) => {
    const targetPorts = nextPorts ?? editablePorts;
    const portSpecs = deduplicateNames(targetPorts.map(toPortSpec));
    if (isInput) {
      updateGroupInterface(portSpecs, null);
    } else {
      updateGroupInterface(null, portSpecs);
    }
  }, [editablePorts, isInput, updateGroupInterface]);

  const handleAdd = useCallback(() => {
    const nextIndex = editablePorts.length + 1;
    const newPort: EditablePort = {
      id: crypto.randomUUID(),
      name: '',
      label: `${isInput ? 'Input' : 'Output'} ${nextIndex}`,
      ty: 'Image',
    };
    const nextPorts = [...editablePorts, newPort];
    setEditablePorts(nextPorts);
    commitPorts(nextPorts);
  }, [commitPorts, editablePorts, isInput]);

  const handleRemove = useCallback((idx: number) => {
    const nextPorts = editablePorts.filter((_, i) => i !== idx);
    setEditablePorts(nextPorts);
    commitPorts(nextPorts);
  }, [commitPorts, editablePorts]);

  const handleFieldChange = (idx: number, updater: (port: EditablePort) => EditablePort) => {
    setEditablePorts(prev => prev.map((port, i) => (i === idx ? updater({ ...port }) : port)));
  };

  return (
    <div>
      <SectionHeader action={<IconButton onClick={handleAdd}>+ Add</IconButton>}>
        {isInput ? 'Group Inputs' : 'Group Outputs'}
      </SectionHeader>

      {editablePorts.length === 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>
          No ports defined.
        </div>
      )}

      {editablePorts.map((port, idx) => (
        <PortCard key={port.id} onRemove={() => handleRemove(idx)}>
          <Row>
            <InputGroup style={{ flex: 1 }}>
              <Label>Label</Label>
              <TextInput
                value={port.label}
                placeholder="Label"
                onChange={e => handleFieldChange(idx, p => ({ ...p, label: e.target.value }))}
                onBlur={() => commitPorts()}
              />
            </InputGroup>
            <InputGroup>
              <Label>Type</Label>
              <Select
                value={port.ty}
                onChange={e => {
                  const nextType = e.target.value as ValueType;
                  const nextPorts = editablePorts.map((p, i) => {
                    if (i !== idx) return p;
                    const next = { ...p, ty: nextType };
                    if (nextType === 'Bool') {
                      next.default = typeof p.default === 'boolean' ? p.default : false;
                      next.min = undefined;
                      next.max = undefined;
                      next.step = undefined;
                      return next;
                    }
                    if (nextType === 'Float' || nextType === 'Int') {
                      next.default = typeof p.default === 'number' ? p.default : 0;
                      return next;
                    }
                    next.default = undefined;
                    next.min = undefined;
                    next.max = undefined;
                    next.step = undefined;
                    return next;
                  });
                  setEditablePorts(nextPorts);
                  commitPorts(nextPorts);
                }}
              >
                {VALUE_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </InputGroup>
          </Row>

          {(port.ty === 'Float' || port.ty === 'Int') && (
            <div style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
              <Label>Default &amp; Range</Label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <TextInput
                    type="number"
                    value={String(port.default ?? '')}
                    placeholder="Default"
                    onChange={e => {
                      const value = e.target.value;
                      handleFieldChange(idx, p => ({ ...p, default: value === '' ? undefined : Number(value) }));
                    }}
                    onBlur={() => commitPorts()}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextInput
                    type="number"
                    value={String(port.min ?? '')}
                    placeholder="Min"
                    onChange={e => {
                      const value = e.target.value;
                      handleFieldChange(idx, p => ({ ...p, min: value === '' ? undefined : Number(value) }));
                    }}
                    onBlur={() => commitPorts()}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextInput
                    type="number"
                    value={String(port.max ?? '')}
                    placeholder="Max"
                    onChange={e => {
                      const value = e.target.value;
                      handleFieldChange(idx, p => ({ ...p, max: value === '' ? undefined : Number(value) }));
                    }}
                    onBlur={() => commitPorts()}
                  />
                </div>
              </div>
            </div>
          )}

          {port.ty === 'Bool' && (
            <div style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                <Toggle
                  id={`group-bool-${port.id}`}
                  checked={Boolean(port.default)}
                  onChange={checked => {
                    const nextPorts = editablePorts.map((p, i) => (
                      i === idx ? { ...p, default: checked } : p
                    ));
                    setEditablePorts(nextPorts);
                    commitPorts(nextPorts);
                  }}
                />
                <label htmlFor={`group-bool-${port.id}`} style={{ cursor: 'pointer' }}>Default Value</label>
              </div>
            </div>
          )}
        </PortCard>
      ))}

      <AddButton onClick={handleAdd}>+ Add {isInput ? 'Input' : 'Output'}</AddButton>
    </div>
  );
};
