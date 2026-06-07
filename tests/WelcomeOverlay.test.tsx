import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeOverlay } from '../src/components/WelcomeOverlay';

describe('WelcomeOverlay', () => {
  it('renders a labelled dialog with both CTAs', () => {
    render(<WelcomeOverlay onRun={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /welcome to reddix/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run the sample flow/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /explore on my own/i })).toBeInTheDocument();
  });

  it('invokes onRun when the run CTA is clicked', () => {
    const onRun = vi.fn();
    render(<WelcomeOverlay onRun={onRun} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /run the sample flow/i }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', () => {
    const onDismiss = vi.fn();
    render(<WelcomeOverlay onRun={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});
