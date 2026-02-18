import React, { useState, useCallback, useMemo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { NodeSection } from './NodePrimitives';
import { getNodeIcon } from './nodeIcons';
import { CurveEditor } from './CurveEditor';
import { useGraphStore } from '../../store/graphStore';
import type { NodeSpec, ParamValue, CurvePoint } from '../../store/types';

type NodeData = {
  label: string;
  spec: NodeSpec;
  params: Record<string, ParamValue>;
};

const CHANNEL_KEYS = ['master_curve', 'red_curve', 'green_curve', 'blue_curve'] as const;
const CHANNEL_NAMES = ['Master', 'Red', 'Green', 'Blue'] as const;
const CHANNEL_IDS = ['master', 'red', 'green', 'blue'] as const;
const CHANNEL_COLORS = [
  'var(--text-primary)',
  '#FF4444',
  '#44DD44',
  '#4488FF',
];

const DEFAULT_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

function getCurvePoints(params: Record<string, ParamValue>, key: string): CurvePoint[] {
  const val = params[key];
  if (val && typeof val === 'object' && 'CurvePoints' in val) {
    return (val as { CurvePoints: CurvePoint[] }).CurvePoints;
  }
  return DEFAULT_POINTS;
}

export const CurvesNode: React.FC<NodeProps> = (props) => {
  const data = props.data as NodeData;
  const { params } = data;
  const setParam = useGraphStore(s => s.setParam);
  const setParamLive = useGraphStore(s => s.setParamLive);
  const setParamCommit = useGraphStore(s => s.setParamCommit);

  const [activeChannel, setActiveChannel] = useState(0);

  const curveKey = CHANNEL_KEYS[activeChannel];
  const channelId = CHANNEL_IDS[activeChannel];
  const points = useMemo(() => getCurvePoints(params, curveKey), [params, curveKey]);

  const handleChange = useCallback((newPoints: CurvePoint[]) => {
    setParam(props.id, curveKey, { CurvePoints: newPoints } as ParamValue);
  }, [props.id, curveKey, setParam]);

  const handleChangeLive = useCallback((newPoints: CurvePoint[]) => {
    setParamLive(props.id, curveKey, { CurvePoints: newPoints } as ParamValue);
  }, [props.id, curveKey, setParamLive]);

  const handleChangeCommit = useCallback((newPoints: CurvePoint[]) => {
    setParamCommit(props.id, curveKey, { CurvePoints: newPoints } as ParamValue);
  }, [props.id, curveKey, setParamCommit]);

  const handleReset = useCallback(() => {
    setParam(props.id, curveKey, { CurvePoints: [...DEFAULT_POINTS] } as ParamValue);
  }, [props.id, curveKey, setParam]);

  return (
    <BaseNode {...props} data={data} minWidth="240px" maxWidth="280px" headerIcon={getNodeIcon('curves', 'Color')}>
      <div
        className="nopan nodrag nowheel"
        style={{ userSelect: 'none' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Channel tabs */}
        <NodeSection>
          <div style={{
            display: 'flex',
            gap: '2px',
            marginBottom: '4px',
          }}>
            {CHANNEL_NAMES.map((name, idx) => (
              <button
                key={name}
                onClick={() => setActiveChannel(idx)}
                style={{
                  flex: 1,
                  padding: '3px 0',
                  fontSize: '0.7rem',
                  fontWeight: activeChannel === idx ? 600 : 400,
                  color: activeChannel === idx ? CHANNEL_COLORS[idx] : 'var(--text-muted)',
                  background: activeChannel === idx ? 'var(--bg-surface, var(--bg-secondary))' : 'transparent',
                  border: '1px solid',
                  borderColor: activeChannel === idx ? 'var(--border-default)' : 'transparent',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {name.charAt(0)}
              </button>
            ))}
          </div>
        </NodeSection>

        {/* Curve editor */}
        <CurveEditor
          points={points}
          onChange={handleChange}
          onChangeLive={handleChangeLive}
          onChangeCommit={handleChangeCommit}
          channel={channelId}
          width={240}
          height={200}
        />

        {/* Reset button */}
        <NodeSection>
          <button
            onClick={handleReset}
            style={{
              width: '100%',
              padding: '3px 8px',
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '3px',
              cursor: 'pointer',
              marginTop: '2px',
            }}
          >
            Reset
          </button>
        </NodeSection>
      </div>
    </BaseNode>
  );
};
