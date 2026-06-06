import { CheckCircle2, Maximize2, Trash2 } from 'lucide-react';
import type { ConsoleState } from '../api';
import { previewCommand } from '../shared/commandBuilders';

interface ConsolePanelProps {
  state: ConsoleState;
  onTabChange: (tab: ConsoleState['activeTab']) => void;
}

const tabs: ConsoleState['activeTab'][] = ['Command Trace', 'Logs', 'Output Preview', 'History'];

export function ConsolePanel({ state, onTabChange }: ConsolePanelProps) {
  return (
    <section className="console-panel" aria-label="Run console">
      <div className="console-tabs">
        {tabs.map((tab) => (
          <button key={tab} className={state.activeTab === tab ? 'active' : ''} onClick={() => onTabChange(tab)}>
            {tab}
          </button>
        ))}
        <div className="console-actions">
          <button className="ghost-button">
            <Trash2 size={14} /> Clear
          </button>
          <button className="run-pill">
            <CheckCircle2 size={14} /> {state.runLabel}
          </button>
          <button className="icon-button" aria-label="Expand console">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="console-body">
        <ol className="step-list">
          {state.steps.map((step, index) => (
            <li key={step.id}>
              <CheckCircle2 size={15} />
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <small>{step.sublabel}</small>
              </div>
              <em>{step.duration}</em>
            </li>
          ))}
        </ol>
        <div className="console-detail">
          {state.activeTab === 'Output Preview' ? (
            <ResultTable rows={state.results} />
          ) : state.activeTab === 'Logs' ? (
            <ul className="log-list">
              {state.logs.map((log) => (
                <li key={log}>{log}</li>
              ))}
            </ul>
          ) : (
            <>
              <h3>Step 1: Search Reddit</h3>
              <pre>{state.command ? previewCommand(state.command) : 'Local transform'}</pre>
              <dl>
                <div>
                  <dt>Exit Code</dt>
                  <dd>0</dd>
                </div>
                <div>
                  <dt>Records</dt>
                  <dd>87</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>outputs/reddit-20260606-150000.json</dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ResultTable({ rows }: { rows: Array<Record<string, string | number | null>> }) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th>kind</th>
          <th>title / body</th>
          <th>author</th>
          <th>score</th>
          <th>created</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.kind}-${row.title}`}>
            <td>{row.kind}</td>
            <td>{row.title}</td>
            <td>{row.author}</td>
            <td>{row.score}</td>
            <td>{row.created}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

