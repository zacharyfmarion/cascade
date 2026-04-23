import type { NodeSpec } from '../store/types';
import type { RuntimeSurface } from './runtime';

export type AppFeatureId = 'macDownloadCta';

const FEATURE_SURFACES: Record<AppFeatureId, RuntimeSurface[]> = {
  macDownloadCta: ['web'],
};

export function isFeatureVisible(featureId: AppFeatureId, surface: RuntimeSurface): boolean {
  return FEATURE_SURFACES[featureId].includes(surface);
}

export function isNodeSupportedOnSurface(
  spec: Pick<NodeSpec, 'supported_surfaces'>,
  surface: RuntimeSurface,
): boolean {
  return !spec.supported_surfaces?.length || spec.supported_surfaces.includes(surface);
}

export function getAuthoringNodeSpecs(nodeSpecs: NodeSpec[], surface: RuntimeSurface): NodeSpec[] {
  return nodeSpecs.filter(spec => isNodeSupportedOnSurface(spec, surface));
}

export function getUnsupportedNodeMessage(
  spec: Pick<NodeSpec, 'display_name' | 'supported_surfaces'>,
  surface: RuntimeSurface,
): string | null {
  if (isNodeSupportedOnSurface(spec, surface)) {
    return null;
  }

  if (
    spec.supported_surfaces?.length === 1
    && spec.supported_surfaces[0] === 'desktop'
  ) {
    return `${spec.display_name} is only available in the desktop app.`;
  }

  const supported = spec.supported_surfaces?.join(', ') ?? 'another platform';
  return `${spec.display_name} is not available on ${surface}. Available on: ${supported}.`;
}
