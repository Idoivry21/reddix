import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WriteConfirmModal } from '../src/components/WriteConfirmModal';
import type { WriteSummary } from '../src/shared/writeActions';

const writes: WriteSummary[] = [
  { blockId: 'a', blockType: 'twitter.post', label: 'Post Tweet', destructive: false, target: 'gm', fromUpstream: false },
  { blockId: 'b', blockType: 'twitter.delete', label: 'Delete Tweet', destructive: true, target: '123', fromUpstream: false }
];

describe('WriteConfirmModal', () => {
  it('lists each write and flags destructive ones', () => {
    render(<WriteConfirmModal writes={writes} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Post Tweet')).toBeTruthy();
    expect(screen.getByText('Delete Tweet')).toBeTruthy();
    expect(screen.getByText(/irreversible|destructive/i)).toBeTruthy();
  });

  it('calls onConfirm and onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<WriteConfirmModal writes={writes} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
