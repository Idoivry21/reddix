import { buildBlockCommand, getBlockSpec } from '../shared/commandBuilders';
import { inputBindingMeta, inputBoundFieldKeys, readBindings } from '../shared/inputBindings';
import { normalizedFieldName, type FieldDescriptor } from '../shared/fieldSchema';
import { isBlank } from '../shared/values';
import { accentForBlock, iconForBlock } from '../blockVisuals';
import { Icon } from '../icons';
import type { BuiltCommand, FieldSpec } from '../shared/types';
import type { NodeIoPreview, WorkbenchNode } from '../flowTypes';
import type { RunNodeMode } from '../api';

/** Per-node binding skip policy stored under a non-field settings key. */
type BindPolicy = 'skip' | 'fail';

function bindPolicyOf(settings: Record<string, unknown>): BindPolicy {
  return settings.__bindPolicy === 'fail' ? 'fail' : 'skip';
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

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

interface InspectorProps {
  node: WorkbenchNode | undefined;
  onSettingChange: (key: string, value: unknown) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  /** Run just this node in isolation, in the given mode. */
  onRunNode?: (mode: RunNodeMode) => void;
  /** True when the node has at least one incoming edge (binding mapper applies). */
  hasUpstream?: boolean;
  /** True when an upstream node has cached output from the last full run. */
  hasCachedUpstream?: boolean;
  /** A run is in flight — disable run controls. */
  isRunning?: boolean;
  /** Latest per-node I/O for the last-run panel. */
  preview?: NodeIoPreview;
  /** Upstream output fields available as inputs to this node (for panels + binding picker). */
  inputFields?: FieldDescriptor[];
  /** This node's static output fields (design-time schema). */
  outputFields?: FieldDescriptor[];
  readOnly?: boolean;
}

export function Inspector({
  node,
  onSettingChange,
  onDelete,
  onDuplicate,
  onRunNode,
  hasUpstream = false,
  hasCachedUpstream = false,
  isRunning = false,
  preview,
  inputFields = [],
  outputFields = [],
  readOnly = false
}: InspectorProps) {
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
  const boundKeys = inputBoundFieldKeys(node.blockType);
  const bindingMeta = inputBindingMeta(node.blockType);
  const bindPolicy = bindPolicyOf(node.settings);
  // Only CLI-backed blocks resolve field bindings at run time, so the mapping
  // picker is offered for those alone (a transform consumes the whole stream).
  const canMap = Boolean(spec.executable);
  const userBindings = readBindings(node.settings);
  const upstreamLabel = (key: string): string => inputFields.find((field) => field.key === key)?.label ?? key;
  const fieldLabel = (key: string): string => spec.fields.find((field) => field.key === key)?.label ?? key;
  // Mapper rows: explicit user bindings (removable) plus any default bindings the
  // user has not overridden (read-only) so the overview shows the full picture.
  const mapperRows: BindingRow[] = [];
  const mappedFieldKeys = new Set<string>();
  for (const [fieldKey, sourceKey] of Object.entries(userBindings)) {
    mapperRows.push({ fieldKey, label: fieldLabel(fieldKey), sourceLabel: upstreamLabel(sourceKey), removable: true });
    mappedFieldKeys.add(fieldKey);
  }
  for (const meta of bindingMeta) {
    if (!mappedFieldKeys.has(meta.fieldKey)) {
      mapperRows.push({ ...meta, removable: false });
    }
  }
  const setBinding = (fieldKey: string, upstreamKey: string | null): void => {
    const next = { ...userBindings };
    if (upstreamKey) {
      next[fieldKey] = upstreamKey;
    } else {
      delete next[fieldKey];
    }
    onSettingChange('__bindings', next);
  };
  let command: BuiltCommand | null = null;
  if (spec.executable) {
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
            {spec.executable ? ` · ${spec.executable}-cli` : ''}
          </div>
        </div>
      </div>
      <div className="inspector-scroll">
        {hasUpstream && inputFields.length > 0 ? <InputsPanel fields={inputFields} /> : null}

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
            isInputBound={boundKeys.includes(field.key)}
            bindableFields={canMap && hasUpstream ? inputFields : undefined}
            boundTo={userBindings[field.key]}
            onBind={canMap && !readOnly ? (upstreamKey) => setBinding(field.key, upstreamKey) : undefined}
          />
        ))}

        {hasUpstream && mapperRows.length > 0 ? (
          <BindingMapper
            rows={mapperRows}
            policy={bindPolicy}
            disabled={readOnly}
            onPolicyChange={(value) => onSettingChange('__bindPolicy', value)}
            onUnbind={readOnly ? undefined : (fieldKey) => setBinding(fieldKey, null)}
          />
        ) : null}

        <CommandPreview command={command} executable={spec.executable} />

        {!readOnly && spec.executable && onRunNode ? (
          <RunNodeButtons
            hasCachedUpstream={hasCachedUpstream}
            isRunning={isRunning}
            onRun={onRunNode}
          />
        ) : null}

        <OutputsPanel fields={outputFields} preview={preview} />

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
              <Icon name="trash" size={15} /> Delete block
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
  /** True when this field can be filled from an upstream node's output (default binding). */
  isInputBound?: boolean;
  /** Upstream fields this field can be explicitly mapped to (CLI nodes with upstream). */
  bindableFields?: FieldDescriptor[];
  /** The upstream field key this field is currently bound to, if any. */
  boundTo?: string;
  /** Bind (or, with null, unbind) this field to an upstream output field. */
  onBind?: (upstreamKey: string | null) => void;
}

