import { describe, expect, it } from 'vitest';
import {
  distanceToEdge,
  edgePath,
  findSpliceTarget,
  nodePorts,
  portFrac,
  resolveSplicePorts,
  SPLICE_DISTANCE_THRESHOLD
} from '../src/canvasGeometry';
import { getBlockSpec } from '../src/shared/commandBuilders';
import type { WorkbenchEdge, WorkbenchNode } from '../src/flowTypes';

function makeNode(id: string, blockType: string, x: number, y: number): WorkbenchNode {
  return { id, blockType, label: id, x, y, settings: {}, status: 'idle' };
}

describe('portFrac', () => {
  it('spaces a single port at the vertical center', () => {
    expect(portFrac(0, 1)).toBe(0.5);
  });

  it('evenly distributes multiple ports', () => {
    expect(portFrac(0, 2)).toBeCloseTo(1 / 3);
    expect(portFrac(1, 2)).toBeCloseTo(2 / 3);
  });
});

describe('nodePorts', () => {
  const node: WorkbenchNode = {
    id: 'filter',
    blockType: 'transform.filterText',
    label: 'Filter Text',
    x: 100,
    y: 200,
    settings: {},
    status: 'idle'
  };

  it('places the input port on the left edge and output on the right', () => {
    const geometry = nodePorts(node, getBlockSpec(node.blockType), { w: 232, h: 120 });
    expect(geometry.ins[0]).toMatchObject({ x: 100, id: 'items' });
    expect(geometry.outs[0]).toMatchObject({ x: 332, id: 'items' });
    expect(geometry.ins[0].y).toBe(200 + 120 * 0.5);
  });

  it('returns no input ports for a source block', () => {
    const source: WorkbenchNode = { ...node, blockType: 'reddit.searchPosts' };
    const geometry = nodePorts(source, getBlockSpec(source.blockType));
    expect(geometry.ins).toHaveLength(0);
    expect(geometry.outs).toHaveLength(1);
  });
});

describe('edgePath', () => {
  it('builds a bezier path between two points', () => {
    const path = edgePath(0, 0, 100, 50);
    expect(path.startsWith('M 0 0 C')).toBe(true);
    expect(path).toContain('100 50');
  });
});

describe('distanceToEdge', () => {
  it('is ~0 for a point on a straight horizontal edge', () => {
    // Edge (0,0)→(200,0) is flat; its sampled midpoint is (100,0).
    expect(distanceToEdge({ x: 100, y: 0 }, 0, 0, 200, 0)).toBeLessThan(1);
  });

  it('returns the perpendicular offset for a point off a straight edge', () => {
    expect(distanceToEdge({ x: 100, y: 50 }, 0, 0, 200, 0)).toBeCloseTo(50, 0);
  });

  it('returns a large distance for a point far from a bowed edge', () => {
    // Vertical edge (0,0)→(0,200); a point 200px to the side is nowhere near it.
    expect(distanceToEdge({ x: 200, y: 100 }, 0, 0, 0, 200)).toBeGreaterThan(100);
  });
});

describe('resolveSplicePorts', () => {
  it('resolves matching SocialItem[] ports for a transform node', () => {
    expect(
      resolveSplicePorts({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        nodeBlockType: 'transform.limit',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ inPortId: 'items', outPortId: 'items' });
  });

  it('rejects a pure Source node (no input port)', () => {
    expect(
      resolveSplicePorts({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        nodeBlockType: 'reddit.searchPosts',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toBeNull();
  });

  it('rejects a node whose only output is type-incompatible with the target', () => {
    // Export blocks emit a FileArtifact, which cannot feed a SocialItem[] input.
    expect(
      resolveSplicePorts({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        nodeBlockType: 'output.exportJson',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toBeNull();
  });
});

describe('findSpliceTarget', () => {
  // src out 'items' → (232,60); tgt in 'items' → (400,60); curve midpoint (316,60).
  const src = makeNode('src', 'reddit.searchPosts', 0, 0);
  const tgt = makeNode('tgt', 'transform.filterText', 400, 0);
  const e1: WorkbenchEdge = { id: 'e1', source: 'src', target: 'tgt', sourcePortId: 'items', targetPortId: 'items' };

  it('returns the id of an edge whose curve is within threshold of a compatible node', () => {
    const limit = makeNode('limit', 'transform.limit', 0, 0);
    const result = findSpliceTarget(limit, { x: 316, y: 60 }, [e1], { nodes: [src, tgt, limit], sizes: {} });
    expect(result).toBe('e1');
  });

  it('returns null when the node center is beyond the distance threshold', () => {
    const limit = makeNode('limit', 'transform.limit', 0, 0);
    const far = SPLICE_DISTANCE_THRESHOLD + 100;
    const result = findSpliceTarget(limit, { x: 316, y: 60 + far }, [e1], { nodes: [src, tgt, limit], sizes: {} });
    expect(result).toBeNull();
  });

  it('picks the nearest edge when several qualify', () => {
    // e2 sits a little lower (midpoint y=85) than e1 (y=60).
    const src2 = makeNode('src2', 'reddit.searchPosts', 0, 25);
    const tgt2 = makeNode('tgt2', 'transform.filterText', 400, 25);
    const e2: WorkbenchEdge = { id: 'e2', source: 'src2', target: 'tgt2', sourcePortId: 'items', targetPortId: 'items' };
    const limit = makeNode('limit', 'transform.limit', 0, 0);
    // center y=70 → 10px from e1, 15px from e2 → e1 wins.
    const result = findSpliceTarget(limit, { x: 316, y: 70 }, [e1, e2], {
      nodes: [src, tgt, src2, tgt2, limit],
      sizes: {}
    });
    expect(result).toBe('e1');
  });

  it('excludes an edge whose own source or target is the dragged node', () => {
    // Dragging tgt itself over e1 (which ends at tgt) must not splice tgt into it.
    const result = findSpliceTarget(tgt, { x: 316, y: 60 }, [e1], { nodes: [src, tgt], sizes: {} });
    expect(result).toBeNull();
  });

  it('rejects a port-incompatible node even when geometrically close', () => {
    // Export block: input ok, but FileArtifact output cannot feed tgt's SocialItem[] input.
    const exporter = makeNode('exp', 'output.exportJson', 0, 0);
    const result = findSpliceTarget(exporter, { x: 316, y: 60 }, [e1], { nodes: [src, tgt, exporter], sizes: {} });
    expect(result).toBeNull();
  });

  it('rejects a pure Source node dropped on an edge', () => {
    const lonelySource = makeNode('src3', 'reddit.searchPosts', 0, 0);
    const result = findSpliceTarget(lonelySource, { x: 316, y: 60 }, [e1], {
      nodes: [src, tgt, lonelySource],
      sizes: {}
    });
    expect(result).toBeNull();
  });
});
