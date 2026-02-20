import React from 'react';

/* ───────────────────────────────────────────────────────────────
 *  Shared UI primitives for all node components.
 *
 *  Every interactive element inside a node body should use these
 *  so that styling, spacing and interaction behaviour are uniform.
 * ─────────────────────────────────────────────────────────────── */

// ── Section: visual grouping with an optional label ─────────────

interface NodeSectionProps {
  label?: string;
  children: React.ReactNode;
  /** Extra top-margin when separating groups (default false). */
  spaced?: boolean;
}

export const NodeSection: React.FC<NodeSectionProps> = ({ label, children, spaced }) => (
  <div className={`node-section${spaced ? ' node-section--spaced' : ''}`}>
    {label && <div className="node-section__label">{label}</div>}
    <div className="node-section__body">{children}</div>
  </div>
);

// ── Node Canvas (Shared Preview) ────────────────────────────────
export const NodeCanvas: React.FC<{
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasResult: boolean;
  emptyText?: string;
  height?: number;
}> = ({ canvasRef, hasResult, emptyText = 'No Input', height = 80 }) => (
  <div className="node-preview" style={{ height }}>
    {hasResult ? (
      <canvas ref={canvasRef} className="node-canvas" />
    ) : (
      <span className="node-preview__empty">{emptyText}</span>
    )}
  </div>
);

// ── Dropdown (select) ───────────────────────────────────────────

interface NodeDropdownProps {
  label: string;
  value: number;
  options: string[];
  onChange: (value: number) => void;
  disabled?: boolean;
}

export const NodeDropdown: React.FC<NodeDropdownProps> = ({
  label, value, options, onChange, disabled,
}) => (
  <label
    className="node-dropdown nopan nodrag"
    onPointerDown={(e) => e.stopPropagation()}
  >
    <span className="node-dropdown__label" style={{ opacity: disabled ? 0.5 : 1 }}>{label}</span>
    <select
      className="node-dropdown__select"
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      disabled={disabled}
    >
      {options.map((opt, idx) => (
        <option key={opt} value={idx}>{opt}</option>
      ))}
    </select>
  </label>
);

// ── Native Select (String values) ───────────────────────────────

interface NodeSelectProps {
  label?: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const NodeSelect: React.FC<NodeSelectProps> = ({
  label, value, options, onChange, disabled,
}) => (
  <label
    className="node-dropdown nopan nodrag"
    onPointerDown={(e) => e.stopPropagation()}
  >
    {label && <span className="node-dropdown__label" style={{ opacity: disabled ? 0.5 : 1 }}>{label}</span>}
    <select
      className="node-dropdown__select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </label>
);

// ── Text Input ──────────────────────────────────────────────────

interface NodeTextInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const NodeTextInput: React.FC<NodeTextInputProps> = ({
  label, value, onChange, placeholder, disabled,
}) => (
  <div className="node-text-input nopan nodrag" onPointerDown={(e) => e.stopPropagation()}>
    {label && <div className="node-text-input__label">{label}</div>}
    <input
      type="text"
      className="node-text-input__field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  </div>
);

// ── Checkbox ────────────────────────────────────────────────────

interface NodeCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const NodeCheckbox: React.FC<NodeCheckboxProps> = ({ label, checked, onChange, disabled }) => (
  <label
    className="node-checkbox nopan nodrag"
    onPointerDown={(e) => e.stopPropagation()}
    style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
  >
    <span className="node-checkbox__label">{label}</span>
    <input
      type="checkbox"
      className="node-checkbox__input"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
    />
  </label>
);

// ── Number input ────────────────────────────────────────────────

interface NodeNumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onChangeCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export const NodeNumberInput: React.FC<NodeNumberInputProps> = ({
  label, value, onChange, onChangeCommit, min, max, step, disabled,
}) => {
  const [localValue, setLocalValue] = React.useState(String(value));
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    if (!editing) setLocalValue(String(value));
  }, [value, editing]);

  const commit = React.useCallback((raw: string) => {
    const v = Number(raw);
    if (!Number.isNaN(v)) {
      onChange(v);
      onChangeCommit?.(v);
    }
  }, [onChange, onChangeCommit]);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  }, []);

  const handleFocus = React.useCallback(() => setEditing(true), []);

  const handleBlur = React.useCallback(() => {
    setEditing(false);
    commit(localValue);
  }, [localValue, commit]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commit(localValue);
      (e.target as HTMLInputElement).blur();
    }
  }, [localValue, commit]);

  return (
    <div className="node-number nopan nodrag" onPointerDown={(e) => e.stopPropagation()}>
      <div className="node-number__label">{label}</div>
      <input
        type="number"
        className="node-number__input"
        value={localValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
    </div>
  );
};

