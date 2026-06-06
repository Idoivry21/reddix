import type { NodeChange } from '@xyflow/react';

export interface HistoryDecision {
  /** Whether to push a pre-change snapshot onto the undo stack now. */
  snapshot: boolean;
  /** The drag-in-progress flag to carry into the next change batch. */
  dragging: boolean;
}

/**
 * Decide whether a batch of node changes should snapshot history.
 *
 * - Structural changes (add/remove/replace) snapshot immediately.
 * - A drag snapshots exactly once, on its first moving frame, so undo restores
 *   the pre-drag position in a single step instead of unwinding frame-by-frame.
 * - Pure selection and dimension-measurement changes never snapshot.
 */
export function historyDecision(changes: NodeChange[], wasDragging: boolean): HistoryDecision {
  const isStructural = changes.some(
    (change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace'
  );
  const positionChanges = changes.filter(
    (change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position'
  );
  const isMoving = positionChanges.some((change) => change.dragging === true);
  const isDragEnd = positionChanges.some((change) => change.dragging === false);

  if (isStructural) {
    return { snapshot: true, dragging: false };
  }
  if (isMoving && !wasDragging) {
    return { snapshot: true, dragging: true };
  }
  if (isMoving) {
    return { snapshot: false, dragging: true };
  }
  if (isDragEnd) {
    return { snapshot: false, dragging: false };
  }
  return { snapshot: false, dragging: wasDragging };
}
