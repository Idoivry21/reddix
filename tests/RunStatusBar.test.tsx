import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunStatusBar } from '../src/components/RunStatusBar';

describe('RunStatusBar', () => {
  it('announces the run status via an aria-live region', () => {
    render(<RunStatusBar status={{ kind: 'running', message: 'Run started' }} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Run started');
  });

  it('renders a distinct error state and announces assertively', () => {
    render(<RunStatusBar status={{ kind: 'error', message: 'Run failed: boom' }} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('data-status', 'error');
    expect(region).toHaveClass('run-status-error');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toHaveTextContent('boom');
  });

  it('renders a distinct warning state separate from error', () => {
    render(<RunStatusBar status={{ kind: 'warning', message: 'Run finished with errors' }} />);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('run-status-warning');
    expect(region).not.toHaveClass('run-status-error');
  });
});
