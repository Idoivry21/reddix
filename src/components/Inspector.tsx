import { buildBlockCommand, getBlockSpec } from '../shared/commandBuilders';
import { accentForBlock, iconForBlock } from '../blockVisuals';
import { Icon } from '../icons';
import type { BuiltCommand, FieldSpec } from '../shared/types';
import type { WorkbenchNode } from '../flowTypes';

function CubeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M12 12v9M12 12 4 7.5M12 12l8-4.5" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

interface InspectorProps {
  node: WorkbenchNode | undefined;
  onSettingChange: (key: string, value: unknown) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  readOnly?: boolean;
}

export function Inspector({ node, onSettingChange, onDelete, onDuplicate, readOnly = false }: InspectorProps) {
  if (!node) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-scroll">
          <div className="empty-inspect">
            <div className="ei-icon">
              <CubeIcon />
            </div>
            <div className="ei-title">Pick a block to tune it</div>
            <div className="ei-sub">
              Select a block on the canvas to configure its settings and preview the command it runs.
            </div>
            <div className="ei-hint">
              Tip: press <kbd>⌘K</kbd> to search blocks
            </div>
          </div>
        </div>
      </aside>
    );
  }

  const spec = getBlockSpec(node.blockType);
  const accent = accentForBlock(spec.provider, spec.category);
  const fields = spec.fields;
  let command: BuiltCommand | null = null;
  if (spec.command) {
    try {
      command = buildBlockCommand({ blockId: node.id, blockType: node.blockType, settings: node.settings });
    } catch {
      command = null;
    }
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-head">
        <div className={`ihicon cat-${accent}`}>
          <Icon name={iconForBlock(node.blockType)} size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="ihtitle">{spec.label}</div>
          <div className="ihsub">
            {accent === 'x' ? 'X' : accent}
            {spec.command ? ` · ${spec.command.executable}-cli` : ''}
          </div>
        </div>
      </div>
      <div className="inspector-scroll">
        {fields.length === 0 ? (
          <div className="field-hint" style={{ marginTop: 16 }}>
            This block has no settings — it just forwards what it receives.
          </div>
        ) : null}
        {fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={node.settings[field.key]}
            onChange={(value) => onSettingChange(field.key, value)}
            disabled={readOnly}
          />
        ))}

        <CommandPreview command={command} executable={spec.command?.executable} />

        {!readOnly ? (
          <div className="field-actions">
            <button
              type="button"
              className="btn btn-sm"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
              onClick={onDuplicate}
            >
              <DuplicateIcon /> Duplicate block
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
              <TrashIcon /> Delete block
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

interface CommandPreviewProps {
  command: BuiltCommand | null;
  executable?: 'rdt' | 'twitter';
}

function CommandPreview({ command, executable }: CommandPreviewProps) {
  if (!command) {
    return (
      <div className="cmd-preview">
        <div className="cmd-label">execution</div>
        <code>
          <span style={{ color: 'var(--term-dim)' }}>{'// in-process text op — no CLI call'}</span>
        </code>
      </div>
    );
  }
  const tokens = [command.executable, ...command.displayArgv];
  return (
    <div className="cmd-preview">
      <div className="cmd-label">{executable}-cli · command preview</div>
      <code>
        <span style={{ color: 'var(--term-dim)' }}>$ </span>
        {tokens.map((token, index) => {
          const className = index === 0 ? 'bin' : token.startsWith('--') ? 'flag' : 'val';
          return (
            <span key={`${index}-${token}`}>
              <span className={className}>{token}</span>
              {index < tokens.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </code>
      <p className="cmd-note">Credentials are injected at runtime and redacted from logs.</p>
    </div>
  );
}

interface FieldProps {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

function Field({ field, value, onChange, disabled = false }: FieldProps) {
  const fieldId = `field-${field.key}`;
  return (
    <div className="field">
      <label className="field-label" id={`${fieldId}-label`} htmlFor={fieldId}>
        {field.label}
      </label>
      {field.type === 'select' ? (
        <select
          id={fieldId}
          className="select"
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <div className="seg" role="group" aria-labelledby={`${fieldId}-label`}>
          <button
            type="button"
            className={value ? '' : 'on'}
            aria-pressed={!value}
            disabled={disabled}
            onClick={() => onChange(false)}
          >
            no
          </button>
          <button
            type="button"
            className={value ? 'on' : ''}
            aria-pressed={Boolean(value)}
            disabled={disabled}
            onClick={() => onChange(true)}
          >
            yes
          </button>
          <input id={fieldId} type="checkbox" checked={Boolean(value)} readOnly hidden aria-hidden="true" />
        </div>
      ) : field.type === 'number' ? (
        <input
          id={fieldId}
          className="input mono"
          type="number"
          min={field.min}
          max={field.max}
          value={value === undefined || value === null || value === '' ? '' : Number(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      ) : (
        <input
          id={fieldId}
          className={`input ${field.type === 'path' ? 'mono' : ''}`}
          type="text"
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