function Field({
  field,
  value,
  onChange,
  disabled = false,
  isInputBound = false,
  bindableFields,
  boundTo,
  onBind
}: FieldProps) {
  const fieldId = `field-${field.key}`;
  const isBound = Boolean(boundTo);
  const inputDisabled = disabled || isBound;
  const showUpstreamHint = isInputBound && isBlank(value) && !isBound;
  const canPickBinding =
    Boolean(onBind) &&
    Boolean(bindableFields && bindableFields.length > 0) &&
    (field.type === 'text' || field.type === 'path');
  const boundLabel = bindableFields?.find((entry) => entry.key === boundTo)?.label ?? boundTo;
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
          disabled={inputDisabled}
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
            disabled={inputDisabled}
            onClick={() => onChange(false)}
          >
            no
          </button>
          <button
            type="button"
            className={value ? 'on' : ''}
            aria-pressed={Boolean(value)}
            disabled={inputDisabled}
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
          disabled={inputDisabled}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        />
      ) : (
        <input
          id={fieldId}
          className={`input ${field.type === 'path' ? 'mono' : ''}`}
          type="text"
          value={String(value ?? '')}
          disabled={inputDisabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {isBound ? (
        <div className="field-bound">
          <span className="bind-arrow" aria-hidden="true">←</span>
          <code className="bind-chip">upstream.{boundLabel}</code>
          {onBind && !disabled ? (
            <button
              type="button"
              className="bind-clear"
              aria-label={`Unbind ${field.label}`}
              onClick={() => onBind(null)}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : canPickBinding ? (
        <div className="field-bind">
          <select
            className="select select-sm"
            aria-label={`Map ${field.label} from upstream`}
            value=""
            disabled={disabled}
            onChange={(event) => {
              if (event.target.value) {
                onBind?.(event.target.value);
              }
            }}
          >
            <option value="">map from upstream…</option>
            {bindableFields?.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} ({entry.key})
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {showUpstreamHint ? (
        <p className="field-hint">
          Leave blank to pull from upstream — runs once per item from a wired source.
        </p>
      ) : null}
    </div>
  );
}

interface RunNodeButtonsProps {
  hasCachedUpstream: boolean;
  isRunning: boolean;
  onRun: (mode: RunNodeMode) => void;
}

function RunNodeButtons({ hasCachedUpstream, isRunning, onRun }: RunNodeButtonsProps) {
  return (
    <div className="run-node">
      <div className="cmd-label">run this block</div>
      {hasCachedUpstream ? (
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary run-node-btn"
            disabled={isRunning}
            onClick={() => onRun('cached-upstream')}
          >
            <PlayIcon /> Run with cached upstream
          </button>
          <button
            type="button"
            className="btn btn-sm run-node-btn"
            disabled={isRunning}
            onClick={() => onRun('static')}
          >
            Run with static settings
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-primary run-node-btn"
          disabled={isRunning}
          onClick={() => onRun('static')}
        >
          <PlayIcon /> Run this block
        </button>
      )}
    </div>
  );
}

interface BindingRow {
  fieldKey: string;
  label: string;
  sourceLabel: string;
  /** User-created bindings can be cleared; built-in default bindings cannot. */
  removable?: boolean;
}

interface BindingMapperProps {
  rows: BindingRow[];
  policy: BindPolicy;
  disabled: boolean;
  onPolicyChange: (policy: BindPolicy) => void;
  onUnbind?: (fieldKey: string) => void;
}

function BindingMapper({ rows, policy, disabled, onPolicyChange, onUnbind }: BindingMapperProps) {
  return (
    <div className="bind-mapper">
      <div className="cmd-label">upstream binding</div>
      <ul className="bind-rows">
        {rows.map((binding) => (
          <li className="bind-row" key={binding.fieldKey}>
            <span className="bind-target">{binding.label}</span>
            <span className="bind-arrow" aria-hidden="true">←</span>
            <span className="bind-source">
              upstream <code>{binding.sourceLabel}</code>
            </span>
            {binding.removable && onUnbind ? (
              <button
                type="button"
                className="bind-clear"
                aria-label={`Unbind ${binding.label}`}
                onClick={() => onUnbind(binding.fieldKey)}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="bind-policy">
        <span className="bind-policy-label" id="bind-policy-label">
          On incompatible item
        </span>
        <div className="seg" role="group" aria-labelledby="bind-policy-label">
          <button
            type="button"
            className={policy === 'skip' ? 'on' : ''}
            aria-pressed={policy === 'skip'}
            disabled={disabled}
            onClick={() => onPolicyChange('skip')}
          >
            skip
          </button>
          <button
            type="button"
            className={policy === 'fail' ? 'on' : ''}
            aria-pressed={policy === 'fail'}
            disabled={disabled}
            onClick={() => onPolicyChange('fail')}
          >
            fail node
          </button>
        </div>
      </div>
    </div>
  );
}

function InputsPanel({ fields }: { fields: FieldDescriptor[] }) {
  return (
    <div className="io-panel inputs-panel">
      <div className="cmd-label">available inputs</div>
      <ul className="io-rows">
        {fields.map((field) => (
          <li className="io-row" key={field.key}>
            <span className="io-key">{field.key}</span>
            <span className="io-type">{field.type}</span>
            {field.platform !== 'both' ? <span className="io-plat">{field.platform}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutputsPanel({ fields, preview }: { fields: FieldDescriptor[]; preview?: NodeIoPreview }) {
  if (fields.length === 0 && !preview) {
    return null;
  }
  const live = preview ? new Set(preview.normalizedFields) : null;
  return (
    <div className="io-panel outputs-panel">
      <div className="cmd-label">outputs</div>
      {fields.length > 0 ? (
        <ul className="io-rows">
          {fields.map((field) => {
            const isLive = Boolean(live?.has(normalizedFieldName(field.key)));
            return (
              <li className={`io-row ${isLive ? 'live' : ''}`} key={field.key}>
                <span className="io-key">{field.key}</span>
                <span className="io-type">{field.type}</span>
                {isLive ? <span className="io-live-dot" aria-label="present in last run" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {preview ? <LastRunPanel preview={preview} /> : null}
    </div>
  );
}

function LastRunPanel({ preview }: { preview: NodeIoPreview }) {
  return (
    <div className="last-run">
      <div className="cmd-label">last run</div>
      <div className="lr-counts">
        <span className="lr-count">{preview.inputCount} in</span>
        <span className="lr-arrow" aria-hidden="true">→</span>
        <span className="lr-count">{preview.outputCount} out</span>
        {preview.skippedCount > 0 ? <span className="lr-count lr-skip">{preview.skippedCount} skipped</span> : null}
      </div>
      {preview.normalizedFields.length > 0 ? (
        <div className="lr-fields" aria-label="Normalized fields">
          {preview.normalizedFields.map((fieldName) => (
            <span className="lr-chip" key={fieldName}>
              {fieldName}
            </span>
          ))}
        </div>
      ) : null}
      {preview.sampleItems.length > 0 ? (
        <table className="lr-table">
          <thead>
            <tr>
              <th>platform</th>
              <th>id</th>
              <th>title</th>
              <th>author</th>
            </tr>
          </thead>
          <tbody>
            {preview.sampleItems.slice(0, 5).map((item, index) => (
              <tr key={`${item.id}-${index}`}>
                <td>{item.platform}</td>
                <td>{item.id}</td>
                <td>{item.title ?? (item.text || '—')}</td>
                <td>{item.author ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
