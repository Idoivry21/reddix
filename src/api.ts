import type { BuiltCommand } from './shared/types';

export interface ConsoleRunStep {
  id: string;
  label: string;
  sublabel: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  duration: string;
}

export interface ConsoleState {
  activeTab: 'Command Trace' | 'Logs' | 'Output Preview' | 'History';
  command?: BuiltCommand;
  steps: ConsoleRunStep[];
  logs: string[];
  results: Array<Record<string, string | number | null>>;
  runLabel: string;
}

export async function fetchHealth() {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error('Backend health check failed');
  }
  return response.json();
}

