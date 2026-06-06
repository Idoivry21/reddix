import { describe, expect, it } from 'vitest';
import { toFlowModel, toFlowRequestBody } from '../src/flowSerialization';
import type { WorkbenchEdge, WorkbenchNode } from '../src/flowTypes';

function node(id: string, blockType: string, settings: Record<string, unknown>, x: number, y: number): WorkbenchNode {
  return { id, blockType, label: id, x, y, settings, status: 'idle' };
}

const nodes: WorkbenchNode[] = [
  node('search', 'reddit.searchPosts', { query: 'cli', limit: 25 }, 80, 90),
  node('export', 'output.exportJson', { path: 'outputs/export.json' }, 400, 90)
];

const edges: WorkbenchEdge[] = [
  { id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
];

describe('toFlowModel', () => {
  it('maps canvas nodes to flow node models', () => {
    const model = toFlowModel(nodes, edges);

    expect(model.nodes).toEqual([
      { id: 'search', type: 'reddit.searchPosts', settings: { query: 'cli', limit: 25 } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/export.json' } }
    ]);
  });

  it('maps canvas edges to port ids', () => {
    const model = toFlowModel(nodes, edges);

    expect(model.edges).toEqual([
      { id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
    ]);
  });

  it('falls back to empty port ids when handles are missing', () => {
    const model = toFlowModel(nodes, [
      { id: 'e2', source: 'search', target: 'export' } as unknown as WorkbenchEdge
    ]);

    expect(model.edges[0]).toMatchObject({ sourcePortId: '', targetPortId: '' });
  });
});

describe('toFlowRequestBody', () => {
  it('builds a PUT body with positions and settings keyed by node id', () => {
    const body = toFlowRequestBody(nodes, edges, { flowId: 'primary', name: 'My Flow', failFast: true });

    expect(body.flow.id).toBe('primary');
    expect(body.flow.name).toBe('My Flow');
    expect(body.flow.failFast).toBe(true);
    expect(body.flow.nodePositions).toEqual({
      search: { x: 80, y: 90 },
      export: { x: 400, y: 90 }
    });
    expect(body.flow.blockSettings).toEqual({
      search: { query: 'cli', limit: 25 },
      export: { path: 'outputs/export.json' }
    });
    expect(body.flow.nodes).toHaveLength(2);
    expect(body.flow.edges).toHaveLength(1);
    expect(body.flow.schedule).toEqual({ enabled: false });
  });

  it('carries a provided schedule', () => {
    const body = toFlowRequestBody(nodes, edges, { flowId: 'primary', name: 'My Flow', failFast: false }, {
      enabled: true,
      intervalMs: 3_600_000
    });
    expect(body.flow.schedule).toEqual({ enabled: true, intervalMs: 3_600_000 });
  });
});
