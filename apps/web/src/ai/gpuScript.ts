import type { NodeSpec, ParamDefault, ParamSpec, PortSpec } from '../store/types';
import { createAnthropicMessagesRequest } from './anthropic';

export type ScriptPort = {
  name: string;
  label: string;
  ty: string;
  default?: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  ui?: string;
};

export type ScriptParam = {
  key: string;
  label: string;
  ty: string;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
};

export type GlslManifest = {
  inputs: ScriptPort[];
  outputs: ScriptPort[];
  params?: Array<{
    key: string;
    label: string;
    type: string;
    default: number | boolean;
    min?: number;
    max?: number;
    step?: number;
    ui?: string;
  }>;
  kernel: string;
  supports_mask?: boolean;
};

export type GpuScriptManifest = {
  id: string;
  display_name: string;
  category: string;
  description: string;
  inputs: ScriptPort[];
  outputs: ScriptPort[];
  params: Array<{
    key: string;
    label: string;
    type: string;
    default: number | boolean;
    min?: number;
    max?: number;
    step?: number;
    ui: string;
  }>;
  kernel: string;
  supports_mask: boolean;
};

export const GPU_SCRIPT_SYSTEM_PROMPT = `You are a GLSL compute shader expert. You generate GPU kernel code for a Cascade image editor.

## Architecture
The user's GLSL code becomes the body of this function:

\`\`\`glsl
vec4 process(vec4 color, vec2 uv, ivec2 pixel) {
  // YOUR CODE HERE
}
\`\`\`

This function receives:
- \`color\`: the RGBA value of the current pixel from the primary input image (linear f16)
- \`uv\`: normalized coordinates [0,1] of the current pixel
- \`pixel\`: integer pixel coordinates (ivec2)

Available globals:
- \`u_input\`: the primary input image (readonly image2D). Use \`imageLoad(u_input, ivec2)\` and \`imageSize(u_input)\`
- Additional image inputs are bound as \`u_<name>\` (readonly image2D)
- Scalar input controls are available directly by name as uniforms
- Helper: \`float bayer8(int x, int y)\` — 8x8 Bayer dithering threshold [0,1)
- Helper: \`float luminance(vec4 c)\` — perceptual luminance

## Rules
1. Return a vec4 (RGBA). Always preserve alpha unless intentionally modifying it.
2. Use GLSL 450 syntax. No texture() calls — use imageLoad/imageStore only.
3. User controls must be scalar inputs with type "Float", "Int", or "Bool"; no structs or arrays.
4. Image inputs/outputs must be type "Image" or "Mask".
5. Keep kernels efficient — they run per-pixel on the GPU.
6. Use \`clamp()\`, \`mix()\`, \`smoothstep()\` for clean blending.

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "inputs": [
    {"name": "image", "label": "Image", "ty": "Image"},
    {"name": "amount", "label": "Amount", "ty": "Float", "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "ui": "Slider"}
  ],
  "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
  "params": [],
  "kernel": "// GLSL code here\\nreturn vec4(...);"
}

Scalar input ui options: "Slider" (for float), "NumberInput" (for int), "Checkbox" (for bool)

## Example
User: "vignette effect"
Response:
{
  "inputs": [
    {"name": "image", "label": "Image", "ty": "Image"},
    {"name": "strength", "label": "Strength", "ty": "Float", "default": 0.5, "min": 0.0, "max": 2.0, "step": 0.01, "ui": "Slider"},
    {"name": "radius", "label": "Radius", "ty": "Float", "default": 0.7, "min": 0.0, "max": 1.5, "step": 0.01, "ui": "Slider"},
    {"name": "softness", "label": "Softness", "ty": "Float", "default": 0.3, "min": 0.01, "max": 1.0, "step": 0.01, "ui": "Slider"}
  ],
  "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
  "params": [],
  "kernel": "float d = distance(uv, vec2(0.5));\\nfloat v = 1.0 - smoothstep(radius - softness, radius, d) * strength;\\nreturn vec4(color.rgb * v, color.a);"
}`;

export const generateGlslKernel = async (prompt: string, apiKey: string): Promise<GlslManifest> => {
  const request = createAnthropicMessagesRequest(apiKey);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      system: GPU_SCRIPT_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text || typeof text !== 'string') {
    throw new Error('Anthropic response missing content text');
  }

  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Parsed response is not an object');
  }

  const manifest = parsed as Partial<GlslManifest>;

  if (!manifest.inputs || !manifest.outputs || !manifest.kernel) {
    throw new Error('Response missing required fields (inputs, outputs, kernel)');
  }

  return { ...manifest, params: manifest.params ?? [] } as GlslManifest;
};

export const isScalarScriptType = (ty: string): boolean => ty === 'Float' || ty === 'Int' || ty === 'Bool';

const scalarDefaultForType = (ty: string): number | boolean => ty === 'Bool' ? false : 0;

const normalizeScalarDefault = (ty: string, value: number | boolean | undefined): number | boolean => {
  if (ty === 'Bool') return Boolean(value);
  if (ty === 'Int') return Math.round(Number(value ?? 0));
  return Number(value ?? 0);
};

export const scriptParamToInputPort = (param: ScriptParam | GpuScriptManifest['params'][number]): ScriptPort => {
  const ty = 'ty' in param ? param.ty : param.type;
  const key = 'key' in param ? param.key : '';
  return {
    name: key,
    label: param.label,
    ty,
    default: normalizeScalarDefault(ty, param.default),
    min: param.min,
    max: param.max,
    step: param.step,
    ui: ty === 'Bool' ? 'Checkbox' : ty === 'Int' ? 'NumberInput' : 'Slider',
  };
};

