export type ScriptPort = { name: string; label: string; ty: string };

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
  params: Array<{
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
- All params from the Params uniform block are available directly by name
- Helper: \`float bayer8(int x, int y)\` — 8x8 Bayer dithering threshold [0,1)
- Helper: \`float luminance(vec4 c)\` — perceptual luminance

## Rules
1. Return a vec4 (RGBA). Always preserve alpha unless intentionally modifying it.
2. Use GLSL 450 syntax. No texture() calls — use imageLoad/imageStore only.
3. Params must be float, int, or bool. No structs or arrays in params.
4. Image inputs/outputs must be type "Image" or "Mask".
5. Keep kernels efficient — they run per-pixel on the GPU.
6. Use \`clamp()\`, \`mix()\`, \`smoothstep()\` for clean blending.

## Output Format
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "inputs": [{"name": "image", "label": "Image", "ty": "Image"}, ...],
  "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
  "params": [
    {"key": "param_name", "label": "Param Label", "type": "Float", "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "ui": "Slider"},
    ...
  ],
  "kernel": "// GLSL code here\\nreturn vec4(...);"
}

Parameter ui options: "Slider" (for float), "NumberInput" (for int), "Checkbox" (for bool)

## Example
User: "vignette effect"
Response:
{
  "inputs": [{"name": "image", "label": "Image", "ty": "Image"}],
  "outputs": [{"name": "image", "label": "Image", "ty": "Image"}],
  "params": [
    {"key": "strength", "label": "Strength", "type": "Float", "default": 0.5, "min": 0.0, "max": 2.0, "step": 0.01, "ui": "Slider"},
    {"key": "radius", "label": "Radius", "type": "Float", "default": 0.7, "min": 0.0, "max": 1.5, "step": 0.01, "ui": "Slider"},
    {"key": "softness", "label": "Softness", "type": "Float", "default": 0.3, "min": 0.01, "max": 1.0, "step": 0.01, "ui": "Slider"}
  ],
  "kernel": "float d = distance(uv, vec2(0.5));\\nfloat v = 1.0 - smoothstep(radius - softness, radius, d) * strength;\\nreturn vec4(color.rgb * v, color.a);"
}`;

export const generateGlslKernel = async (prompt: string, apiKey: string): Promise<GlslManifest> => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
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

  if (!manifest.inputs || !manifest.outputs || !manifest.params || !manifest.kernel) {
    throw new Error('Response missing required fields (inputs, outputs, params, kernel)');
  }

  return manifest as GlslManifest;
};

export const buildGpuScriptManifest = (
  typeId: string,
  inputs: ScriptPort[],
  outputs: ScriptPort[],
  params: ScriptParam[],
  kernel: string,
): GpuScriptManifest => ({
  id: typeId,
  display_name: 'GPU Script',
  category: 'GPU',
  description: 'Custom GPU shader node',
  inputs,
  outputs,
  params: params.map(param => ({
    key: param.key,
    label: param.label,
    type: param.ty,
    default: param.ty === 'Bool' ? Boolean(param.default) : Number(param.default),
    min: param.min,
    max: param.max,
    step: param.step,
    ui: param.ty === 'Bool' ? 'Checkbox' : param.ty === 'Int' ? 'NumberInput' : 'Slider',
  })),
  kernel,
});

export const buildGpuScriptManifestFromGlsl = (typeId: string, manifest: GlslManifest): GpuScriptManifest => {
  const params: ScriptParam[] = manifest.params.map(param => ({
    key: param.key,
    label: param.label,
    ty: param.type,
    default: param.default,
    min: param.min,
    max: param.max,
    step: param.step,
  }));

  return buildGpuScriptManifest(typeId, manifest.inputs, manifest.outputs, params, manifest.kernel);
};
