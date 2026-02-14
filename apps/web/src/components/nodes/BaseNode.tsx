import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { useGraphStore } from '../../store/graphStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { NodeSpec, PortSpec } from '../../store/types';

interface BaseNodeProps {
  id: string;
  data: {
    label: string;
    spec: NodeSpec;
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

export const getPortColor = (type: string) => {
  switch (type) {
    case 'Image': return 'var(--port-image)';
    case 'Mask': return 'var(--port-mask)';
    case 'Float': return 'var(--port-float)';
    case 'Int': return 'var(--port-int)';
    case 'Bool': return 'var(--port-bool)';
    case 'Color': return 'var(--port-color)';
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
    case 'Group': return 'linear-gradient(135deg, #4a6fa5, #2d4a7d)';
    default: return 'var(--slider-bg)';
  }
};

export const BaseNode: React.FC<BaseNodeProps> = ({
  id, data, selected, children, minWidth, maxWidth,
  headerExtra, headerIcon, headerTag, onHeaderDoubleClick,
}) => {
  const { spec } = data;
  const timing = useGraphStore(s => s.nodeTimings.get(id));
  const showTimings = useSettingsStore(s => s.showTimings);

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
      className={`base-node ${selected ? 'base-node--selected' : ''}`}
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
        {spec.inputs.map((input: PortSpec) => (
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
            <span className="node-port__label">
              {input.label}
            </span>
          </div>
        ))}

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
