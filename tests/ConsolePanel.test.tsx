import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsolePanel } from '../src/components/ConsolePanel';
import type { ConsoleState } from '../src/api';

function baseState(overrides: Partial<ConsoleState> = {}): ConsoleState {
  return {
    activeTab: 'Command Trace',
    command: undefined,
    runLabel: 'Run 1',
    steps: [],
    logs: [],
    results: [],
    history: [],
    ...overrides
  };
}

describe('ConsolePanel command trace', () => {
  it('renders real per-step argv and exit code from the run record', () => {
    const state = baseState({
      steps: [
        {
          id: 'search',
          label: 'Search Reddit',
          sublabel: 'rdt reddit',
          status: 'success',
          duration: '1.20s',
          argv: ['rdt', 'search', '--query', 'cats'],
          exitCode: 0,
          stdoutSummary: '87 records'
        }
      ]
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    expect(screen.getByText(/rdt search --query cats/)).toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument(); // no hardcoded "87"
    expect(screen.getByText(/87 records/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no steps', () => {
    render(<ConsolePanel state={baseState()} onTabChange={vi.fn()} />);
    expect(screen.getByText(/no run yet|run the flow/i)).toBeInTheDocument();
  });

  it('renders run history entries on the History tab', () => {
    const state = baseState({
      activeTab: 'History',
      history: [
        { id: 'run-2', status: 'success', startedAt: '2026-06-06T10:00:00.000Z', steps: 3, error: null },
        { id: 'run-1', status: 'failed', startedAt: '2026-06-06T09:00:00.000Z', steps: 2, error: 'boom' }
      ]
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    expect(screen.getByText(/run-2/)).toBeInTheDocument();
    expect(screen.getByText(/run-1/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