const normalizeInputPort = (port: ScriptPort): ScriptPort => {
  if (!isScalarScriptType(port.ty)) {
    return { name: port.name, label: port.label, ty: port.ty };
  }

  return {
    name: port.name,
    label: port.label,
    ty: port.ty,
    default: normalizeScalarDefault(port.ty, port.default),
    min: port.min,
    max: port.max,
    step: port.step,
    ui: port.ui ?? (port.ty === 'Bool' ? 'Checkbox' : port.ty === 'Int' ? 'NumberInput' : 'Slider'),
  };
};

export const buildGpuScriptManifest = (
  typeId: string,
  inputs: ScriptPort[],
  outputs: ScriptPort[],
  params: ScriptParam[],
  kernel: string,
  supportsMask = true,
): GpuScriptManifest => ({
  id: typeId,
  display_name: 'GPU Script',
  category: 'GPU',
  description: 'Custom GPU shader node',
  inputs: [
    ...inputs.map(normalizeInputPort),
    ...params
      .map(scriptParamToInputPort)
      .filter(paramInput => !inputs.some(input => input.name === paramInput.name)),
  ],
  outputs,
  params: [],
  kernel,
  supports_mask: supportsMask,
});

export const buildGpuScriptManifestFromGlsl = (typeId: string, manifest: GlslManifest): GpuScriptManifest => {
  const params: ScriptParam[] = (manifest.params ?? []).map(param => ({
    key: param.key,
    label: param.label,
    ty: param.type,
    default: param.default,
    min: param.min,
    max: param.max,
    step: param.step,
  }));

  return buildGpuScriptManifest(
    typeId,
    manifest.inputs,
    manifest.outputs,
    params,
    manifest.kernel,
    manifest.supports_mask ?? true,
  );
};

export const buildDefaultGpuScriptManifest = (typeId: string): GpuScriptManifest =>
  buildGpuScriptManifest(
    typeId,
    [{ name: 'image', label: 'Image', ty: 'Image' }],
    [{ name: 'image', label: 'Image', ty: 'Image' }],
    [],
    'return color;',
    true,
  );

export const parseGpuScriptManifestJson = (manifestJson?: string | null): GpuScriptManifest | null => {
  if (!manifestJson) return null;
  try {
    const parsed = JSON.parse(manifestJson) as Partial<GpuScriptManifest>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.inputs) || !Array.isArray(parsed.outputs)) {
      return null;
    }
    if (typeof parsed.kernel !== 'string') return null;
    return {
      id: typeof parsed.id === 'string' ? parsed.id : 'gpu_script',
      display_name: typeof parsed.display_name === 'string' ? parsed.display_name : 'GPU Script',
      category: typeof parsed.category === 'string' ? parsed.category : 'GPU',
      description: typeof parsed.description === 'string' ? parsed.description : 'Custom GPU shader node',
      inputs: parsed.inputs as ScriptPort[],
      outputs: parsed.outputs as ScriptPort[],
      params: Array.isArray(parsed.params) ? parsed.params as GpuScriptManifest['params'] : [],
      kernel: parsed.kernel,
      supports_mask: parsed.supports_mask ?? true,
    };
  } catch {
    return null;
  }
};

const buildParamDefault = (param: GpuScriptManifest['params'][number]): ParamDefault =>
  param.type === 'Bool'
    ? { Bool: Boolean(param.default) }
    : param.type === 'Int'
      ? { Int: Math.round(Number(param.default)) }
      : { Float: Number(param.default) };

const buildParamSpec = (param: GpuScriptManifest['params'][number]): ParamSpec => ({
  key: param.key,
  label: param.label,
  ty: param.type as ParamSpec['ty'],
  default: buildParamDefault(param),
  min: param.min,
  max: param.max,
  step: param.step,
  ui_hint: { type: param.ui === 'Checkbox' ? 'Checkbox' : param.ui === 'NumberInput' ? 'NumberInput' : 'Slider' },
  promotable: true,
});

const buildPortDefault = (port: ScriptPort): ParamDefault | undefined => {
  if (!isScalarScriptType(port.ty)) return undefined;
  if (port.ty === 'Bool') return { Bool: Boolean(port.default ?? scalarDefaultForType(port.ty)) };
  if (port.ty === 'Int') return { Int: Math.round(Number(port.default ?? scalarDefaultForType(port.ty))) };
  return { Float: Number(port.default ?? scalarDefaultForType(port.ty)) };
};

const buildPortSpec = (port: ScriptPort): PortSpec => {
  const spec: PortSpec = {
    name: port.name,
    label: port.label,
    ty: port.ty as PortSpec['ty'],
  };
  if (isScalarScriptType(port.ty)) {
    spec.default = buildPortDefault(port);
    spec.min = port.min;
    spec.max = port.max;
    spec.step = port.step;
    spec.ui_hint = { type: port.ui === 'Checkbox' ? 'Checkbox' : port.ui === 'NumberInput' ? 'NumberInput' : 'Slider' };
  }
  return spec;
};

export const buildGpuScriptNodeSpec = (manifest: GpuScriptManifest): NodeSpec => {
  const inputs: PortSpec[] = manifest.inputs.map(buildPortSpec);
  if (manifest.supports_mask) {
    inputs.push({ name: 'mask', label: 'Mask', ty: 'Mask' });
  }

  return {
    id: manifest.id,
    display_name: manifest.display_name,
    category: manifest.category,
    description: manifest.description,
    inputs,
    outputs: manifest.outputs.map((port) => ({
      name: port.name,
      label: port.label,
      ty: port.ty as PortSpec['ty'],
    })),
    params: manifest.params.map(buildParamSpec),
  };
};
