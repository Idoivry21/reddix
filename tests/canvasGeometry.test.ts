import { describe, expect, it } from 'vitest';
import { edgePath, nodePorts, portFrac } from '../src/canvasGeometry';
import { getBlockSpec } from '../src/shared/commandBuilders';
import type { WorkbenchNode } from '../src/flowTypes';

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
