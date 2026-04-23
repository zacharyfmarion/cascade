import React from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { NodeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary, withNodeErrorBoundary, withPanelErrorBoundary } from '../components/ErrorBoundary';

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs node render failures with node context', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('render exploded');
    const errorInfo: React.ErrorInfo = { componentStack: '\n    at CurvesNode' };
    const boundary = new AppErrorBoundary({
      kind: 'node',
      label: 'curves',
      instanceId: 'node-1',
      resetKey: null,
      children: null,
    });

    boundary.componentDidCatch(error, errorInfo);

    expect(consoleError).toHaveBeenCalledWith('[AppErrorBoundary] node render failed', {
      kind: 'node',
      label: 'curves',
      instanceId: 'node-1',
      message: error.message,
      error,
      componentStack: errorInfo.componentStack,
    });
  });

  it('reuses wrapped node and pane components for stable registries', () => {
    const NodeComponent: React.FC<NodeProps> = () => null;
    const PanelComponent: React.FC<IDockviewPanelProps> = () => null;

    expect(withNodeErrorBoundary(NodeComponent, 'curves')).toBe(withNodeErrorBoundary(NodeComponent, 'curves'));
    expect(withNodeErrorBoundary(NodeComponent, 'curves')).not.toBe(withNodeErrorBoundary(NodeComponent, 'viewer'));

    expect(withPanelErrorBoundary(PanelComponent, 'inspector', 'Inspector')).toBe(
      withPanelErrorBoundary(PanelComponent, 'inspector', 'Inspector')
    );
    expect(withPanelErrorBoundary(PanelComponent, 'inspector', 'Inspector')).not.toBe(
      withPanelErrorBoundary(PanelComponent, 'viewer', 'Viewer')
    );
  });
});
