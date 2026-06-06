import { X } from 'lucide-react';
import { buildBlockCommand, getBlockSpec, previewCommand } from '../shared/commandBuilders';

interface InspectorProps {
  selectedNodeId: string;
  validationMessage: string;
}

export function Inspector({ selectedNodeId, validationMessage }: InspectorProps) {
  const blockType = selectedNodeId.includes('twitter') ? 'twitter.searchTweets' : 'reddit.searchPosts';
  const spec = getBlockSpec(blockType);
  const settings = spec.defaultSettings;
  const command = spec.command
    ? previewCommand(buildBlockCommand({ blockId: selectedNodeId, blockType, settings }))
    : 'Local block';

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-header">
        <div className={`inspector-provider provider-${spec.provider}`}>{spec.provider === 'reddit' ? 'r/' : 'X'}</div>
        <h2>{spec.label}</h2>
        <button className="icon-button" aria-label="Close inspector">
          <X size={16} />
        </button>
      </div>
      <nav className="inspector-tabs">
        <button className="active">Settings</button>
        <button>Validation</button>
        <button>Notes</button>
      </nav>
      <div className="field-grid">
        {spec.fields.slice(0, 7).map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            {field.type === 'select' ? (
              <select defaultValue={String(settings[field.key] ?? '')}>
                <option>{String(settings[field.key] ?? 'default')}</option>
              </select>
            ) : (
              <input defaultValue={String(settings[field.key] ?? '')} type={field.type === 'number' ? 'number' : 'text'} />
            )}
          </label>
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

