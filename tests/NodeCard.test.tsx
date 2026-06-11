import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeCard } from '../src/components/NodeCard';
import { outputFieldsForBlock } from '../src/shared/fieldSchema';
import type { NodeIoPreview, NodeStatus, WorkbenchNode } from '../src/flowTypes';

function makeNode(status: NodeStatus): WorkbenchNode {
  return {
    id: 'reddit-search',
    blockType: 'reddit.searchPosts',
    label: 'Search Reddit',
    x: 0,
    y: 0,
    settings: { query: 'cats', subreddit: 'aww', limit: 10 },
    status
  };
}

describe('NodeCard status', () => {
  const cases: Array<[NodeStatus, RegExp]> = [
    ['idle', /idle/i],
    ['pending', /pending/i],
    ['running', /running/i],
    ['success', /success/i],
    ['error', /error/i]
  ];

  it.each(cases)('renders a non-color status cue for %s', (status, label) => {
    const { container } = render(<NodeCard node={makeNode(status)} isSelected={false} onMeasure={vi.fn()} />);
    // Accessible label (not color-only) per WCAG 1.4.1.
    expect(screen.getByLabelText(new RegExp(`Status: ${status}`, 'i'))).toBeInTheDocument();
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(container.querySelector(`.status-${status}`)).not.toBeNull();
  });

  it('renders the block title, source-coded accent, and summary', () => {
    const { container } = render(<NodeCard node={makeNode('idle')} isSelected onMeasure={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('Search Reddit')).toBeInTheDocument();
    expect(container.querySelector('.node.cat-reddit')).not.toBeNull();
    expect(container.querySelector('.node.selected')).not.toBeNull();
    expect(screen.getByText('cats')).toBeInTheDocument();
  });
});

describe('NodeCard io preview badges', () => {
  function preview(overrides: Partial<NodeIoPreview> = {}): NodeIoPreview {
    return {
      status: 'success',
      inputCount: 5,
      outputCount: 3,
      skippedCount: 2,
      normalizedFields: ['id'],
      sampleItems: [],
      ...overrides
    };
  }

  it('shows count badges with a non-color accessible label after a run', () => {
    render(
      <NodeCard node={makeNode('success')} isSelected={false} onMeasure={vi.fn()} onSelect={vi.fn()} preview={preview()} />
    );
    expect(screen.getByText('3 out')).toBeInTheDocument();
    expect(screen.getByText('2 skipped')).toBeInTheDocument();
    expect(screen.getByLabelText(/Last run: 3 out, 2 skipped/i)).toBeInTheDocument();
  });

  it('omits the skipped badge when nothing was skipped', () => {
    render(
      <NodeCard
        node={makeNode('success')}
        isSelected={false}
        onMeasure={vi.fn()}
        onSelect={vi.fn()}
        preview={preview({ skippedCount: 0 })}
      />
    );
    expect(screen.getByText('3 out')).toBeInTheDocument();
    expect(screen.queryByText(/skipped/i)).toBeNull();
  });

  it('falls back to port counts when no preview is present', () => {
    render(<NodeCard node={makeNode('idle')} isSelected={false} onMeasure={vi.fn()} onSelect={vi.fn()} />);
    // reddit.searchPosts is a source with one output port.
    expect(screen.getByText('source')).toBeInTheDocument();
    expect(screen.getByText('1 out')).toBeInTheDocument();
  });
});

describe('NodeCard io field hints', () => {
  it('renders output field chips and no inputs row for a source block', () => {
    const { container } = render(
      <NodeCard
        node={makeNode('idle')}
        isSelected={false}
        onMeasure={vi.fn()}
        onSelect={vi.fn()}
        outputFields={outputFieldsForBlock('reddit.searchPosts')}
        inputFields={[]}
      />
    );
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(container.querySelector('.nio-in')).toBeNull();
  });

  it('shows an "N available" inputs hint for a downstream transform', () => {
    const node: WorkbenchNode = { ...makeNode('idle'), id: 'limit', blockType: 'transform.limit', label: 'Limit' };
    render(
      <NodeCard
        node={node}
        isSelected={false}
        onMeasure={vi.fn()}
        onSelect={vi.fn()}
        outputFields={outputFieldsForBlock('transform.limit')}
        inputFields={outputFieldsForBlock('reddit.searchPosts')}
      />
    );
    expect(screen.getByText(`${outputFieldsForBlock('reddit.searchPosts').length} available`)).toBeInTheDocument();
  });

  it('marks a field chip live when the last run produced that field', () => {
    const { container } = render(
      <NodeCard
        node={makeNode('success')}
        isSelected={false}
        onMeasure={vi.fn()}
        onSelect={vi.fn()}
        preview={{
          status: 'success',
          inputCount: 0,
          outputCount: 3,
          skippedCount: 0,
          normalizedFields: ['author'],
          sampleItems: []
        }}
        outputFields={outputFieldsForBlock('reddit.searchPosts')}
      />
    );
    const live = container.querySelector('.nio-chip.live');
    expect(live?.textContent).toBe('Author');
  });

  it('collapses overflow output fields into a +N chip', () => {
    render(
      <NodeCard
        node={makeNode('idle')}
        isSelected={false}
        onMeasure={vi.fn()}
        onSelect={vi.fn()}
        outputFields={outputFieldsForBlock('reddit.searchPosts')}
      />
    );
    const total = outputFieldsForBlock('reddit.searchPosts').length;
    expect(screen.getByText(`+${total - 4}`)).toBeInTheDocument();
  });
});
