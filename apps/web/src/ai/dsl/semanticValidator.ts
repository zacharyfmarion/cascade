import type { EditOp, EditValidationError } from '../../engine/bridge';
import type { GraphMutation, DslSourceMap, ValidationError } from './types';
import type { HandleMap } from './handleMap';

/**
 * Convert a GraphMutation to an EditOp for Rust-side validation.
 * Only connect/disconnect/addNode/removeNode are relevant — setParam
 * and setMuted don't need semantic validation.
 */
function toEditOp(mutation: GraphMutation, index: number, handleMap: HandleMap): EditOp | null {
  switch (mutation.type) {
    case 'addNode':
      return {
        type: 'addNode',
        op_id: index,
        type_id: mutation.typeId,
      };
    case 'removeNode': {
      const nodeId = handleMap.getNodeId(mutation.handle);
      return {
        type: 'removeNode',
        op_id: index,
        node_id: nodeId ?? mutation.handle,
      };
    }
    case 'connect': {
      const fromId = handleMap.getNodeId(mutation.fromHandle);
      const toId = handleMap.getNodeId(mutation.toHandle);
      return {
        type: 'connect',
        op_id: index,
        from_node: fromId ?? mutation.fromHandle,
        from_port: mutation.fromPort,
        to_node: toId ?? mutation.toHandle,
        to_port: mutation.toPort,
      };
    }
    case 'disconnect': {
      const toNodeId = handleMap.getNodeId(mutation.toHandle);
      return {
        type: 'disconnect',
        op_id: index,
        to_node: toNodeId ?? mutation.toHandle,
        to_port: mutation.toPort,
      };
    }
    default:
      // setParam, setMuted — no semantic validation needed
      return null;
  }
}

/**
 * Resolve the DSL line number for a given mutation using the source map.
 * Falls back to line 1 if no mapping is found.
 */
function resolveLineFromMutation(mutation: GraphMutation, sourceMap: DslSourceMap): number {
  switch (mutation.type) {
    case 'addNode':
    case 'removeNode':
    case 'setParam':
    case 'setMuted': {
      const handle = 'handle' in mutation ? mutation.handle : '';
      const span = sourceMap.nodeSpans.get(handle);
      return span?.startLine ?? 1;
    }
    case 'connect': {
      const key = `${mutation.fromHandle}.${mutation.fromPort}->${mutation.toHandle}.${mutation.toPort}`;
      const span = sourceMap.connectionSpans.get(key);
      return span?.startLine ?? 1;
    }
    case 'disconnect': {
      // Disconnects don't have a direct source line in the new DSL — fall back
      return 1;
    }
    default:
      return 1;
  }
}

/**
 * Validate a set of graph mutations against the Rust engine's semantic rules.
 * This catches type mismatches, missing ports, cycles, and unknown node types
 * using the real engine codepaths (via graph.clone() dry-run).
 *
 * @param mutations - The graph mutations to validate
 * @param sourceMap - Source map for mapping errors back to DSL lines
 * @param handleMap - Current handle→nodeId mapping
 * @param validateEditsFn - Engine's validateEdits function
 * @returns Validation errors mapped to DSL line numbers
 */
export function validateSemantics(
  mutations: GraphMutation[],
  sourceMap: DslSourceMap,
  handleMap: HandleMap,
  validateEditsFn: (editsJson: string) => EditValidationError[],
): ValidationError[] {
  // Convert mutations to EditOps, filtering out non-semantic ones
  const editOps: EditOp[] = [];
  const opIndexToMutationIndex = new Map<number, number>();

  for (let i = 0; i < mutations.length; i++) {
    const editOp = toEditOp(mutations[i], editOps.length, handleMap);
    if (editOp) {
      opIndexToMutationIndex.set(editOp.op_id, i);
      editOps.push(editOp);
    }
  }

  if (editOps.length === 0) return [];

  const rustErrors = validateEditsFn(JSON.stringify(editOps));

  // Map Rust errors back to DSL line numbers
  return rustErrors.map((err) => {
    const mutationIndex = opIndexToMutationIndex.get(err.op_id);
    const mutation = mutationIndex !== undefined ? mutations[mutationIndex] : undefined;
    const line = mutation ? resolveLineFromMutation(mutation, sourceMap) : 1;
    return { line, message: err.message };
  });
}