// ── Button Group ────────────────────────────────────────────────

export const NodeButtonGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="node-btn-group">
    {children}
  </div>
);

// ── Primary action button (accent colour) ───────────────────────

interface NodeButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'dashed';
  fullWidth?: boolean;
  icon?: boolean;
  title?: string;
}

export const NodeButton: React.FC<NodeButtonProps> = ({
  children, onClick, disabled, variant = 'primary', fullWidth, icon, title,
}) => (
  <button
    type="button"
    className={`node-btn node-btn--${variant} ${fullWidth ? 'node-btn--full' : ''} ${icon ? 'node-btn--icon' : ''} nopan nodrag`}
    onClick={onClick}
    onPointerDown={(e) => e.stopPropagation()}
    disabled={disabled}
    title={title}
  >
    {children}
  </button>
);

// ── Disabled Overlay ────────────────────────────────────────────

export const NodeDisabledOverlay: React.FC<{
  disabled: boolean;
  children: React.ReactNode;
}> = ({ disabled, children }) => (
  <div className={`node-disabled-overlay ${disabled ? 'node-disabled-overlay--disabled' : ''}`}>
    {children}
  </div>
);

// ── Add Port Form (Shared) ──────────────────────────────────────

interface AddPortFormProps {
  onAdd: (name: string, type: string) => void;
  onCancel: () => void;
  availableTypes: string[];
}

export const AddPortForm: React.FC<AddPortFormProps> = ({ onAdd, onCancel, availableTypes }) => {
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState(availableTypes[0]);

  const handleSubmit = () => {
    if (name.trim()) {
      onAdd(name.trim(), type);
      setName('');
    }
  };

  const typeOptions = React.useMemo(() => 
    availableTypes.map(t => ({ label: t, value: t })), 
  [availableTypes]);

  return (
    <NodeSection spaced>
      <NodeTextInput
        label="Port Name"
        value={name}
        onChange={setName}
        placeholder="Name..."
      />
      <NodeSelect
        label="Type"
        value={type}
        options={typeOptions}
        onChange={setType}
      />
      <NodeButtonGroup>
        <NodeButton onClick={handleSubmit} fullWidth disabled={!name.trim()}>
          Add
        </NodeButton>
        <NodeButton onClick={onCancel} variant="secondary" fullWidth>
          Cancel
        </NodeButton>
      </NodeButtonGroup>
    </NodeSection>
  );
};

// ── Badge / pill ────────────────────────────────────────────────

interface NodeBadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'danger';
}

export const NodeBadge: React.FC<NodeBadgeProps> = ({ children, variant = 'default' }) => (
  <div className={`node-badge node-badge--${variant}`}>{children}</div>
);

// ── Progress bar ────────────────────────────────────────────────

interface NodeProgressProps {
  percent: number;
  label?: string;
}

export const NodeProgress: React.FC<NodeProgressProps> = ({ percent, label }) => (
  <div className="node-progress">
    <div className="node-progress__track">
      <div className="node-progress__fill" style={{ width: `${percent}%` }} />
    </div>
    {label && <div className="node-progress__label">{label}</div>}
  </div>
);

// ── Status message ──────────────────────────────────────────────

interface NodeStatusProps {
  children: React.ReactNode;
  variant?: 'info' | 'success' | 'danger';
}

export const NodeStatus: React.FC<NodeStatusProps> = ({ children, variant = 'info' }) => (
  <div className={`node-status node-status--${variant}`}>{children}</div>
);

// ── Info row (label : value) ────────────────────────────────────

interface NodeInfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

export const NodeInfoRow: React.FC<NodeInfoRowProps> = ({ label, value, mono }) => (
  <div className="node-info-row">
    <span className="node-info-row__label">{label}</span>
    <span className={`node-info-row__value${mono ? ' node-info-row__value--mono' : ''}`}>{value}</span>
  </div>
);

// ── File drop zone ──────────────────────────────────────────────

interface NodeDropZoneProps {
  children: React.ReactNode;
  onClick?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  hasContent?: boolean;
}

export const NodeDropZone: React.FC<NodeDropZoneProps> = ({
  children, onClick, onDrop, hasContent,
}) => (
  <button
    type="button"
    className={`node-dropzone nodrag${hasContent ? ' node-dropzone--filled' : ''}`}
    onClick={onClick}
    onDrop={(e) => { e.preventDefault(); onDrop?.(e); }}
    onDragOver={(e) => e.preventDefault()}
    onPointerDown={(e) => { if (e.button === 0) e.stopPropagation(); }}
  >
    {children}
  </button>
);
