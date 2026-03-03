import React, { useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';

interface ScriptEditorState {
  inputs: Array<{ id: string; name: string; label: string; ty: string }>;
  outputs: Array<{ id: string; name: string; label: string; ty: string }>;
  params: Array<{
    id: string;
    key: string;
    label: string;
    ty: string;
    default: number | boolean;
    min?: number;
    max?: number;
    step?: number;
  }>;
  kernel: string;
  compileStatus: 'idle' | 'compiling' | 'success' | 'error';
  compileError: string | null;
}

const DEFAULT_STATE: ScriptEditorState = {
  inputs: [{ id: 'in_0', name: 'image', label: 'Image', ty: 'Image' }],
  outputs: [{ id: 'out_0', name: 'image', label: 'Image', ty: 'Image' }],
  params: [],
  kernel: 'return color;',
  compileStatus: 'idle',
  compileError: null,
};

const SectionHeader: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div style={{
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '20px',
    marginBottom: '10px',
    paddingBottom: '4px',
    borderBottom: '1px solid var(--border-default)'
  }}>
    <div style={{
      fontSize: '0.75rem',
      fontWeight: 600,
      color: 'var(--text-primary)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {children}
    </div>
    {action}
  </div>
);

const Label: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <div title={title} style={{
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '4px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }}>
    {children}
  </div>
);

const InputGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
    {children}
  </div>
);

const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', ...style }}>
    {children}
  </div>
);

const PortCard: React.FC<{ children: React.ReactNode; onRemove: () => void }> = ({ children, onRemove }) => (
  <div style={{
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '8px',
    position: 'relative'
  }}>
    <button
      type="button"
      onClick={onRemove}
      title="Remove port"
      style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
        background: 'transparent',
        border: 'none',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '14px',
        lineHeight: 1,
        padding: '2px',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--status-error-bright)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      ×
    </button>
    <div style={{ marginRight: '16px' }}>
      {children}
    </div>
  </div>
);

const IconButton: React.FC<{ onClick: () => void; children: React.ReactNode; title?: string }> = ({ onClick, children, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      background: 'transparent',
      border: 'none',
      color: 'var(--text-secondary)',
      cursor: 'pointer',
      padding: '2px 6px',
      borderRadius: '3px',
      fontSize: '0.8rem',
    }}
    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
  >
    {children}
  </button>
);

const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-default)',
      borderRadius: '3px',
      color: 'var(--text-primary)',
      padding: '6px 8px',
      fontSize: '0.8rem',
      width: '100%',
      outline: 'none',
      ...props.style,
    }}
    onFocus={e => {
      e.currentTarget.style.borderColor = 'var(--accent-primary)';
      props.onFocus?.(e);
    }}
    onBlur={e => {
      e.currentTarget.style.borderColor = 'var(--border-default)';
      props.onBlur?.(e);
    }}
  />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    style={{
      background: 'var(--bg-primary)',
      border: '1px solid var(--border-default)',
      borderRadius: '3px',
      color: 'var(--text-primary)',
      padding: '5px 8px',
      fontSize: '0.8rem',
      cursor: 'pointer',
      outline: 'none',
      width: '100%',
      ...props.style,
    }}
  />
);

