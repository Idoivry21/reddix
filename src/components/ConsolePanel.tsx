import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Maximize2, MinusCircle, Trash2 } from 'lucide-react';
import type { ConsoleRunStep, ConsoleState } from '../api';

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
          <button className="ghost-button" type="button">
            <Trash2 size={14} /> Clear
          </button>
          <button className="run-pill" type="button">
            <CheckCircle2 size={14} /> {state.runLabel}
          </button>
          <button className="icon-button" aria-label="Expand console" type="button">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="console-body">
        <ol className="step-list">
          {state.steps.map((step, index) => (
            <li key={step.id} className={`step-${step.status}`}>
              <StepIcon status={step.status} />
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
              {state.logs.map((log, index) => (
                <li key={`${index}-${log}`}>{log}</li>
              ))}
            </ul>
          ) : state.activeTab === 'History' ? (
            <HistoryList entries={state.history} />
          ) : (
            <CommandTrace steps={state.steps} />
          )}
        </div>
      </div>
    </section>
  );
}

function StepIcon({ status }: { status: ConsoleRunStep['status'] }) {
  if (status === 'success') {
    return <CheckCircle2 size={15} className="status-success" />;
  }
  if (status === 'failed') {
    return <AlertTriangle size={15} className="status-error" />;
  }
  if (status === 'running') {
    return <Loader2 size={15} className="status-running" />;
  }
  if (status === 'skipped') {
    return <MinusCircle size={15} className="status-skipped" />;
  }
  return <CircleDashed size={15} className="status-idle" />;
}

function CommandTrace({ steps }: { steps: ConsoleRunStep[] }) {
  if (steps.length === 0) {
    return <p className="empty-state">No run yet. Press Run Now to execute the flow.</p>;
  }
  return (
    <div className="command-trace">
      {steps.map((step, index) => (
        <article key={step.id} className={`trace-step step-${step.status}`}>
          <h3>
            Step {index + 1}: {step.label}
          </h3>
          <pre>{step.argv ? step.argv.join(' ') : 'Local block (no command)'}</pre>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{step.status}</dd>
            </div>
            {step.exitCode !== undefined && step.exitCode !== null ? (
              <div>
                <dt>Exit Code</dt>
                <dd>{step.exitCode}</dd>
              </div>
            ) : null}
            {step.stdoutSummary ? (
              <div>
                <dt>Output</dt>
                <dd>{step.stdoutSummary}</dd>
              </div>
            ) : null}
            {step.error ? (
              <div>
                <dt>Error</dt>
                <dd>{step.error}</dd>
              </div>
            ) : null}
          </dl>
        </article>
      ))}
    </div>
  );
}

function HistoryList({ entries }: { entries: ConsoleState['history'] }) {
  if (entries.length === 0) {
    return <p className="empty-state">No run history yet.</p>;
  }
  return (
    <ul className="history-list">
      {entries.map((entry) => (
        <li key={entry.id} className={`history-${entry.status}`}>
          <strong>{entry.id}</strong>
          <span>{entry.status}</span>
          <small>{entry.startedAt}</small>
          <em>{entry.steps} steps</em>
          {entry.error ? <span className="history-error">{entry.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function ResultTable({ rows }: { rows: Array<Record<string, string | number | null>> }) {
  if (rows.length === 0) {
    return <p className="empty-state">No output rows. Run a flow with an export block to see results.</p>;
  }
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
        {rows.map((row, index) => (
          <tr key={`${index}-${row.kind}-${row.id ?? row.title}`}>
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
