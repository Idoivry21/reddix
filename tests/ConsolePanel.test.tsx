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

  it('shows an "Open report" link to the artifact when a run produced an HTML report', () => {
    const state = baseState({ reportPath: 'outputs/report-20260601-100000.html' });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    const link = screen.getByRole('link', { name: /open report/i });
    expect(link).toHaveAttribute('href', '/api/artifacts/outputs/report-20260601-100000.html');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('hides the "Open report" link when no HTML report is present', () => {
    render(<ConsolePanel state={baseState()} onTabChange={vi.fn()} />);
    expect(screen.queryByRole('link', { name: /open report/i })).not.toBeInTheDocument();
  });

  it('renders output preview rows with a linked title and a count caption', () => {
    const state = baseState({
      activeTab: 'Output Preview',
      results: [
        { platform: 'reddit', id: 'p1', title: 'Hello world', author: 'bob', score: 12, created: '2026-06-06', url: 'https://example.com/p1' }
      ]
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    const link = screen.getByRole('link', { name: /hello world/i });
    expect(link).toHaveAttribute('href', 'https://example.com/p1');
    expect(screen.getByText(/1 row/i)).toBeInTheDocument();
  });

  it('captions an unsaved preview with the producing node and a not-saved notice', () => {
    const state = baseState({
      activeTab: 'Output Preview',
      results: [{ platform: 'twitter', id: 't1', title: 'A tweet', author: 'puba', score: 0, created: '2026-06-07', url: null }],
      resultsMeta: { sourceLabel: 'Tweet Detail', saved: false, totalItems: 15 }
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    expect(screen.getByText(/Tweet Detail/)).toBeInTheDocument();
    expect(screen.getByText(/not saved/i)).toBeInTheDocument();
    expect(screen.getByText(/15 items/i)).toBeInTheDocument();
  });

  it('captions a saved preview as exported', () => {
    const state = baseState({
      activeTab: 'Output Preview',
      results: [{ platform: 'reddit', id: 'p1', title: 'Saved row', author: 'bob', score: 1, created: '2026-06-06', url: null }],
      resultsMeta: { sourceLabel: 'Export JSON', saved: true, totalItems: 15 }
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    expect(screen.getByText(/exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/not saved/i)).not.toBeInTheDocument();
  });

  it('does not render javascript URLs from output preview rows as clickable links', () => {
    const state = baseState({
      activeTab: 'Output Preview',
      results: [
        {
          platform: 'reddit',
          id: 'p1',
          title: 'Hostile link',
          author: 'eve',
          score: 1,
          created: '2026-06-06',
          url: 'javascript:alert(document.domain)'
        }
      ]
    });
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);

    expect(screen.getByText('Hostile link')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /hostile link/i })).not.toBeInTheDocument();
  });

  it('shows live step progress in the head while running', () => {
    render(
      <ConsolePanel state={baseState()} onTabChange={vi.fn()} runState="running" progress={{ done: 3, total: 7 }} />
    );
    expect(screen.getByText(/3 \/ 7 steps/)).toBeInTheDocument();
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
