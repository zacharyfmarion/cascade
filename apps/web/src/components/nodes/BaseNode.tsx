import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { ReconnectableHandle } from './ReconnectableHandle';
import { useGraphStore } from '../../store/graphStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { NodeSpec, PortSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';
import { NodeSlider } from './NodeSlider';
import { NodeCheckbox, NodeNumberInput, NodeTextArea } from './NodePrimitives';
import { linearToSrgbChannel, floatToByte, linearToHex, hexToLinear } from './colorUtils';
import { useNodeInputDefault } from '../../store/graphStore/nodeDraftStore';
import { NativeColorInput } from '../ui/NativeColorInput';

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    spec: NodeSpec;
    params?: Record<string, ParamValue>;
    inputDefaults?: Record<string, ParamValue>;
    [key: string]: unknown;
  };
  selected?: boolean;
  children?: React.ReactNode;
  minWidth?: string;
  maxWidth?: string;
  headerExtra?: React.ReactNode;
  headerIcon?: React.ReactNode;
  headerTag?: string;
  onHeaderDoubleClick?: () => void;
  topContent?: React.ReactNode;
}

const InlineInputControl: React.FC<{
  nodeId: string;
  portSpec: PortSpec;
  committedParams: Record<string, ParamValue>;
  committedDefaults: Record<string, ParamValue>;
}> = ({ nodeId, portSpec, committedParams, committedDefaults }) => {
  const setInputDefaultLive = useGraphStore(s => s.setInputDefaultLive);
  const setInputDefaultCommit = useGraphStore(s => s.setInputDefaultCommit);

  // Read from draft store — only re-renders when THIS node's THIS port changes
  const draftValue = useNodeInputDefault(nodeId, portSpec.name, committedParams, committedDefaults);
  const currentValue = draftValue ?? portSpec.default;
  if (!currentValue) return <span className="node-port__label">{portSpec.label}</span>;

  const rawValue = extractParamValue(currentValue as ParamValue);
  const uiHint = portSpec.ui_hint?.type ?? (portSpec.ty === 'Float' ? 'Slider' : portSpec.ty === 'Int' ? 'NumberInput' : portSpec.ty === 'String' ? 'TextArea' : 'Checkbox');

  if (portSpec.ty === 'Color') {
    const [r, g, b, a] = (rawValue as [number, number, number, number]) || [0, 0, 0, 1];
    const sr = floatToByte(linearToSrgbChannel(r));
    const sg = floatToByte(linearToSrgbChannel(g));
    const sb = floatToByte(linearToSrgbChannel(b));
    const hex = linearToHex(r, g, b);

    return (
      <div className="nopan nodrag" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{
          position: 'relative',
          width: '14px',
          height: '14px',
          // eslint-disable-next-line cascade-theme/no-hardcoded-colors
          backgroundColor: `rgba(${sr}, ${sg}, ${sb}, ${a})`,
          border: '1px solid var(--border-default)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}>
          <NativeColorInput
            value={hex}
            onLive={(newHex) => {
              const [nr, ng, nb] = hexToLinear(newHex);
              setInputDefaultLive(nodeId, portSpec.name, createParamValue(portSpec.ty, [nr, ng, nb, a]));
            }}
            onCommit={(newHex) => {
              const [nr, ng, nb] = hexToLinear(newHex);
              setInputDefaultCommit(nodeId, portSpec.name, createParamValue(portSpec.ty, [nr, ng, nb, a]));
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              padding: 0,
              border: 'none',
            }}
          />
        </div>
        <span className="node-port__label">{portSpec.label}</span>
      </div>
    );
  }

  if (portSpec.ty === 'Bool' || uiHint === 'Checkbox') {
    return (
      <NodeCheckbox
        label={portSpec.label}
        checked={Boolean(rawValue)}
        onChange={(checked) => setInputDefaultCommit(nodeId, portSpec.name, createParamValue(portSpec.ty, checked))}
      />
    );
  }

  if (uiHint === 'Slider') {
    return (
      <NodeSlider
        label={portSpec.label}
        value={Number(rawValue)}
        min={portSpec.min ?? 0}
        max={portSpec.max ?? 1}
        step={portSpec.step ?? 0.01}
        onChange={(v) => setInputDefaultLive(nodeId, portSpec.name, createParamValue(portSpec.ty, v))}
        onChangeCommit={(v) => setInputDefaultCommit(nodeId, portSpec.name, createParamValue(portSpec.ty, v))}
      />
    );
  }

  if (uiHint === 'TextArea' && portSpec.ty === 'String') {
    return (
      <NodeTextArea
        label={portSpec.label}
        value={String(rawValue)}
        onChange={(v) => setInputDefaultCommit(nodeId, portSpec.name, { String: v })}
        placeholder={portSpec.label}
      />
    );
  }

  return (
    <NodeNumberInput
      label={portSpec.label}
      value={Number(rawValue)}
      min={portSpec.min}
      max={portSpec.max}
      step={portSpec.step ?? 1}
      onChange={(v) => setInputDefaultLive(nodeId, portSpec.name, createParamValue(portSpec.ty, v))}
      onChangeCommit={(v) => setInputDefaultCommit(nodeId, portSpec.name, createParamValue(portSpec.ty, v))}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const getPortColor = (type: string) => {
   switch (type) {
     case 'Image': return 'var(--port-image)';
     case 'Mask': return 'var(--port-mask)';
     case 'Float': return 'var(--port-float)';
     case 'Int': return 'var(--port-int)';
     case 'Bool': return 'var(--port-bool)';
     case 'Color': return 'var(--port-color)';
     case 'Field': return 'var(--port-field)';
     default: return 'var(--port-mask)';
   }
 };

const getHeaderBackground = (category: string) => {
  switch (category) {
    case 'Input': return 'var(--node-header-input)';
    case 'Output': return 'var(--node-header-output)';
    case 'Color': return 'var(--node-header-color)';
    case 'Filter': return 'var(--node-header-filter)';
    case 'Composite': return 'var(--node-header-composite)';
    case 'Transform': return 'var(--node-header-transform)';
    case 'Generator': return 'var(--node-header-generator)';
    case 'Matte': return 'var(--node-header-matte)';
    case 'Group': return 'var(--node-header-group)';
    default: return 'var(--slider-bg)';
  }
};

export const BaseNode: React.FC<BaseNodeProps> = ({
  id, data, selected, children, minWidth, maxWidth,
  headerExtra, headerIcon, headerTag, onHeaderDoubleClick, topContent,
}) => {
  const { spec } = data;
  const visibleInputs = spec.inputs.filter(input => input.ui_hint?.type !== 'Hidden');
  const visibleOutputs = spec.outputs.filter(output => output.ui_hint?.type !== 'Hidden');
  const muted = useGraphStore(s => s.nodes.get(id)?.muted ?? false);
  const timing = useGraphStore(s => s.nodeTimings.get(id));
  const nodeError = useGraphStore(s => s.nodeErrors.get(id));
  const showTimings = useSettingsStore(s => s.showTimings);
  const connectedInputsRef = React.useRef<string[]>([]);
  const connectedInputs = useGraphStore((s) => {
    const ports: string[] = [];
    for (const c of s.connections) {
      if (c.toNode === id) ports.push(c.toPort);
    }
    // Stable reference: only return new array if contents changed
    const prev = connectedInputsRef.current;
    if (ports.length === prev.length && ports.every((v, i) => v === prev[i])) {
      return prev;
    }
    connectedInputsRef.current = ports;
    return ports;
  });
  const connectedInputSet = React.useMemo(() => new Set(connectedInputs), [connectedInputs]);

  let badge = null;
  if (showTimings && timing !== undefined) {
    let text = '';
    let timingColor = 'var(--timing-medium)';

    if (timing < 1.0) {
      text = `${timing.toFixed(1)}ms`;
      timingColor = 'var(--timing-fast)';
    } else if (timing < 10.0) {
      text = `${timing.toFixed(1)}ms`;
      timingColor = 'var(--timing-medium)';
    } else if (timing < 1000.0) {
      text = `${Math.round(timing)}ms`;
      timingColor = 'var(--timing-slow)';
    } else {
      text = `${(timing / 1000.0).toFixed(1)}s`;
      timingColor = 'var(--timing-slow)';
    }

    // React accepts custom properties in style object if cast to CSSProperties,
    // or we can just use the style attribute for the dynamic variable.
    badge = (
      <div
        className="node-timing"
        style={{ '--timing-color': timingColor } as React.CSSProperties}
      >
        {text}
      </div>
    );
  }

  return (
    <div
      className={`base-node ${selected ? 'base-node--selected' : ''} ${muted ? 'base-node--muted' : ''}`}
      style={{
        minWidth: minWidth ?? '180px',
        maxWidth: maxWidth ?? '220px',
      }}
    >
      <button
        type="button"
        className="base-node__header"
        style={{ background: getHeaderBackground(spec.category), border: 'none' }}
        onDoubleClick={onHeaderDoubleClick}
      >
        {headerIcon && <span className="base-node__icon">{headerIcon}</span>}
        <span className="base-node__title" title={spec.display_name}>
          {spec.display_name}
        </span>
        {headerTag && <div className="node-badge node-badge--default" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>{headerTag}</div>}
        {badge}
        {nodeError && (
          <div className="node-error-badge" title={nodeError.message}>
            ⚠
          </div>
        )}
        {headerExtra}
      </button>

      <div className="base-node__body">
        {topContent}
        {visibleInputs.map((input: PortSpec) => {
          const isConnected = connectedInputSet.has(input.name);
          const isInlineable = input.ty === 'Float' || input.ty === 'Int' || input.ty === 'Bool' || input.ty === 'Color' || input.ty === 'String';
          const hasDefault = isInlineable && !isConnected && (input.default != null || data.inputDefaults?.[input.name] != null || data.params?.[input.name] != null);

          return (
            <div key={input.name} className="node-port">
              <ReconnectableHandle
                nodeId={id}
                type="target"
                position={Position.Left}
                id={input.name}
                className="node-port__handle"
                style={{
                  background: getPortColor(input.ty),
                  left: '-11px',
                }}
                title={`${input.label} (${input.ty})`}
              />
              {hasDefault ? (
                <InlineInputControl
                  nodeId={id}
                  portSpec={input}
                  committedParams={data.params ?? {}}
                  committedDefaults={data.inputDefaults ?? {}}
                />
              ) : (
                <span className="node-port__label">{input.label}</span>
              )}
            </div>
          );
        })}

        {children}

        {visibleOutputs.map((output: PortSpec) => (
          <div key={output.name} className="node-port node-port--output">
            <span className="node-port__label">
              {output.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.name}
              className="node-port__handle"
              style={{
                background: getPortColor(output.ty),
                right: '-11px',
              }}
              title={`${output.label} (${output.ty})`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
