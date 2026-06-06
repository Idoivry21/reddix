import { useState } from 'react';
import { X } from 'lucide-react';
import { buildBlockCommand, getBlockSpec, previewCommand } from '../shared/commandBuilders';
import type { FieldSpec } from '../shared/types';
import type { WorkbenchNode } from '../flowTypes';
import { Tabs, tabId, tabPanelId } from './Tabs';

const INSPECTOR_TABS = ['Settings', 'Validation', 'Notes'] as const;

interface InspectorProps {
  node: WorkbenchNode | undefined;
  validationMessage: string;
  onSettingChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}

export function Inspector({ node, validationMessage, onSettingChange, readOnly = false }: InspectorProps) {
  const [activeTab, setActiveTab] = useState<(typeof INSPECTOR_TABS)[number]>('Settings');
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
      <div className="inspector-tabs">
        <Tabs
          tabs={INSPECTOR_TABS}
          active={activeTab}
          onChange={(tab) => setActiveTab(tab as (typeof INSPECTOR_TABS)[number])}
          label="Inspector sections"
          idPrefix="inspector"
        />
      </div>
      <div
        role="tabpanel"
        id={tabPanelId('inspector', activeTab)}
        aria-labelledby={tabId('inspector', activeTab)}
        tabIndex={0}
      >
        {activeTab === 'Settings' ? (
          <div className="field-grid">
            {spec.fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={settings[field.key]}
                onChange={(value) => onSettingChange(field.key, value)}
                disabled={readOnly}
              />
            ))}
          </div>
        ) : activeTab === 'Validation' ? (
          <div className="validation-box">
            <strong>Validation</strong>
            <span>{validationMessage}</span>
          </div>
        ) : (
          <p className="inspector-notes">Notes are local to this session and not yet persisted.</p>
        )}
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
  disabled?: boolean;
}

function Field({ field, value, onChange, disabled = false }: FieldProps) {
  const fieldId = `field-${field.key}`;
  return (
    <div className="field-row">
      <label htmlFor={fieldId}>{field.label}</label>
      {field.type === 'select' ? (
        <select
          id={fieldId}
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
        <input
          id={fieldId}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === 'number' ? (
        <input
          id={fieldId}
          type="number"
          value={value === undefined || value === null ? '' : Number(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      ) : (
        <input
          id={fieldId}
          type="text"
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
