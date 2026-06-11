import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useModalA11y } from '../src/hooks/useModalA11y';

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div ref={ref} data-testid="dialog" tabIndex={-1}>
      <button data-testid="first">First</button>
      <button data-testid="last">Last</button>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useModalA11y', () => {
  it('moves focus to the first focusable element on mount', () => {
    const { getByTestId } = render(<Dialog onClose={vi.fn()} />);
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Dialog onClose={onClose} />);

    fireEvent.keyDown(getByTestId('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps focus from the last element back to the first on Tab', () => {
    const { getByTestId } = render(<Dialog onClose={vi.fn()} />);
    const last = getByTestId('last');
    last.focus();

    fireEvent.keyDown(getByTestId('dialog'), { key: 'Tab' });

    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('wraps focus from the first element back to the last on Shift+Tab', () => {
    const { getByTestId } = render(<Dialog onClose={vi.fn()} />);
    // focus already on first after mount.
    fireEvent.keyDown(getByTestId('dialog'), { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('restores focus to the opener when the dialog unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<Dialog onClose={vi.fn()} />);
    unmount();

    expect(document.activeElement).toBe(opener);
  });
});
