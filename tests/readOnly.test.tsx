import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../src/components/TopBar';
import { BlockPalette } from '../src/components/BlockPalette';
import { Inspector } from '../src/components/Inspector';
import type { WorkbenchNode } from '../src/flowTypes';

function redditNode(): WorkbenchNode {
  return {
    id: 'search',
    type: 'workbenchBlock',
    position: { x: 0, y: 0 },
    data: {
      blockType: 'reddit.searchPosts',
      label: 'Search Reddit',
      settings: { query: 'cats', subreddit: 'aww', sort: 'relevance', timeRange: 'week', limit: 25 },
      status: 'idle'
    }
  };
}

describe('mobile read-only enforcement (T405)', () => {
  it('disables Run Now in the TopBar', () => {
    render(<TopBar lastSavedAt="Saved" onRun={vi.fn()} readOnly />);
    expect(screen.getByRole('button', { name: /Run Now/i })).toBeDisabled();
  });

  it('makes palette items non-interactive', () => {
    render(<BlockPalette onAddBlock={vi.fn()} readOnly />);
    const items = screen.getAllByRole('button', { name: /Add .* block/i });
    for (const item of items) {
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveAttribute('tabindex', '-1');
    }
  });

  it('disables Inspector field inputs', () => {
    render(<Inspector node={redditNode()} validationMessage="Ready" onSettingChange={vi.fn()} readOnly />);
    expect(screen.getByLabelText('Query')).toBeDisabled();
    expect(screen.getByLabelText('Limit')).toBeDisabled();
  });
});
