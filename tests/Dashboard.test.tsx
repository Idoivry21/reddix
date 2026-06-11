import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard, type FlowSummary } from '../src/components/Dashboard';

function summary(overrides: Partial<FlowSummary> = {}): FlowSummary {
  return {
    id: 'flow-1',
    name: 'Daily digest',
    description: 'Top posts, exported nightly.',
    blocks: 4,
    sources: [],
    status: 'idle',
    statusLabel: 'Manual',
    ...overrides
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Dashboard delete', () => {
  it('renders a delete button per flow when onDelete is provided', () => {
    render(
      <Dashboard
        flows={[summary()]}
        activeFlowId="flow-1"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Delete Daily digest' })).toBeInTheDocument();
  });

  it('omits the delete button when onDelete is not provided', () => {
    render(<Dashboard flows={[summary()]} activeFlowId="flow-1" onOpen={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
  });

  it('calls onDelete with the flow id after the user confirms', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <Dashboard
        flows={[summary({ id: 'flow-x', name: 'Weekly roundup' })]}
        activeFlowId="flow-x"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Weekly roundup' }));
    expect(onDelete).toHaveBeenCalledWith('flow-x');
  });

  it('does not call onDelete when the user cancels the confirm', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <Dashboard
        flows={[summary()]}
        activeFlowId="flow-1"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Daily digest' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('opens the flow (not delete) when the card body is clicked', () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <Dashboard
        flows={[summary({ id: 'flow-9', name: 'Card body' })]}
        activeFlowId="other"
        onOpen={onOpen}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByText('Card body'));
    expect(onOpen).toHaveBeenCalledWith('flow-9');
    expect(onDelete).not.toHaveBeenCalled();
  });
});
