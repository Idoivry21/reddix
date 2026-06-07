import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../src/components/Canvas';
import type { CanvasView, WorkbenchEdge, WorkbenchNode } from '../src/flowTypes';

function makeNode(id: string, blockType: string, x: number, y: number): WorkbenchNode {
  return { id, blockType, label: id, x, y, settings: {}, status: 'idle' };
}

// jsdom's PointerEvent ignores clientX/clientY; a MouseEvent of the same type
// carries the coordinates the drag handlers read, and matching listeners fire.
function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, x: number, y: number): void {
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
}

// src out 'items' → (232,60); tgt in 'items' → (400,60); curve midpoint (316,60).
// mid is dragged; its default 232×120 size puts its center 116/60 off its origin.
const SRC = makeNode('src', 'reddit.searchPosts', 0, 0);
const TGT = makeNode('tgt', 'transform.filterText', 400, 0);
const MID = makeNode('mid', 'transform.limit', 0, 0);
const EDGE: WorkbenchEdge = { id: 'edge-1', source: 'src', target: 'tgt', sourcePortId: 'items', targetPortId: 'items' };
const VIEW: CanvasView = { x: 0, y: 0, k: 1 };

function renderCanvas(overrides: Partial<React.ComponentProps<typeof Canvas>> = {}) {
  const props: React.ComponentProps<typeof Canvas> = {
    nodes: [SRC, TGT, MID],
    edges: [EDGE],
    view: VIEW,
    setView: vi.fn(),
    sizes: {},
    onMeasure: vi.fn(),
    selectedNodeId: null,
    selectedEdgeId: null,
    onSelectNode: vi.fn(),
    onSelectEdge: vi.fn(),
    onMoveNode: vi.fn(),
    onConnect: vi.fn(),
    onDeleteEdge: vi.fn(),
    onSpliceNode: vi.fn(),
    onDropBlock: vi.fn(),
    onPaneClick: vi.fn(),
    onFit: vi.fn(),
    onAddBlock: vi.fn(),
    dragType: null,
    ...overrides
  };
  return { props, ...render(<Canvas {...props} />) };
}

beforeEach(() => {
  // jsdom has no layout: pin the canvas rect to the origin so toCanvas() maps
  // client coords 1:1 to canvas coords (view is identity).
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Canvas edge delete glyph', () => {
  it('invokes onDeleteEdge when the midpoint delete glyph is pressed', () => {
    const onDeleteEdge = vi.fn();
    const { container } = renderCanvas({ selectedEdgeId: 'edge-1', onDeleteEdge });

    const glyph = container.querySelector('.edge-del');
    expect(glyph).not.toBeNull();
    fireEvent.pointerDown(glyph!);

    expect(onDeleteEdge).toHaveBeenCalledWith('edge-1');
  });
});

describe('Canvas node-into-edge splice', () => {
  function startDraggingMid(container: HTMLElement): void {
    const handle = container.querySelector('[data-role="drag"][data-id="mid"]');
    expect(handle).not.toBeNull();
    // Press at mid's center so the drag offset is exactly half its default size.
    firePointer('pointerdown', handle!, 116, 60);
  }

  it('highlights an edge as a splice target while dragging a compatible node over it', () => {
    const { container } = renderCanvas();
    startDraggingMid(container);

    firePointer('pointermove', window, 316, 60);

    expect(container.querySelector('.edge.splice-target')).not.toBeNull();
  });

  it('calls onSpliceNode with the dragged node and highlighted edge on drop', () => {
    const onSpliceNode = vi.fn();
    const { container } = renderCanvas({ onSpliceNode });
    startDraggingMid(container);

    firePointer('pointermove', window, 316, 60);
    firePointer('pointerup', window, 316, 60);

    expect(onSpliceNode).toHaveBeenCalledWith('mid', 'edge-1');
  });

  it('performs a plain move with no splice when not dropped over a candidate edge', () => {
    const onSpliceNode = vi.fn();
    const { container } = renderCanvas({ onSpliceNode });
    startDraggingMid(container);

    firePointer('pointermove', window, 316, 600);
    expect(container.querySelector('.edge.splice-target')).toBeNull();

    firePointer('pointerup', window, 316, 600);
    expect(onSpliceNode).not.toHaveBeenCalled();
  });
});
