import { X } from 'lucide-react';
import { buildBlockCommand, getBlockSpec, previewCommand } from '../shared/commandBuilders';
import type { FieldSpec } from '../shared/types';
import type { WorkbenchNode } from '../flowTypes';

interface InspectorProps {
  node: WorkbenchNode | undefined;
  validationMessage: string;
  onSettingChange: (key: string, value: unknown) => void;
}

export function Inspector({ node, validationMessage, onSettingChange }: InspectorProps) {
  if (!node) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector-empty">
          <h2>Inspector</h2>
          <p>Select a block on the canvas to edit its settings.</p>
        </div>
      </aside>
    );
  }

  const blockType = node.data.blockType;
  const spec = getBlockSpec(blockType);
  const settings = node.data.settings;
  const command = spec.command
    ? previewCommand(buildBlockCommand({ blockId: node.id, blockType, settings }))
    : 'Local block';

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-header">
        <div className={`inspector-provider provider-${spec.provider}`}>
          {spec.provider === 'reddit' ? 'r/' : spec.provider === 'twitter' ? 'X' : '·'}
        </div>
        <h2>{spec.label}</h2>
        <button className="icon-button" aria-label="Close inspector" type="button">
          <X size={16} />
        </button>
      </div>
      <nav className="inspector-tabs">
        <button className="active" type="button">
          Settings
        </button>
        <button type="button">Validation</button>
        <button type="button">Notes</button>
      </nav>
      <div className="field-grid">
        {spec.fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={settings[field.key]}
            onChange={(value) => onSettingChange(field.key, value)}
          />
        ))}
      </div>
      <div className="validation-box">
        <strong>Validation</strong>
        <span>{validationMessage}</span>
      </div>
      <section className="command-preview">
        <h3>Command Preview</h3>
        <pre>{command}</pre>
        <p>Credentials are injected at runtime and redacted from logs.</p>
      </section>
    </aside>
  );
}

interface FieldProps {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}

function Field({ field, value, onChange }: FieldProps) {
  const fieldId = `field-${field.key}`;
  return (
    <div className="field-row">
      <label htmlFor={fieldId}>{field.label}</label>
      {field.type === 'select' ? (
        <select id={fieldId} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <input
          id={fieldId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === 'number' ? (
        <input
          id={fieldId}
          type="number"
          value={value === undefined || value === null ? '' : Number(value)}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
