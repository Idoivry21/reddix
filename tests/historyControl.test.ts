import { describe, expect, it } from 'vitest';
import type { NodeChange } from '@xyflow/react';
import { historyDecision } from '../src/historyControl';

const move = (dragging: boolean): NodeChange =>
  ({ type: 'position', id: 'n1', position: { x: 0, y: 0 }, dragging }) as NodeChange;

describe('historyDecision', () => {
  it('snapshots once at the start of a drag, not on every frame', () => {
    let dragging = false;

    const start = historyDecision([move(true)], dragging);
    expect(start.snapshot).toBe(true);
    dragging = start.dragging;

    const middle = historyDecision([move(true)], dragging);
    expect(middle.snapshot).toBe(false);
    dragging = middle.dragging;

    const end = historyDecision([move(false)], dragging);
    expect(end.snapshot).toBe(false);
    expect(end.dragging).toBe(false);
  });

  it('snapshots structural changes immediately', () => {
    expect(historyDecision([{ type: 'remove', id: 'n1' }], false).snapshot).toBe(true);
    expect(historyDecision([{ type: 'add', item: {} } as NodeChange], false).snapshot).toBe(true);
  });

  it('never snapshots selection or dimension changes', () => {
    expect(historyDecision([{ type: 'select', id: 'n1', selected: true }], false).snapshot).toBe(false);
    expect(
      historyDecision(
        [{ type: 'dimensions', id: 'n1', dimensions: { width: 10, height: 10 } } as NodeChange],
        false
      ).snapshot
    ).toBe(false);
  });
});
