import type { NodeSpec } from '../store/types';

type PortDirection = 'inputs' | 'outputs';

function getNodeSpec(nodeSpecs: NodeSpec[], typeId: string) {
  return nodeSpecs.find(spec => spec.id === typeId);
}

export function getNodeCategory(nodeSpecs: NodeSpec[], typeId: string) {
  return getNodeSpec(nodeSpecs, typeId)?.category ?? 'Unknown';
}

export function getPortType(
  nodeSpecs: NodeSpec[],
  typeId: string,
  portName: string,
  direction: PortDirection
) {
  return getNodeSpec(nodeSpecs, typeId)?.[direction].find(port => port.name === portName)?.ty ?? 'Unknown';
}
