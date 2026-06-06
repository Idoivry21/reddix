import { AlertOctagon, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { RunStatus } from '../flowTypes';

interface RunStatusBarProps {
  status: RunStatus;
}

const ICONS = {
  idle: CheckCircle2,
  running: Loader2,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertOctagon
} as const;

/**
 * Live region that announces run start, success, warning, and failure to
 * screen readers (aria-live) and visually distinguishes error/warning states.
 */
export function RunStatusBar({ status }: RunStatusBarProps) {
  const Icon = ICONS[status.kind];
  // Errors are assertive so they interrupt; everything else is polite.
  const politeness = status.kind === 'error' ? 'assertive' : 'polite';
  return (
    <div
      className={`run-status-bar run-status-${status.kind}`}
      role="status"
      aria-live={politeness}
      data-status={status.kind}
    >
      <Icon size={15} />
      <span>{status.message}</span>
    </div>
  );
}
