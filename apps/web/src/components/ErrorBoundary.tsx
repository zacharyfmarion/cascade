import React from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { NodeProps } from '@xyflow/react';

type ErrorBoundaryKind = 'node' | 'pane';

type ErrorBoundaryStyle = {
  container?: React.CSSProperties;
  details?: React.CSSProperties;
};

type ErrorBoundaryProps = {
  kind: ErrorBoundaryKind;
  label: string;
  instanceId?: string;
  resetKey: unknown;
  style?: ErrorBoundaryStyle;
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[AppErrorBoundary] ${this.props.kind} render failed`, {
      kind: this.props.kind,
      label: this.props.label,
      instanceId: this.props.instanceId,
      message: error.message,
      error,
      componentStack: errorInfo.componentStack,
    });
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isNode = this.props.kind === 'node';

    return (
      <div
        className={isNode ? 'node-error-boundary nodrag nopan' : 'panel-error-boundary'}
        style={{
          width: isNode ? '180px' : '100%',
          minWidth: isNode ? '180px' : undefined,
          maxWidth: isNode ? '220px' : undefined,
          height: isNode ? undefined : '100%',
          padding: isNode ? '10px' : '16px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: isNode ? undefined : 'center',
          border: '1px solid var(--status-danger)',
          borderRadius: isNode ? '6px' : '8px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          boxShadow: isNode ? 'var(--node-shadow)' : 'none',
          ...this.props.style?.container,
        }}
      >
        <div style={{ fontSize: isNode ? '0.75rem' : '1rem', fontWeight: 700, marginBottom: '6px' }}>
          {isNode ? 'Node render failed' : 'Pane render failed'}
        </div>
        <div style={{ fontSize: isNode ? '0.65rem' : '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          {this.props.label}
          {this.props.instanceId ? ` (${this.props.instanceId})` : ''}
        </div>
        <pre
          style={{
            margin: 0,
            maxHeight: isNode ? '96px' : '140px',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: isNode ? '0.65rem' : '0.75rem',
            color: 'var(--status-danger)',
            ...this.props.style?.details,
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            marginTop: '8px',
            width: '100%',
            padding: isNode ? '4px 8px' : '8px 12px',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: isNode ? '0.7rem' : '0.8rem',
          }}
        >
          Retry {isNode ? 'node' : 'pane'}
        </button>
      </div>
    );
  }
}

type NodeComponent = React.ComponentType<NodeProps>;
type PanelComponent = React.ComponentType<IDockviewPanelProps>;

const nodeBoundaryCache = new WeakMap<NodeComponent, Map<string, NodeComponent>>();
const panelBoundaryCache = new WeakMap<PanelComponent, Map<string, React.FC<IDockviewPanelProps>>>();

export function withNodeErrorBoundary(Component: NodeComponent, nodeType: string): NodeComponent {
  let byType = nodeBoundaryCache.get(Component);
  if (!byType) {
    byType = new Map();
    nodeBoundaryCache.set(Component, byType);
  }

  const cached = byType.get(nodeType);
  if (cached) return cached;

  const SafeNode: React.FC<NodeProps> = (props) => (
    <AppErrorBoundary
      kind="node"
      label={nodeType}
      instanceId={props.id}
      resetKey={props.data}
      style={{ container: getNodeFallbackStyle(nodeType) }}
    >
      <Component {...props} />
    </AppErrorBoundary>
  );

  SafeNode.displayName = `SafeNode(${nodeType})`;
  byType.set(nodeType, SafeNode);
  return SafeNode;
}

export function withPanelErrorBoundary(
  Component: PanelComponent,
  panelType: string,
  panelLabel: string,
): React.FC<IDockviewPanelProps> {
  let byType = panelBoundaryCache.get(Component);
  if (!byType) {
    byType = new Map();
    panelBoundaryCache.set(Component, byType);
  }

  const cached = byType.get(panelType);
  if (cached) return cached;

  const SafePanel: React.FC<IDockviewPanelProps> = (props) => (
    <AppErrorBoundary
      kind="pane"
      label={panelLabel}
      instanceId={props.api.id}
      resetKey={props.api.id}
      style={{ container: { border: 'none', borderRadius: 0 } }}
    >
      <Component {...props} />
    </AppErrorBoundary>
  );

  SafePanel.displayName = `SafePanel(${panelType})`;
  byType.set(panelType, SafePanel);
  return SafePanel;
}

function getNodeFallbackStyle(nodeType: string): React.CSSProperties | undefined {
  switch (nodeType) {
    case 'curves':
    case 'color_palette':
      return { width: '240px', minWidth: '240px', maxWidth: '280px' };
    case 'color_ramp':
      return { width: '280px', minWidth: '280px', maxWidth: '320px' };
    case 'frame':
      return { width: '200px', minWidth: '200px' };
    default:
      return undefined;
  }
}
