import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastViewport } from '../src/components/ToastViewport';
import type { Toast } from '../src/hooks/useToasts';

const toasts: Toast[] = [
  { id: 'a', kind: 'error', message: 'boom', duration: 7000 },
  { id: 'b', kind: 'success', message: 'done', duration: 4500 }
];

describe('ToastViewport', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastViewport toasts={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses role=alert for errors and role=status otherwise', () => {
    render(<ToastViewport toasts={toasts} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('status')).toHaveTextContent('done');
  });

  it('calls onDismiss with the toast id when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ToastViewport toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getAllByRole('button', { name: /dismiss notification/i })[0]);
    expect(onDismiss).toHaveBeenCalledWith('a');
  });
});
