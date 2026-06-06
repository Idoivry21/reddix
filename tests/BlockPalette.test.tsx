import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlockPalette } from '../src/components/BlockPalette';

describe('BlockPalette keyboard accessibility', () => {
  it('exposes palette items as focusable buttons', () => {
    render(<BlockPalette onAddBlock={vi.fn()} />);
    const items = screen.getAllByRole('button', { name: /Add .* block/i });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).toHaveAttribute('tabindex', '0');
    }
  });

  it('adds a block on click', () => {
    const onAddBlock = vi.fn();
    render(<BlockPalette onAddBlock={onAddBlock} />);
    const [first] = screen.getAllByRole('button', { name: /Add .* block/i });
    fireEvent.click(first);
    expect(onAddBlock).toHaveBeenCalledTimes(1);
  });

  it('adds a block on Enter and Space', () => {
    const onAddBlock = vi.fn();
    render(<BlockPalette onAddBlock={onAddBlock} />);
    const [first] = screen.getAllByRole('button', { name: /Add .* block/i });
    fireEvent.keyDown(first, { key: 'Enter' });
    fireEvent.keyDown(first, { key: ' ' });
    expect(onAddBlock).toHaveBeenCalledTimes(2);
  });
});
