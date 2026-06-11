import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '../src/components/Tabs';

const TABS = ['Command Trace', 'Logs', 'Output Preview', 'History'];

describe('Tabs (WAI-ARIA)', () => {
  it('renders a tablist with one selected tab and roving tabindex', () => {
    render(<Tabs tabs={TABS} active="Logs" onChange={vi.fn()} label="Views" idPrefix="t" />);
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument();

    const selected = screen.getByRole('tab', { name: 'Logs' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');

    const other = screen.getByRole('tab', { name: 'Command Trace' });
    expect(other).toHaveAttribute('aria-selected', 'false');
    expect(other).toHaveAttribute('tabindex', '-1');
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="Logs" onChange={onChange} label="Views" idPrefix="t" />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(onChange).toHaveBeenCalledWith('History');
  });

  it('moves selection with ArrowRight and wraps with Home/End', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} active="Logs" onChange={onChange} label="Views" idPrefix="t" />);
    const logs = screen.getByRole('tab', { name: 'Logs' });

    fireEvent.keyDown(logs, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('Output Preview');

    fireEvent.keyDown(logs, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('Command Trace');

    fireEvent.keyDown(logs, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('History');

    fireEvent.keyDown(logs, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('Command Trace');
  });
});
