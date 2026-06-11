import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { capLogs } from '../src/runConsole';
import { ConsolePanel } from '../src/components/ConsolePanel';
import type { ConsoleState } from '../src/api';

describe('capLogs', () => {
  it('keeps only the most recent entries', () => {
    const logs = Array.from({ length: 250 }, (_unused, index) => `line ${index}`);
    const capped = capLogs(logs);
    expect(capped).toHaveLength(200);
    expect(capped[0]).toBe('line 50');
    expect(capped.at(-1)).toBe('line 249');
  });

  it('leaves short lists untouched', () => {
    const logs = ['a', 'b'];
    expect(capLogs(logs)).toBe(logs);
  });
});

describe('ConsolePanel log keys', () => {
  it('renders duplicate log lines without collapsing them', () => {
    const state: ConsoleState = {
      activeTab: 'Logs',
      command: undefined,
      runLabel: 'Run',
      steps: [],
      logs: ['Ready.', 'Ready.', 'Ready.'],
      results: [],
      history: []
    };
    render(<ConsolePanel state={state} onTabChange={vi.fn()} />);
    expect(screen.getAllByText('Ready.')).toHaveLength(3);
  });
});
