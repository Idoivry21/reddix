import { useEffect, useRef } from 'react';
import type { ConsoleRunStep, ConsoleState } from '../api';
import type { RunStatusKind } from '../flowTypes';
import { Tabs, tabId, tabPanelId } from './Tabs';

interface ConsolePanelProps {
  state: ConsoleState;
  onTabChange: (tab: ConsoleState['activeTab']) => void;
  height?: number;
  setHeight?: (height: number) => void;
  collapsed?: boolean;
  setCollapsed?: (collapsed: boolean) => void;
  onClear?: () => void;
  runState?: RunStatusKind;
}

const TABS: ConsoleState['activeTab'][] = ['Logs', 'Output Preview', 'Command Trace', 'History'];

const MIN_HEIGHT = 120;
const COLLAPSED_HEIGHT = 40;

export function ConsolePanel({
  state,
  onTabChange,
  height = 208,
  setHeight,
  collapsed = false,
  setCollapsed,
  onClear,
  runState = 'idle'
}: ConsolePanelProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const resizing = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    if (bodyRef.current && state.activeTab === 'Logs') {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [state.logs, state.activeTab]);

  const startResize = (event: React.PointerEvent): void => {
    if (!setHeight) {
      return;
    }
    resizing.current = { y: event.clientY, h: height };
    const move = (moveEvent: PointerEvent): void => {
      if (!resizing.current) {
        return;
      }
      const next = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 140, resizing.current.h + (resizing.current.y - moveEvent.clientY)));
      setHeight(next);
    };
    const up = (): void => {
      resizing.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dockHeight = collapsed ? COLLAPSED_HEIGHT : height;

  return (
    <section className="console" aria-label="Run console" style={{ height: dockHeight }}>
      {!collapsed && setHeight ? <div className="console-resize" onPointerDown={startResize} /> : null}
      <div className="console-head">
        <div className="console-tabs">
          <Tabs
            tabs={TABS}
            active={state.activeTab}
            onChange={(tab) => {
              onTabChange(tab as ConsoleState['activeTab']);
              setCollapsed?.(false);
            }}
            label="Run console views"
            idPrefix="console"
          />
        </div>
        <div className="console-spacer" />
        {runState === 'running' ? (
          <span className="console-meta">
            <span className="spin-fast console-spin" /> executing
          </span>
        ) : (
          <span className="console-meta">{state.runLabel}</span>
        )}
        <button className="console-btn" type="button" title="Clear logs" aria-label="Clear logs" onClick={onClear}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
          </svg>
        </button>
        {setCollapsed ? (
          <button
            className="console-btn"
            type="button"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand console' : 'Collapse console'}
            onClick={() => setCollapsed(!collapsed)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div
          className="console-body"
          ref={bodyRef}
          role="tabpanel"
          id={tabPanelId('console', state.activeTab)}
          aria-labelledby={tabId('console', state.activeTab)}
          tabIndex={0}
        >
          {state.activeTab === 'Output Preview' ? (
            <ResultTable rows={state.results} />
          ) : state.activeTab === 'Logs' ? (
            <LogList logs={state.logs} />
          ) : state.activeTab === 'History' ? (
            <HistoryList entries={state.history} />
          ) : (
            <CommandTrace steps={state.steps} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function LogList({ logs }: { logs: string[] }) {
  if (logs.length === 0) {
    return <div className="out-empty">No logs yet — press Run flow to execute.</div>;
  }
  return (
    <div className="log-stream">
      {logs.map((log, index) => (
        <div className="log-line" key={`${index}-${log}`}>
          <span className="lm">{log}</span>
        </div>
      ))}
    </div>
  );
}

function CommandTrace({ steps }: { steps: ConsoleRunStep[] }) {
  if (steps.length === 0) {
    return <div className="out-empty">No run yet. Press Run flow to execute the flow.</div>;
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
    return <div className="out-empty">No run history yet.</div>;
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
    return <div className="out-empty">No output rows. Run a flow with an export block to see results.</div>;
  }
  return (
    <table className="out-table">
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
            <td className="num">{row.score}</td>
            <td>{row.created}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
