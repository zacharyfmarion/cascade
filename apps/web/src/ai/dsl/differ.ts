import type { DslAst, DslConnection, DslNode, GraphMutation } from './types';

export const connectionKey = (conn: DslConnection): string =>
  `${conn.fromHandle}.${conn.fromPort}->${conn.toHandle}.${conn.toPort}`;

const paramValuesEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const diffNodeParams = (oldNode: DslNode, newNode: DslNode): GraphMutation[] => {
  const mutations: GraphMutation[] = [];

  for (const [paramKey, newValue] of newNode.params.entries()) {
    const oldValue = oldNode.params.get(paramKey);
    if (!oldValue || !paramValuesEqual(oldValue, newValue)) {
      mutations.push({ type: 'setParam', handle: newNode.handle, paramKey, value: newValue });
    }
  }

  return mutations;
};

export const diffAst = (oldAst: DslAst, newAst: DslAst): GraphMutation[] => {
  const mutations: GraphMutation[] = [];

  const oldNodes = oldAst.nodes;
  const newNodes = newAst.nodes;

  const oldConnSet = new Set(oldAst.connections.map(connectionKey));
  const newConnSet = new Set(newAst.connections.map(connectionKey));

  const removedConnections = oldAst.connections.filter(conn => !newConnSet.has(connectionKey(conn)));
  const addedConnections = newAst.connections.filter(conn => !oldConnSet.has(connectionKey(conn)));

  const removedNodes = Array.from(oldNodes.keys()).filter(handle => !newNodes.has(handle));
  const addedNodes = Array.from(newNodes.keys()).filter(handle => !oldNodes.has(handle));
  const preservedNodes = Array.from(newNodes.keys()).filter(handle => oldNodes.has(handle));

  removedConnections.forEach(conn => {
    mutations.push({ type: 'disconnect', toHandle: conn.toHandle, toPort: conn.toPort });
  });

  removedNodes.forEach(handle => {
    mutations.push({ type: 'removeNode', handle });
  });

  addedNodes.forEach(handle => {
    const node = newNodes.get(handle);
    if (!node) return;
    mutations.push({
      type: 'addNode',
      handle: node.handle,
      typeId: node.nodeTypeId,
      params: node.params,
      muted: node.muted,
    });
  });

  preservedNodes.forEach(handle => {
    const oldNode = oldNodes.get(handle);
    const newNode = newNodes.get(handle);
    if (!oldNode || !newNode) return;
    mutations.push(...diffNodeParams(oldNode, newNode));
  });

  addedConnections.forEach(conn => {
    mutations.push({
      type: 'connect',
      fromHandle: conn.fromHandle,
      fromPort: conn.fromPort,
      toHandle: conn.toHandle,
      toPort: conn.toPort,
    });
  });

  preservedNodes.forEach(handle => {
    const oldNode = oldNodes.get(handle);
    const newNode = newNodes.get(handle);
    if (!oldNode || !newNode) return;
    if (oldNode.muted !== newNode.muted) {
      mutations.push({ type: 'setMuted', handle, muted: newNode.muted });
    }
  });

  return mutations;
};
