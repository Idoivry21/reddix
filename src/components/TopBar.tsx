import { CalendarDays, Download, Play, Save, ShieldCheck } from 'lucide-react';

interface TopBarProps {
  lastSavedAt: string;
  onRun: () => void;
  isRunning?: boolean;
}

export function TopBar({ lastSavedAt, onRun, isRunning = false }: TopBarProps) {
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
        <span className="provider-pill reddit-dot">rdt <strong>Healthy</strong></span>
        <span className="provider-pill twitter-dot">twitter <strong>Healthy</strong></span>
        <button className="primary-button" onClick={onRun} disabled={isRunning}>
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

