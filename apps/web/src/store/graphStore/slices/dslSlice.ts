import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';
import type { DslShadowCustomDefinitionName, DslShadowDocument } from '../../types';
import { buildDslShadowFromText, graphSemanticHash, handleMapFromShadow, reconcileDslShadowText } from '../../../ai/dsl/shadow';
import { serializeGraph } from '../../../ai/dsl/serializer';
import { parseDsl } from '../../../ai/dsl/parser';
import type { DslAst, DslSourceMap } from '../../../ai/dsl/types';
import type { HandleMap } from '../../../ai/dsl/handleMap';

export interface DslSliceState {
  dslShadow: DslShadowDocument | null;
}

export interface DslSliceActions {
  getDslShadow: () => DslShadowDocument | null;
  setDslShadowFromEditor: (
    text: string,
    handleMap: HandleMap,
    ast: DslAst | null,
    sourceMap?: DslSourceMap,
    customDefinitionNames?: DslShadowCustomDefinitionName[],
  ) => void;
  refreshDslShadowFromGraph: (reason?: string) => void;
  clearDslShadow: () => void;
}

export type DslSlice = DslSliceState & DslSliceActions;

export const createDslSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  DslSlice
> = (set, get) => ({
  dslShadow: null,

  getDslShadow: () => get().dslShadow,

  setDslShadowFromEditor: (text, handleMap, ast, sourceMap, customDefinitionNames) => {
    const state = get();
    set({
      dslShadow: buildDslShadowFromText({
        text,
        nodes: state.nodes,
        connections: state.connections,
        customGroupDefinitions: state.customGroupDefinitions,
        customDefinitionNames: customDefinitionNames ?? state.dslShadow?.customDefinitionNames,
        graphRevision: state.graphRevision,
        handleMap,
        ast,
        sourceMap,
      }),
    });
  },

  refreshDslShadowFromGraph: () => {
    const state = get();
    const handleMap = handleMapFromShadow(state.nodes, state.dslShadow);
    const serialized = serializeGraph({
      nodes: state.nodes,
      connections: state.connections,
      nodeSpecs: state.nodeSpecs,
      handleMap,
      groupDefinitions: state.customGroupDefinitions,
      customDefinitionNames: state.dslShadow?.customDefinitionNames,
      pruneUnusedCustomDefinitions: true,
      customNodes: state.dslShadow?.status === 'valid'
        ? parseDsl(state.dslShadow.text, state.nodeSpecs, { currentNodes: state.nodes, handleMap }).ast?.customNodes
        : undefined,
    });
    const serializedParse = parseDsl(serialized, state.nodeSpecs, { currentNodes: state.nodes, handleMap });
    const text = state.dslShadow?.text
      ? reconcileDslShadowText(
          state.dslShadow.text,
          state.dslShadow.sourceMap,
          serialized,
          serializedParse.sourceMap,
        ) ?? serialized
      : serialized;
    const parseResult = text === serialized
      ? serializedParse
      : parseDsl(text, state.nodeSpecs, { currentNodes: state.nodes, handleMap });
    set({
      dslShadow: buildDslShadowFromText({
        text,
        nodes: state.nodes,
        connections: state.connections,
        customGroupDefinitions: state.customGroupDefinitions,
        customDefinitionNames: state.dslShadow?.customDefinitionNames,
        graphRevision: state.graphRevision,
        handleMap,
        ast: parseResult.ast,
        sourceMap: parseResult.sourceMap,
      }),
    });
  },

  clearDslShadow: () => {
    set({ dslShadow: null });
  },
});

export const markDslShadowForGraphChange = (
  shadow: DslShadowDocument | null,
  nodes: GraphState['nodes'],
  connections: GraphState['connections'],
  customGroupDefinitions: GraphState['customGroupDefinitions'] = [],
): DslShadowDocument | null => {
  if (!shadow) return null;
  const graphHash = graphSemanticHash(nodes, connections, customGroupDefinitions);
  if (shadow.graphHash === graphHash) return shadow;
  return { ...shadow, graphHash, status: 'stale' };
};
