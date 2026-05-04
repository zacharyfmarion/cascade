import React, { useEffect, useMemo, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import { useSettingsStore } from '../store/settingsStore';
import {
  buildGpuScriptManifest,
  isScalarScriptType,
} from '../ai/gpuScript';
import {
  createScriptEditorInitialState,
  makeId,
  sanitizeScalarPort,
  scalarDefault,
  uiHintForType,
  type ScriptDraftPort,
  type ScriptEditorState,
} from './scriptNodeEditorModel';
import { Button } from './ui/Button';
import { IconButton as UiIconButton } from './ui/IconButton';
import { Toggle } from './ui/Toggle';

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
    <UiIconButton
      size="sm"
      onClick={onRemove}
      title="Remove port"
      style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
      }}
    >
      x
    </UiIconButton>
    <div style={{ marginRight: '16px' }}>
      {children}
    </div>
  </div>
);

const IconButton: React.FC<{ onClick: () => void; children: React.ReactNode; title?: string }> = ({ onClick, children, title }) => (
  <UiIconButton size="sm" onClick={onClick} title={title}>
    {children}
  </UiIconButton>
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

const uniqueName = (base: string, ports: ScriptDraftPort[]): string => {
  const existing = new Set(ports.map(port => port.name));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
};

const numberValue = (value: number | boolean | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

export const ScriptNodeEditor: React.FC<{ nodeId: string; typeId: string }> = ({ nodeId, typeId }) => {
  const compileScriptNode = useGraphStore(s => s.compileScriptNode);
  const nodeSpecs = useGraphStore(s => s.nodeSpecs);
  const nodeParams = useGraphStore(s => s.nodes.get(nodeId)?.params);
  const openAiAssistant = useSettingsStore(s => s.openAiAssistant);
  const manifestJson = nodeParams?.__script_manifest && 'String' in nodeParams.__script_manifest
    ? nodeParams.__script_manifest.String
    : null;
  const spec = useMemo(() => nodeSpecs.find(s => s.id === typeId), [nodeSpecs, typeId]);

  const [state, setState] = useState<ScriptEditorState>(() => createScriptEditorInitialState(typeId, manifestJson, spec));

  useEffect(() => {
    setState(createScriptEditorInitialState(typeId, manifestJson, spec));
  }, [nodeId, typeId, manifestJson, spec]);

  const markDraft = (update: (draft: ScriptEditorState) => ScriptEditorState): void => {
    setState(current => ({
      ...update(current),
      compileStatus: current.compileStatus === 'compiling' ? 'compiling' : 'idle',
      compileError: null,
    }));
  };

  const updateInput = (idx: number, changes: Partial<ScriptDraftPort>) => {
    markDraft(current => {
      const inputs = current.inputs.map((input, i) => {
        if (i !== idx) return input;
        const next = sanitizeScalarPort({ ...input, ...changes });
        if (changes.ty && isScalarScriptType(changes.ty) && !isScalarScriptType(input.ty)) {
          next.default = scalarDefault(changes.ty);
          next.ui = uiHintForType(changes.ty);
          next.min = changes.ty === 'Bool' ? undefined : 0;
          next.max = changes.ty === 'Bool' ? undefined : 1;
          next.step = changes.ty === 'Int' ? 1 : changes.ty === 'Float' ? 0.01 : undefined;
        }
        return next;
      });
      return { ...current, inputs };
    });
  };

  const updateOutput = (idx: number, changes: Partial<ScriptDraftPort>) => {
    markDraft(current => ({
      ...current,
      outputs: current.outputs.map((output, i) => i === idx ? { ...output, ...changes } : output),
    }));
  };

  const handleCompile = async () => {
    setState(s => ({ ...s, compileStatus: 'compiling', compileError: null }));

    try {
      const manifest = buildGpuScriptManifest(
        typeId,
        state.inputs.map(({ id: _id, ...input }) => input),
        state.outputs.map(({ id: _id, ...output }) => output),
        [],
        state.kernel,
        state.supportsMask,
        state.pixelSpaceParams,
      );
      const nextManifestJson = JSON.stringify(manifest);
      await compileScriptNode(nodeId, nextManifestJson);
      setState(s => ({ ...s, compileStatus: 'success' }));
    } catch (e) {
      setState(s => ({
        ...s,
        compileStatus: 'error',
        compileError: e instanceof Error ? e.message : String(e)
      }));
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
          <Button
            size="sm"
            variant="secondary"
            onClick={openAiAssistant}
            style={{
              color: 'var(--accent-primary)',
              borderRadius: '999px',
              fontWeight: 600,
            }}
          >
            Edit With AI
          </Button>
        </div>
      </div>

      <div style={{ padding: '0 16px 32px 16px' }}>
        <SectionHeader
          action={
            <IconButton
              onClick={() => markDraft(s => ({
                ...s,
                inputs: [
                  ...s.inputs,
                  { id: makeId('in'), name: uniqueName('input', s.inputs), label: 'Input', ty: 'Image' },
                ],
              }))}
              title="Add Input Or Control"
            >
              + Add
            </IconButton>
          }
        >
          Inputs & Controls
        </SectionHeader>

        {state.inputs.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>No inputs or controls defined.</div>}

        {state.inputs.map((input, idx) => (
          <PortCard
            key={input.id}
            onRemove={() => markDraft(s => ({ ...s, inputs: s.inputs.filter((_, i) => i !== idx) }))}
          >
            <Row style={{ marginBottom: isScalarScriptType(input.ty) ? '8px' : undefined }}>
              <InputGroup>
                <Label title={isScalarScriptType(input.ty) ? 'Uniform name used directly in GLSL' : 'Image variable name used as u_name in GLSL'}>
                  {isScalarScriptType(input.ty) ? 'Name' : 'Variable Name'}
                </Label>
                {isScalarScriptType(input.ty) ? (
                  <TextInput
                    value={input.name}
                    onChange={e => updateInput(idx, { name: e.target.value })}
                    placeholder="amount"
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingLeft: '8px', userSelect: 'none' }}>u_</div>
                    <TextInput
                      value={input.name}
                      onChange={e => updateInput(idx, { name: e.target.value })}
                      placeholder="name"
                      style={{ border: 'none', paddingLeft: '2px' }}
                    />
                  </div>
                )}
              </InputGroup>
              <InputGroup>
                <Label title="Label displayed on the node">Label</Label>
                <TextInput
                  value={input.label}
                  onChange={e => updateInput(idx, { label: e.target.value })}
                  placeholder="Label"
                />
              </InputGroup>
              <InputGroup>
                <Label>Type</Label>
                <Select value={input.ty} onChange={e => updateInput(idx, { ty: e.target.value })}>
                  <option value="Image">Image</option>
                  <option value="Mask">Mask</option>
                  <option value="Float">Float</option>
                  <option value="Int">Int</option>
                  <option value="Bool">Bool</option>
                </Select>
              </InputGroup>
            </Row>

            {isScalarScriptType(input.ty) && (
              <div style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
                <Label>Control Default & Range</Label>
                {input.ty === 'Bool' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    <Toggle
                      id={`default-${input.id}`}
                      checked={Boolean(input.default)}
                      onChange={checked => updateInput(idx, { default: checked })}
                    />
                    <label htmlFor={`default-${input.id}`} style={{ cursor: 'pointer' }}>Default Value</label>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <TextInput
                      type="number"
                      value={numberValue(input.default)}
                      onChange={e => updateInput(idx, { default: e.target.value ? Number(e.target.value) : 0 })}
                      placeholder="Default"
                      title="Default Value"
                    />
                    <TextInput
                      type="number"
                      value={numberValue(input.min)}
                      onChange={e => updateInput(idx, { min: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Min"
                      title="Minimum Value"
                    />
                    <TextInput
                      type="number"
                      value={numberValue(input.max)}
                      onChange={e => updateInput(idx, { max: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Max"
                      title="Maximum Value"
                    />
                    <TextInput
                      type="number"
                      value={numberValue(input.step)}
                      onChange={e => updateInput(idx, { step: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Step"
                      title="Step Value"
                    />
                  </div>
                )}
              </div>
            )}
          </PortCard>
        ))}

        <SectionHeader
          action={
            <IconButton
              onClick={() => markDraft(s => ({
                ...s,
                outputs: [
                  ...s.outputs,
                  { id: makeId('out'), name: uniqueName('output', s.outputs), label: 'Output', ty: 'Image' },
                ],
              }))}
              title="Add Output"
            >
              + Add
            </IconButton>
          }
        >
          Outputs
        </SectionHeader>

        {state.outputs.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px' }}>No outputs defined.</div>}

        {state.outputs.map((output, idx) => (
          <PortCard
            key={output.id}
            onRemove={() => markDraft(s => ({ ...s, outputs: s.outputs.filter((_, i) => i !== idx) }))}
          >
            <Row>
              <InputGroup>
                <Label title="Internal output name">Name</Label>
                <TextInput
                  value={output.name}
                  onChange={e => updateOutput(idx, { name: e.target.value })}
                  placeholder="name"
                />
              </InputGroup>
              <InputGroup>
                <Label title="Label displayed on the node">Label</Label>
                <TextInput
                  value={output.label}
                  onChange={e => updateOutput(idx, { label: e.target.value })}
                  placeholder="Label"
                />
              </InputGroup>
              <InputGroup>
                <Label>Type</Label>
                <Select value={output.ty} onChange={e => updateOutput(idx, { ty: e.target.value })}>
                  <option value="Image">Image</option>
                  <option value="Mask">Mask</option>
                </Select>
              </InputGroup>
            </Row>
          </PortCard>
        ))}

        <SectionHeader>Node Options</SectionHeader>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8rem',
          cursor: 'pointer',
          marginBottom: '12px',
        }}>
          <label htmlFor="script-node-enable-mask-input" style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Enable mask input</label>
          <Toggle
            id="script-node-enable-mask-input"
            checked={state.supportsMask}
            onChange={(checked) => markDraft(s => ({ ...s, supportsMask: checked }))}
          />
        </div>

        <SectionHeader>GLSL Kernel (body of process)</SectionHeader>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontFamily: 'monospace', background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-default)' }}>
          <div><span style={{ color: 'var(--accent-primary)' }}>u_input</span> : primary readonly image2D</div>
          <div><span style={{ color: 'var(--accent-primary)' }}>u_name</span> : additional image or mask input</div>
          <div><span style={{ color: 'var(--accent-primary)' }}>amount</span> : scalar controls are uniforms by name</div>
          <div><span style={{ color: 'var(--accent-primary)' }}>imageLoad(img, pixel)</span> : vec4</div>
        </div>

        <textarea
          value={state.kernel}
          onChange={e => markDraft(s => ({ ...s, kernel: e.target.value }))}
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
          <Button
            size="lg"
            variant="primary"
            onClick={handleCompile}
            disabled={state.compileStatus === 'compiling'}
            style={{
              width: '100%',
            }}
          >
            {state.compileStatus === 'compiling' ? 'Compiling...' : 'Apply & Compile'}
          </Button>

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
      </div>
    </div>
  );
};
