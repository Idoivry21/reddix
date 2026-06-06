import { CalendarDays, Download, Play, Save, ShieldCheck } from 'lucide-react';
import type { ProviderHealth } from '../api';

interface TopBarProps {
  lastSavedAt: string;
  onRun: () => void;
  isRunning?: boolean;
  providers?: ProviderHealth[];
  healthLoading?: boolean;
  healthError?: boolean;
  readOnly?: boolean;
}

export function TopBar({
  lastSavedAt,
  onRun,
  isRunning = false,
  providers = [],
  healthLoading = false,
  healthError = false,
  readOnly = false
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-cluster">
        <h1>Reddix</h1>
        <span className="divider" />
        <span className="flow-name">Starter research export</span>
        <button className="icon-button" aria-label="Save flow">
          <Save size={15} />
        </button>
        <span className="save-status">
          <ShieldCheck size={16} />
          {lastSavedAt}
        </span>
      </div>
      <div className="top-actions">
        <ProviderHealthPills
          providers={providers}
          loading={healthLoading}
          error={healthError}
        />
        <button
          className="primary-button"
          onClick={onRun}
          disabled={isRunning || readOnly}
          title={readOnly ? 'Read-only on mobile' : undefined}
        >
          <Play size={15} fill="currentColor" /> {isRunning ? 'Running…' : 'Run Now'}
        </button>
        <button className="secondary-button">
          <CalendarDays size={15} /> Schedule
        </button>
        <button className="secondary-button">
          <Download size={15} /> Export
        </button>
      </div>
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
    return <span className="provider-pill provider-checking">Checking CLIs…</span>;
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
          className={`provider-pill ${provider.provider}-dot ${
            provider.available ? 'provider-healthy' : 'provider-missing'
          }`}
          role="status"
          aria-label={`${provider.executable} ${provider.available ? 'healthy' : 'missing'}`}
        >
          {provider.executable} <strong>{provider.available ? 'Healthy' : 'Missing'}</strong>
        </span>
      ))}
    </>
  );
}

