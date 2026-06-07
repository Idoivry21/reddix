import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/Inspector';
import type { NodeIoPreview, WorkbenchNode } from '../src/flowTypes';

function redditNode(settings: Record<string, unknown> = {}): WorkbenchNode {
  return {
    id: 'search',
    blockType: 'reddit.searchPosts',
    label: 'Search Reddit',
    x: 0,
    y: 0,
    settings: { query: 'cats', subreddit: 'aww', sort: 'relevance', timeRange: 'week', limit: 25, ...settings },
    status: 'idle'
  };
}

function tweetDetailNode(settings: Record<string, unknown> = {}): WorkbenchNode {
  return {
    id: 'detail',
    blockType: 'twitter.tweetDetail',
    label: 'Tweet Detail',
    x: 0,
    y: 0,
    settings: { tweetIdOrUrl: '', fullText: true, ...settings },
    status: 'idle'
  };
}

describe('Inspector', () => {
  it('hints that a blank input-bound field fans out over upstream items', () => {
    render(<Inspector node={tweetDetailNode()} onSettingChange={vi.fn()} />);
    expect(screen.getByText(/upstream/i)).toBeInTheDocument();
  });

  it('hides the upstream hint once the bound field has a static value', () => {
    render(<Inspector node={tweetDetailNode({ tweetIdOrUrl: '12345' })} onSettingChange={vi.fn()} />);
    expect(screen.queryByText(/upstream/i)).not.toBeInTheDocument();
  });

  it('renders fields for the real selected block type with current values', () => {
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} />);

    expect(screen.getByLabelText('Query')).toHaveValue('cats');
    expect(screen.getByLabelText('Subreddit')).toHaveValue('aww');
    expect(screen.getByLabelText('Limit')).toHaveValue(25);
  });

  it('calls onSettingChange when a text field is edited', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode()} onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Subreddit'), { target: { value: 'programming' } });
    expect(onSettingChange).toHaveBeenCalledWith('subreddit', 'programming');
  });

  it('emits a numeric value for number fields', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode({ limit: 10 })} onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '50' } });
    expect(onSettingChange).toHaveBeenCalledWith('limit', 50);
  });

  it('changes a select field via onSettingChange', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={redditNode()} onSettingChange={onSettingChange} />);

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'hot' } });
    expect(onSettingChange).toHaveBeenCalledWith('sort', 'hot');
  });

  it('renders a syntax-highlighted CLI command preview', () => {
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} />);
    expect(screen.getByText(/command preview/i)).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });

  it('shows an empty state when no node is selected', () => {
    render(<Inspector node={undefined} onSettingChange={vi.fn()} />);
    expect(screen.getByText(/select a block/i)).toBeInTheDocument();
  });

  it('fires duplicate and delete callbacks', () => {
    const onDelete = vi.fn();
    const onDuplicate = vi.fn();
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} onDelete={onDelete} onDuplicate={onDuplicate} />);

    fireEvent.click(screen.getByRole('button', { name: /duplicate block/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete block/i }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('Inspector upstream binding mapper', () => {
  it('renders a read-only mapping row when the node has upstream', () => {
    const { container } = render(<Inspector node={tweetDetailNode()} onSettingChange={vi.fn()} hasUpstream />);
    expect(container.querySelector('.bind-mapper')).not.toBeNull();
    // The source field label is unique to the mapper row.
    expect(screen.getByText('id or url')).toBeInTheDocument();
  });

  it('omits the mapper when the node has no upstream', () => {
    const { container } = render(<Inspector node={tweetDetailNode()} onSettingChange={vi.fn()} />);
    expect(container.querySelector('.bind-mapper')).toBeNull();
  });

  it('defaults the skip policy to skip and emits __bindPolicy on change', () => {
    const onSettingChange = vi.fn();
    render(<Inspector node={tweetDetailNode()} onSettingChange={onSettingChange} hasUpstream />);

    expect(screen.getByRole('button', { name: 'skip' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /fail node/i }));
    expect(onSettingChange).toHaveBeenCalledWith('__bindPolicy', 'fail');
  });
});

describe('Inspector run-this-node controls', () => {
  it('runs a CLI node in static mode by default', () => {
    const onRunNode = vi.fn();
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} onRunNode={onRunNode} />);

    fireEvent.click(screen.getByRole('button', { name: /run this block/i }));
    expect(onRunNode).toHaveBeenCalledWith('static');
  });

  it('offers cached-upstream and static runs when cached upstream is available', () => {
    const onRunNode = vi.fn();
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} onRunNode={onRunNode} hasCachedUpstream />);

    fireEvent.click(screen.getByRole('button', { name: /run with cached upstream/i }));
    fireEvent.click(screen.getByRole('button', { name: /run with static settings/i }));
    expect(onRunNode).toHaveBeenNthCalledWith(1, 'cached-upstream');
    expect(onRunNode).toHaveBeenNthCalledWith(2, 'static');
  });

  it('hides run controls in read-only mode', () => {
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} onRunNode={vi.fn()} readOnly />);
    expect(screen.queryByRole('button', { name: /run (this block|with)/i })).toBeNull();
  });
});

describe('Inspector last-run panel', () => {
  function preview(overrides: Partial<NodeIoPreview> = {}): NodeIoPreview {
    return {
      status: 'success',
      inputCount: 5,
      outputCount: 3,
      skippedCount: 1,
      normalizedFields: ['id', 'author'],
      sampleItems: [
        {
          platform: 'reddit',
          sourceBlockId: 'search',
          id: 'p1',
          url: null,
          author: 'bob',
          community: null,
          title: 'Hello world',
          text: 'body',
          createdAt: '2026-06-07T00:00:00Z',
          engagement: {}
        }
      ],
      ...overrides
    };
  }

  it('renders counts, normalized field chips, and sample rows', () => {
    render(<Inspector node={redditNode()} onSettingChange={vi.fn()} preview={preview()} />);

    expect(screen.getByText('5 in')).toBeInTheDocument();
    expect(screen.getByText('3 out')).toBeInTheDocument();
    expect(screen.getByText('1 skipped')).toBeInTheDocument();
    expect(screen.getByLabelText('Normalized fields')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });
});
