import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { NodeSpec, PortSpec, ParamValue } from '../../store/types';
import { extractParamValue, createParamValue } from '../../store/types';
import { NodeSlider } from './NodeSlider';
import { NodeCheckbox, NodeNumberInput } from './NodePrimitives';
import { linearToSrgbChannel, floatToByte, linearToHex, hexToLinear } from './colorUtils';

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    spec: NodeSpec;
    inputDefaults?: Record<string, ParamValue>;
    [key: string]: any;
  };
  selected?: boolean;
  children?: React.ReactNode;
  minWidth?: string;
  maxWidth?: string;
  headerExtra?: React.ReactNode;
  headerIcon?: React.ReactNode;
  headerTag?: string;
  onHeaderDoubleClick?: () => void;
}

const InlineInputControl: React.FC<{
  nodeId: string;
  portSpec: PortSpec;
  value?: ParamValue;
}> = ({ nodeId, portSpec, value }) => {
  const setInputDefaultLive = useGraphStore(s => s.setInputDefaultLive);
  const setInputDefaultCommit = useGraphStore(s => s.setInputDefaultCommit);

  const currentValue = value ?? portSpec.default;
  if (!currentValue) return <span className="node-port__label">{portSpec.label}</span>;

  const rawValue = extractParamValue(currentValue as ParamValue);
  const uiHint = portSpec.ui_hint?.type ?? (portSpec.ty === 'Float' ? 'Slider' : portSpec.ty === 'Int' ? 'NumberInput' : 'Checkbox');

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
          backgroundColor: `rgba(${sr}, ${sg}, ${sb}, ${a})`,
          border: '1px solid var(--border-default)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}>
          <input
            type="color"
            value={hex}
            onInput={(e) => {
              const [nr, ng, nb] = hexToLinear((e.target as HTMLInputElement).value);
              setInputDefaultLive(nodeId, portSpec.name, createParamValue(portSpec.ty, [nr, ng, nb, a]));
            }}
            onChange={(e) => {
              const [nr, ng, nb] = hexToLinear(e.target.value);
              const value = createParamValue(portSpec.ty, [nr, ng, nb, a]);
              setInputDefaultLive(nodeId, portSpec.name, value);
              setInputDefaultCommit(nodeId, portSpec.name, value);
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
  headerExtra, headerIcon, headerTag, onHeaderDoubleClick,
}) => {
  const { spec } = data;
  const muted = useGraphStore(s => s.nodes.get(id)?.muted ?? false);
  const timing = useGraphStore(s => s.nodeTimings.get(id));
  const showTimings = useSettingsStore(s => s.showTimings);
  const connections = useGraphStore(s => s.connections);
  const connectedInputs = new Set(
    connections
      .filter(c => c.toNode === id)
      .map(c => c.toPort)
  );

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
      <div
        className="base-node__header"
        style={{ background: getHeaderBackground(spec.category) }}
        onDoubleClick={onHeaderDoubleClick}
      >
        {headerIcon && <span className="base-node__icon">{headerIcon}</span>}
        <span className="base-node__title" title={spec.display_name}>
          {spec.display_name}
        </span>
        {headerTag && <div className="node-badge node-badge--default" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>{headerTag}</div>}
        {badge}
        {headerExtra}
      </div>

      <div className="base-node__body">
        {spec.inputs.map((input: PortSpec) => {
          const isConnected = connectedInputs.has(input.name);
          const isScalar = input.ty === 'Float' || input.ty === 'Int' || input.ty === 'Bool' || input.ty === 'Color';
          const hasDefault = isScalar && !isConnected && (input.default != null || data.inputDefaults?.[input.name] != null || data.params?.[input.name] != null);

          return (
            <div key={input.name} className="node-port">
              <Handle
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
                  value={data.inputDefaults?.[input.name] ?? data.params?.[input.name]}
                />
              ) : (
                <span className="node-port__label">{input.label}</span>
              )}
            </div>
          );
        })}

        {children}

        {spec.outputs.map((output: PortSpec) => (
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