const SYSTEM_PROMPT = `You are a GLSL compute shader expert. You generate GPU kernel code for an image compositor.

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

type GlslManifest = {
  inputs: Array<{ name: string; label: string; ty: string }>;
  outputs: Array<{ name: string; label: string; ty: string }>;
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

const generateGlslKernel = async (prompt: string, apiKey: string): Promise<GlslManifest> => {
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
      system: SYSTEM_PROMPT,
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

export const ScriptNodeEditor: React.FC<{ nodeId: string; typeId: string }> = ({ nodeId, typeId }) => {
  const compileScriptNode = useGraphStore(s => s.compileScriptNode);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const nodeParams = useGraphStore(s => s.nodes.get(nodeId)?.params);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const storedKey = localStorage.getItem('compositor_anthropic_api_key');
    if (storedKey) setApiKey(storedKey);
  }, []);
  
  const [state, setState] = useState<ScriptEditorState>(() => {
    const savedManifest = nodeParams?.['__script_manifest'];
    if (savedManifest && 'String' in (savedManifest as Record<string, unknown>)) {
      try {
        const manifest = JSON.parse((savedManifest as { String: string }).String);
        return {
          inputs: (manifest.inputs ?? []).map((p: { name: string; label: string; ty: string }, i: number) => ({
            id: `in_${i}`, name: p.name, label: p.label, ty: p.ty,
          })),
          outputs: (manifest.outputs ?? []).map((p: { name: string; label: string; ty: string }, i: number) => ({
            id: `out_${i}`, name: p.name, label: p.label, ty: p.ty,
          })),
          params: (manifest.params ?? []).map((p: { key: string; label: string; type: string; default: number | boolean; min?: number; max?: number; step?: number }, i: number) => ({
            id: `p_${i}`, key: p.key, label: p.label, ty: p.type,
            default: p.default, min: p.min, max: p.max, step: p.step,
          })),
          kernel: manifest.kernel ?? 'return color;',
          compileStatus: 'success' as const,
          compileError: null,
        };
      } catch { /* fall through */ }
    }

    const spec = nodeSpecs.find(s => s.id === typeId);
    if (spec) {
        return {
            inputs: spec.inputs.map((p, i) => ({ id: `in_${i}`, name: p.name, label: p.label, ty: p.ty })),
            outputs: spec.outputs.map((p, i) => ({ id: `out_${i}`, name: p.name, label: p.label, ty: p.ty })),
            params: spec.params.map((p, i) => {
                let def: number | boolean = 0;
                if ('Float' in p.default) def = p.default.Float;
                else if ('Int' in p.default) def = p.default.Int;
                else if ('Bool' in p.default) def = p.default.Bool;

                return {
                    id: `p_${i}`,
                    key: p.key,
                    label: p.label,
                    ty: p.ty,
                    default: def,
                    min: p.min,
                    max: p.max,
                    step: p.step
                };
            }),
            kernel: 'return color;',
            compileStatus: 'idle',
            compileError: null
        };
    }
    return DEFAULT_STATE;
  });

  const handleCompile = async () => {
    setState(s => ({ ...s, compileStatus: 'compiling', compileError: null }));
    
    try {
      const manifest = {
        id: typeId,
        display_name: "GPU Script",
        category: "GPU",
        description: "Custom GPU shader node",
        inputs: state.inputs,
        outputs: state.outputs,
        params: state.params.map(p => ({
            key: p.key,
            label: p.label,
            type: p.ty,
            default: p.ty === 'Bool' ? Boolean(p.default) : Number(p.default),
            min: p.min,
            max: p.max,
            step: p.step,
            ui: p.ty === 'Bool' ? 'Checkbox' : p.ty === 'Int' ? 'NumberInput' : 'Slider',
        })),
        kernel: state.kernel
      };

      const manifestJson = JSON.stringify(manifest);
      await compileScriptNode(nodeId, manifestJson);
      const nodes = useGraphStore.getState().nodes;
      const node = nodes.get(nodeId);
      if (node) {
        const updated = new Map(nodes);
        updated.set(nodeId, {
          ...node,
          params: { ...node.params, __script_manifest: { String: manifestJson } },
        });
        useGraphStore.setState({ nodes: updated });
      }
      setState(s => ({ ...s, compileStatus: 'success' }));
    } catch (e) {
      setState(s => ({ 
        ...s, 
        compileStatus: 'error', 
        compileError: e instanceof Error ? e.message : String(e) 
      }));
    }
  };

  const handleGenerate = async () => {
    if (!apiKey || aiGenerating) return;
    setAiGenerating(true);
    setAiError(null);

    try {
      const manifest = await generateGlslKernel(aiPrompt, apiKey);
      setState(s => ({
        ...s,
        inputs: manifest.inputs.map((input, i) => ({
          id: `in_${i}_${crypto.randomUUID()}`,
          name: input.name,
          label: input.label,
          ty: input.ty,
        })),
        outputs: manifest.outputs.map((output, i) => ({
          id: `out_${i}_${crypto.randomUUID()}`,
          name: output.name,
          label: output.label,
          ty: output.ty,
        })),
        params: manifest.params.map((param, i) => ({
          id: `p_${i}_${crypto.randomUUID()}`,
          key: param.key,
          label: param.label,
          ty: param.type,
          default: param.default,
          min: param.min,
          max: param.max,
          step: param.step,
        })),
        kernel: manifest.kernel,
        compileStatus: 'idle',
        compileError: null,
      }));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiGenerating(false);
    }
  };

  return (
    <div className="panel" style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>GPU Script</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {state.compileStatus === 'success' && <span style={{ color: 'var(--accent-primary)', fontSize: '0.7rem', fontWeight: 600 }}>Compiled</span>}
            {state.compileStatus === 'error' && <span style={{ color: 'var(--status-error-bright)', fontSize: '0.7rem', fontWeight: 600 }}>Error</span>}
            {state.compileStatus === 'compiling' && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Compiling...</span>}
        </div>
      </div>

      <div style={{ padding: '0 16px 32px 16px' }}>
        <SectionHeader 
            action={
                <IconButton onClick={() => setState(s => ({ ...s, inputs: [...s.inputs, { id: crypto.randomUUID(), name: 'input', label: 'Input', ty: 'Image' }] }))} title="Add Input">
                    + Add
                </IconButton>
            }
        >
            Inputs
        </SectionHeader>
        
        {state.inputs.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>No inputs defined.</div>}

        {state.inputs.map((input, idx) => (
          <PortCard key={input.id} onRemove={() => {
            const newInputs = state.inputs.filter((_, i) => i !== idx);
            setState(s => ({ ...s, inputs: newInputs }));
          }}>
            <Row>
                <InputGroup>
                    <Label title="Variable name used in GLSL (e.g. u_myInput)">Variable Name</Label>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '8px', userSelect: 'none' }}>u_</div>
                        <TextInput 
                            value={input.name} 
                            onChange={e => {
                                const newInputs = [...state.inputs];
                                newInputs[idx].name = e.target.value;
                                setState(s => ({ ...s, inputs: newInputs }));
                            }}
                            placeholder="name"
                            style={{ border: 'none', paddingLeft: '2px' }}
                        />
                    </div>
                </InputGroup>
                <InputGroup>
                    <Label title="Label displayed on the node">Label</Label>
                    <TextInput 
                        value={input.label} 
                        onChange={e => {
                            const newInputs = [...state.inputs];
                            newInputs[idx].label = e.target.value;
                            setState(s => ({ ...s, inputs: newInputs }));
                        }}
                        placeholder="Label"
                    />
                </InputGroup>
                <InputGroup>
                    <Label>Type</Label>
                    <Select
                        value={input.ty}
                        onChange={e => {
                            const newInputs = [...state.inputs];
                            newInputs[idx].ty = e.target.value;
                            setState(s => ({ ...s, inputs: newInputs }));
                        }}
                    >
                        <option value="Image">Image</option>
                        <option value="Mask">Mask</option>
                        <option value="Float">Float</option>
                        <option value="Int">Int</option>
                    </Select>
                </InputGroup>
            </Row>
          </PortCard>
        ))}

        <SectionHeader
            action={
                <IconButton onClick={() => setState(s => ({ ...s, outputs: [...s.outputs, { id: crypto.randomUUID(), name: 'output', label: 'Output', ty: 'Image' }] }))} title="Add Output">
                    + Add
                </IconButton>
            }
        >
            Outputs
        </SectionHeader>

        {state.outputs.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>No outputs defined.</div>}

        {state.outputs.map((output, idx) => (
          <PortCard key={output.id} onRemove={() => {
            const newOutputs = state.outputs.filter((_, i) => i !== idx);
            setState(s => ({ ...s, outputs: newOutputs }));
          }}>
            <Row>
                <InputGroup>
                    <Label title="Internal name (unused for outputs currently but good for metadata)">Name</Label>
                    <TextInput 
                        value={output.name} 
                        onChange={e => {
                            const newOutputs = [...state.outputs];
                            newOutputs[idx].name = e.target.value;
                            setState(s => ({ ...s, outputs: newOutputs }));
                        }}
                        placeholder="name"
                    />
                </InputGroup>
                <InputGroup>
                    <Label title="Label displayed on the node">Label</Label>
                    <TextInput 
                        value={output.label} 
                        onChange={e => {
                            const newOutputs = [...state.outputs];
                            newOutputs[idx].label = e.target.value;
                            setState(s => ({ ...s, outputs: newOutputs }));
                        }}
                        placeholder="Label"
                    />
                </InputGroup>
                <InputGroup>
                    <Label>Type</Label>
                    <Select
                        value={output.ty}
                        onChange={e => {
                            const newOutputs = [...state.outputs];
                            newOutputs[idx].ty = e.target.value;
                            setState(s => ({ ...s, outputs: newOutputs }));
                        }}
                    >
                        <option value="Image">Image</option>
                        <option value="Mask">Mask</option>
                        <option value="Float">Float</option>
                        <option value="Int">Int</option>
                    </Select>
                </InputGroup>
            </Row>
          </PortCard>
        ))}

        <SectionHeader
            action={
                <IconButton onClick={() => setState(s => ({ ...s, params: [...s.params, { id: crypto.randomUUID(), key: 'param', label: 'Param', ty: 'Float', default: 0, min: 0, max: 1 }] }))} title="Add Parameter">
                    + Add
                </IconButton>
            }
        >
            Parameters
        </SectionHeader>

        {state.params.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>No parameters defined.</div>}

        {state.params.map((param, idx) => (
          <PortCard key={param.id} onRemove={() => {
            const newParams = state.params.filter((_, i) => i !== idx);
            setState(s => ({ ...s, params: newParams }));
          }}>
            <Row style={{ marginBottom: '8px' }}>
                <InputGroup>
                    <Label title="Variable name used in GLSL (e.g. param)">Key</Label>
                    <TextInput 
                        value={param.key} 
                        onChange={e => {
                            const newParams = [...state.params];
                            newParams[idx].key = e.target.value;
                            setState(s => ({ ...s, params: newParams }));
                        }}
                        placeholder="Key"
                    />
                </InputGroup>
                <InputGroup>
                    <Label title="Label displayed in Inspector">Label</Label>
                    <TextInput 
                        value={param.label} 
                        onChange={e => {
                            const newParams = [...state.params];
                            newParams[idx].label = e.target.value;
                            setState(s => ({ ...s, params: newParams }));
                        }}
                        placeholder="Label"
                    />
                </InputGroup>
                <InputGroup>
                    <Label>Type</Label>
                    <Select
                        value={param.ty}
                        onChange={e => {
                            const newParams = [...state.params];
                            newParams[idx].ty = e.target.value;
                            if (e.target.value === 'Bool') newParams[idx].default = false;
                            else newParams[idx].default = 0;
                            setState(s => ({ ...s, params: newParams }));
                        }}
                    >
                        <option value="Float">Float</option>
                        <option value="Int">Int</option>
                        <option value="Bool">Bool</option>
                    </Select>
                </InputGroup>
            </Row>
            
            <div style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
                <Label>Constraints & Default</Label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {param.ty === 'Bool' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            <input 
                                id={`cb-${param.id}`}
                                type="checkbox" 
                                checked={Boolean(param.default)}
                                onChange={e => {
                                    const newParams = [...state.params];
                                    newParams[idx].default = e.target.checked;
                                    setState(s => ({ ...s, params: newParams }));
                                }}
                            />
                            <label htmlFor={`cb-${param.id}`} style={{ cursor: 'pointer' }}>Default Value</label>
                        </div>
                    ) : (
                        <>
                            <div style={{ flex: 1 }}>
                                <TextInput 
                                    type="number" 
                                    value={String(param.default)}
                                    onChange={e => {
                                        const newParams = [...state.params];
                                        newParams[idx].default = parseFloat(e.target.value);
                                        setState(s => ({ ...s, params: newParams }));
                                    }}
                                    placeholder="Default"
                                    title="Default Value"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <TextInput 
                                    type="number" 
                                    value={String(param.min ?? '')}
                                    onChange={e => {
                                        const newParams = [...state.params];
                                        newParams[idx].min = e.target.value ? parseFloat(e.target.value) : undefined;
                                        setState(s => ({ ...s, params: newParams }));
                                    }}
                                    placeholder="Min"
                                    title="Minimum Value"
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <TextInput 
                                    type="number" 
                                    value={String(param.max ?? '')}
                                    onChange={e => {
                                        const newParams = [...state.params];
                                        newParams[idx].max = e.target.value ? parseFloat(e.target.value) : undefined;
                                        setState(s => ({ ...s, params: newParams }));
                                    }}
                                    placeholder="Max"
                                    title="Maximum Value"
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
          </PortCard>
        ))}

        <SectionHeader>GLSL Kernel (body of process)</SectionHeader>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'monospace', background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
          <div><span style={{color: 'var(--accent-primary)'}}>u_input</span> : readonly image2D</div>
          <div><span style={{color: 'var(--accent-primary)'}}>imageLoad(img, pixel)</span> : vec4</div>
          <div><span style={{color: 'var(--accent-primary)'}}>imageSize(img)</span> : ivec2</div>
        </div>
        
        <textarea
          value={state.kernel}
          onChange={e => setState(s => ({ ...s, kernel: e.target.value }))}
          style={{
            width: '100%',
            minHeight: '250px',
            background: 'var(--code-bg)',
            color: 'var(--code-text)',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '0.85rem',
            border: '1px solid var(--border-default)',
            borderRadius: '4px',
            padding: '12px',
            resize: 'vertical',
            outline: 'none',
            lineHeight: 1.5,
          }}
          spellCheck={false}
        />

        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            onClick={handleCompile}
            disabled={state.compileStatus === 'compiling'}
            style={{
              background: 'var(--accent-primary)',
              color: 'var(--text-inverse)',
              border: 'none',
              borderRadius: '4px',
              padding: '10px 16px',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: state.compileStatus === 'compiling' ? 'not-allowed' : 'pointer',
              opacity: state.compileStatus === 'compiling' ? 0.7 : 1,
              transition: 'background 0.2s',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            {state.compileStatus === 'compiling' ? 'Compiling...' : 'Compile Shader'}
          </button>
          
          {state.compileError && (
            <div style={{ 
                color: 'var(--status-error-bright)',
                fontSize: '0.85rem', 
                whiteSpace: 'pre-wrap', 
                background: 'var(--status-error-subtle-bg)',
                border: '1px solid var(--status-error-subtle-border)',
                padding: '12px', 
                borderRadius: '4px',
                fontFamily: 'monospace'
            }}>
              <strong>Error:</strong> {state.compileError}
            </div>
          )}
        </div>

        <div style={{ marginTop: '32px', borderTop: '1px solid var(--border-default)', paddingTop: '24px' }}>
          <SectionHeader action={
            <IconButton onClick={() => setApiKeyVisible(v => !v)} title={apiKeyVisible ? 'Hide API key' : 'Show API key'}>
              {apiKeyVisible ? 'Hide' : 'Show'}
            </IconButton>
          }>
            AI Generation
          </SectionHeader>
          
          {apiKeyVisible && (
            <div style={{ marginBottom: '12px' }}>
                <Label>Anthropic API Key</Label>
                <TextInput
                type="password"
                value={apiKey}
                onChange={e => {
                    const nextKey = e.target.value;
                    setApiKey(nextKey);
                    if (nextKey) localStorage.setItem('compositor_anthropic_api_key', nextKey);
                    else localStorage.removeItem('compositor_anthropic_api_key');
                }}
                placeholder="sk-ant-..."
                />
            </div>
          )}
          
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            {!apiKey && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
                    Set your Anthropic API key to enable AI generation
                </div>
            )}
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Describe the effect you want (e.g. 'VHS glitch effect with chromatic aberration')..."
              style={{
                width: '100%',
                minHeight: '80px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: '4px',
                padding: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                resize: 'vertical',
                outline: 'none'
              }}
            />
            <button
              type="button"
              disabled={!apiKey || aiGenerating}
              title={!apiKey ? 'Add API key to enable' : undefined}
              onClick={handleGenerate}
              style={{
                background: aiGenerating || !apiKey ? 'var(--bg-tertiary)' : 'var(--bg-surface)',
                color: aiGenerating || !apiKey ? 'var(--text-muted)' : 'var(--accent-primary)',
                border: '1px solid var(--accent-primary)',
                borderRadius: '4px',
                padding: '8px 12px',
                cursor: aiGenerating || !apiKey ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                opacity: aiGenerating || !apiKey ? 0.5 : 1
              }}
            >
              {aiGenerating ? 'Generating...' : '✨ Generate GLSL'}
            </button>
          </div>
          {aiError && (
            <div style={{ marginTop: '8px', color: 'var(--status-error-bright)', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
              {aiError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
