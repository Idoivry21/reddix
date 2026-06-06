import { BrandMark } from '../icons';
import { RunStatusBar } from './RunStatusBar';
import type { ProviderHealth } from '../api';
import type { RunStatus } from '../flowTypes';

interface TopBarProps {
  flowName?: string;
  onRename?: (name: string) => void;
  runStatus?: RunStatus;
  onRun: () => void;
  onStop?: () => void;
  isRunning?: boolean;
  onOpenDashboard?: () => void;
  onOpenSchedule?: () => void;
  providers?: ProviderHealth[];
  healthLoading?: boolean;
  healthError?: boolean;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  readOnly?: boolean;
}

const IDLE_STATUS: RunStatus = { kind: 'idle', message: 'Idle' };

export function TopBar({
  flowName = 'Untitled flow',
  onRename,
  runStatus = IDLE_STATUS,
  onRun,
  onStop,
  isRunning = false,
  onOpenDashboard,
  onOpenSchedule,
  providers = [],
  healthLoading = false,
  healthError = false,
  theme = 'light',
  onToggleTheme,
  readOnly = false
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <h1 className="brand-name">Reddix</h1>
      </div>
      <div className="topbar-divider" />
      <button className="btn btn-ghost btn-sm" type="button" onClick={onOpenDashboard} title="All flows">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        Flows
      </button>
      <div className="flowname">
        <input
          className="flowname-title"
          value={flowName}
          onChange={(event) => onRename?.(event.target.value)}
          spellCheck={false}
          aria-label="Flow name"
          disabled={readOnly}
        />
      </div>

      <div className="topbar-spacer" />

      <ProviderHealthPills providers={providers} loading={healthLoading} error={healthError} />

      <RunStatusBar status={runStatus} />

      <button
        className="btn btn-icon"
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title="Toggle theme"
      >
        {theme === 'dark' ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
          </svg>
        )}
      </button>

      <button className="btn btn-sm" type="button" onClick={onOpenSchedule} title="Schedule runs">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        Schedule
      </button>

      {isRunning ? (
        <button className="btn btn-sm" type="button" onClick={onStop} disabled={readOnly}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      ) : (
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={onRun}
          disabled={readOnly}
          title={readOnly ? 'Read-only on mobile' : undefined}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none">
            <path d="M8 5v14l11-7z" />
          </svg>
          Run flow
        </button>
      )}
    </header>
  );
}

interface ProviderHealthPillsProps {
  providers: ProviderHealth[];
  loading: boolean;
  error: boolean;
}

function ProviderHealthPills({ providers, loading, error }: ProviderHealthPillsProps) {
  if (loading) {
    return <span className="provider-pill">Checking CLIs…</span>;
  }
  if (error) {
    return (
      <span className="provider-pill provider-error" role="status">
        CLI health unavailable
      </span>
    );
  }
  if (providers.length === 0) {
    return <span className="provider-pill provider-error">No providers detected</span>;
  }
  return (
    <>
      {providers.map((provider) => (
        <span
          key={provider.provider}
          className={`provider-pill ${provider.available ? 'provider-healthy' : 'provider-missing'}`}
          role="status"
          aria-label={`${provider.executable} ${provider.available ? 'healthy' : 'missing'}`}
        >
          {provider.executable} <strong>{provider.available ? 'Healthy' : 'Missing'}</strong>
        </span>
      ))}
    </>
  );
}
