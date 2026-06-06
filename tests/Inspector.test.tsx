import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/Inspector';
import type { WorkbenchNode } from '../src/flowTypes';

function redditNode(settings: Record<string, unknown> = {}): WorkbenchNode {
  return {
    id: 'search',
    type: 'workbenchBlock',
    position: { x: 0, y: 0 },
    data: {
      blockType: 'reddit.searchPosts',
      label: 'Search Reddit',
      settings: { query: 'cats', subreddit: 'aww', sort: 'relevance', timeRange: 'week', limit: 25, ...settings },
      status: 'idle'
    }
  };
}

describe('Inspector', () => {
  it('renders fields for the real selected block type with current values', () => {
    render(<Inspector node={redditNode()} validationMessage="Ready" onSettingChange={vi.fn()} />);

    expect(screen.getByLabelText('Query')).toHaveValue('cats');
    expect(screen.getByLabelText('Subreddit')).toHaveValue('aww');
    expect(screen.getByLabelText('Limit')).toHaveValue(25);
  });

  it('calls onSettingChange when a text field is edited', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode()} validationMessage="Ready" onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Subreddit'), { target: { value: 'programming' } });
    expect(onSettingChange).toHaveBeenCalledWith('subreddit', 'programming');
  });

  it('emits a numeric value for number fields', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode({ limit: 10 })} validationMessage="Ready" onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '50' } });
    expect(onSettingChange).toHaveBeenCalledWith('limit', 50);
  });

  it('changes a select field via onSettingChange', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode()} validationMessage="Ready" onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'hot' } });
    expect(onSettingChange).toHaveBeenCalledWith('sort', 'hot');
  });

  it('shows an empty state when no node is selected', () => {
    render(<Inspector node={undefined} validationMessage="Ready" onSettingChange={vi.fn()} />);
    expect(screen.getByText(/select a block/i)).toBeInTheDocument();
  });
});
