import { useEffect, useRef } from 'react';
import type { ConsoleRunStep, ConsoleState } from '../api';
import type { RunStatusKind } from '../flowTypes';
import { Icon } from '../icons';
import { MAX_SAMPLE_ROWS } from '../shared/runLimits';
import { Tabs, tabId, tabPanelId } from './Tabs';

interface ConsolePanelProps {
  state: ConsoleState;
  onTabChange: (tab: ConsoleState['activeTab']) => void;
  height?: number;
  setHeight?: (height: number) => void;
  isCollapsed?: boolean;
  setIsCollapsed?: (isCollapsed: boolean) => void;
  onClear?: () => void;
  runState?: RunStatusKind;
  progress?: { done: number; total: number };
}

const TABS: ConsoleState['activeTab'][] = ['Logs', 'Output Preview', 'Command Trace', 'History'];

const MIN_HEIGHT = 120;
const COLLAPSED_HEIGHT = 40;
// Space reserved at the top of the viewport (topbar + console head) so a resized
// dock never fully covers the canvas.
const VIEWPORT_RESERVE = 140;

export function ConsolePanel({
  state,
  onTabChange,
  height = 208,
  setHeight,
  isCollapsed = false,
  setIsCollapsed,
  onClear,
  runState = 'idle',
  progress
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
      const next = Math.max(
        MIN_HEIGHT,
        Math.min(window.innerHeight - VIEWPORT_RESERVE, resizing.current.h + (resizing.current.y - moveEvent.clientY))
      );
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

  const dockHeight = isCollapsed ? COLLAPSED_HEIGHT : height;

  return (
    <section className="console" aria-label="Run console" style={{ height: dockHeight }}>
      {!isCollapsed && setHeight ? <div className="console-resize" onPointerDown={startResize} /> : null}
      <div className="console-head">
        <div className="console-tabs">
          <Tabs
            tabs={TABS}
            active={state.activeTab}
            onChange={(tab) => {
              onTabChange(tab as ConsoleState['activeTab']);
              setIsCollapsed?.(false);
            }}
            label="Run console views"
            idPrefix="console"
          />
        </div>
        <div className="console-spacer" />
        {runState === 'running' ? (
          <span className="console-meta" role="status" aria-live="polite">
            <span className="spin-fast console-spin" />
            {progress && progress.total > 0 ? `${progress.done} / ${progress.total} steps` : 'executing'}
          </span>
        ) : (
          <span className="console-meta">{state.runLabel}</span>
        )}
        {state.reportPath ? (
          <a
            className="console-report-link"
            href={`/api/artifacts/${state.reportPath}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open report ↗
          </a>
        ) : null}
        <button className="console-btn" type="button" title="Clear logs" aria-label="Clear logs" onClick={onClear}>
          <Icon name="trash" size={15} />
        </button>
        {setIsCollapsed ? (
          <button
            className="console-btn"
            type="button"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            aria-label={isCollapsed ? 'Expand console' : 'Collapse console'}
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none' }}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>
      {!isCollapsed ? (
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
    return <div className="out-empty">No runs yet for this flow.</div>;
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
    return (
      <div className="out-empty">
        No rows yet — press <strong>Run flow</strong>; exported items appear here.
      </div>
    );
  }
  const capped = rows.length >= MAX_SAMPLE_ROWS;
  return (
    <div className="out-table-wrap">
      <div className="out-caption">
        {rows.length} row{rows.length === 1 ? '' : 's'}
        {capped ? ` · showing first ${MAX_SAMPLE_ROWS}` : ''}
      </div>
      <table className="out-table">
        <thead>
          <tr>
            <th>platform</th>
            <th>title / body</th>
            <th>author</th>
            <th>score</th>
            <th>created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const url = typeof row.url === 'string' ? row.url : null;
            return (
              <tr key={`${index}-${row.platform}-${row.id ?? row.title}`}>
                <td>{row.platform}</td>
                <td className="out-title">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {row.title ?? url}
                    </a>
                  ) : (
                    row.title
                  )}
                </td>
                <td>{row.author}</td>
                <td className="num">{row.score}</td>
                <td>{row.created}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
