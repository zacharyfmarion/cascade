import type { NodeSpec, ParamDefault } from '../store/types';
import {
  isScalarScriptType,
  parseGpuScriptManifestJson,
  scriptParamToInputPort,
  type ScriptPort,
} from '../ai/gpuScript';

export type ScriptDraftPort = ScriptPort & { id: string };

export interface ScriptEditorState {
  inputs: ScriptDraftPort[];
  outputs: ScriptDraftPort[];
  kernel: string;
  supportsMask: boolean;
  pixelSpaceParams: string[];
  compileStatus: 'idle' | 'compiling' | 'success' | 'error';
  compileError: string | null;
}

export const makeId = (prefix: string, index?: number): string =>
  typeof index === 'number' ? `${prefix}_${index}` : `${prefix}_${crypto.randomUUID()}`;

const DEFAULT_STATE: ScriptEditorState = {
  inputs: [{ id: 'in_0', name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ id: 'out_0', name: 'image', label: 'Image', ty: 'Image' }],
  kernel: 'return color;',
  supportsMask: true,
  pixelSpaceParams: [],
  compileStatus: 'idle',
  compileError: null,
};

export const scalarDefault = (ty: string): number | boolean => ty === 'Bool' ? false : 0;

export const uiHintForType = (ty: string): string =>
  ty === 'Bool' ? 'Checkbox' : ty === 'Int' ? 'NumberInput' : 'Slider';

const defaultFromParamDefault = (value?: ParamDefault): number | boolean | undefined => {
  if (!value) return undefined;
  if ('Float' in value) return value.Float;
  if ('Int' in value) return value.Int;
  if ('Bool' in value) return value.Bool;
  return undefined;
};

export const sanitizeScalarPort = (port: ScriptDraftPort): ScriptDraftPort => {
  if (!isScalarScriptType(port.ty)) {
    return {
      id: port.id,
      name: port.name,
      label: port.label,
      ty: port.ty,
    };
  }

  return {
    ...port,
    default: port.default ?? scalarDefault(port.ty),
    ui: port.ui ?? uiHintForType(port.ty),
  };
};

const toDraftPort = (port: ScriptPort, prefix: string, index: number): ScriptDraftPort =>
  sanitizeScalarPort({ ...port, id: makeId(prefix, index) });

const manifestInputsWithLegacyParams = (manifest: NonNullable<ReturnType<typeof parseGpuScriptManifestJson>>): ScriptPort[] => {
  const inputs = [...manifest.inputs];
  const inputNames = new Set(inputs.map(input => input.name));
  for (const param of manifest.params) {
    const migrated = scriptParamToInputPort(param);
    if (!inputNames.has(migrated.name)) {
      inputs.push(migrated);
      inputNames.add(migrated.name);
    }
  }
  return inputs;
};

const portFromSpecInput = (input: NodeSpec['inputs'][number], index: number): ScriptDraftPort =>
  sanitizeScalarPort({
    id: makeId('in', index),
    name: input.name,
    label: input.label,
    ty: input.ty,
    default: defaultFromParamDefault(input.default),
    min: input.min,
    max: input.max,
    step: input.step,
    ui: input.ui_hint?.type,
  });

export const createScriptEditorInitialState = (
  typeId: string,
  manifestJson: string | null,
  spec?: NodeSpec,
): ScriptEditorState => {
  const manifest = parseGpuScriptManifestJson(manifestJson);
  if (manifest) {
    return {
      inputs: manifestInputsWithLegacyParams(manifest).map((port, i) => toDraftPort(port, 'in', i)),
      outputs: manifest.outputs.map((port, i) => toDraftPort(port, 'out', i)),
      kernel: manifest.kernel,
      supportsMask: manifest.supports_mask,
      pixelSpaceParams: manifest.pixel_space_params,
      compileStatus: 'success',
      compileError: null,
    };
  }

  if (spec) {
    return {
      inputs: spec.inputs
        .filter((port) => !(port.name === 'mask' && port.ty === 'Mask'))
        .map(portFromSpecInput),
      outputs: spec.outputs.map((port, i) => toDraftPort({
        name: port.name,
        label: port.label,
        ty: port.ty,
      }, 'out', i)),
      kernel: 'return color;',
      supportsMask: spec.inputs.some((port) => port.name === 'mask' && port.ty === 'Mask'),
      pixelSpaceParams: [],
      compileStatus: 'idle',
      compileError: null,
    };
  }

  return {
    ...DEFAULT_STATE,
    inputs: DEFAULT_STATE.inputs.map((port, i) => ({ ...port, id: makeId('in', i) })),
    outputs: DEFAULT_STATE.outputs.map((port, i) => ({ ...port, id: makeId('out', i) })),
    supportsMask: typeId.startsWith('gpu_script'),
  };
};
