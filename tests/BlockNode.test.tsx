import { ReactFlowProvider } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlockNode } from '../src/components/BlockNode';
import type { NodeStatus } from '../src/flowTypes';

function renderNode(status: NodeStatus) {
  return render(
    <ReactFlowProvider>
      <BlockNode
        id="search"
        type="workbenchBlock"
        data={{ blockType: 'reddit.searchPosts', label: 'Search Reddit', settings: { subreddit: 'aww', query: 'cats', limit: 10 }, status }}
        selected={false}
        zIndex={0}
        isConnectable
        xPos={0}
        yPos={0}
        dragging={false}
      />
    </ReactFlowProvider>
  );
}

describe('BlockNode status', () => {
  const cases: Array<[NodeStatus, RegExp]> = [
    ['idle', /idle/i],
    ['pending', /pending/i],
    ['running', /running/i],
    ['success', /success/i],
    ['error', /error/i]
  ];

  it.each(cases)('renders a non-color status cue for %s', (status, label) => {
    const { container } = renderNode(status);
    // Accessible label (not color-only) per WCAG 1.4.1.
    expect(screen.getByLabelText(new RegExp(`Status: ${status}`, 'i'))).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`.status-${status}`)).not.toBeNull();
  });
});
