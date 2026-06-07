import { describe, expect, it } from 'vitest';
import { parseFlowPutBody, parseRunPostBody } from '../server/schemas';

describe('parseFlowPutBody', () => {
  it('accepts a well-formed flow body', () => {
    const result = parseFlowPutBody({
      flow: {
        name: 'My Flow',
        failFast: true,
        nodes: [{ id: 'n1', type: 'reddit.search', settings: { query: 'cats' } }],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', sourcePortId: 'out', targetPortId: 'in' }
        ],
        nodePositions: { n1: { x: 10, y: 20 } },
        blockSettings: { n1: { query: 'cats' } },
        schedule: { enabled: true, intervalMs: 900000, paused: false, nextRunAt: null }
      }
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flow.name).toBe('My Flow');
    }
  });

  it('defaults missing optional collections', () => {
    const result = parseFlowPutBody({ flow: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flow.nodes).toEqual([]);
      expect(result.data.flow.edges).toEqual([]);
      expect(result.data.flow.schedule).toEqual({ enabled: false });
    }
  });

  it('rejects a missing flow object', () => {
    expect(parseFlowPutBody({}).success).toBe(false);
    expect(parseFlowPutBody(null).success).toBe(false);
    expect(parseFlowPutBody('nope').success).toBe(false);
  });

  it('rejects malformed nodes', () => {
    expect(parseFlowPutBody({ flow: { nodes: [{ id: 'n1' }] } }).success).toBe(false);
    expect(parseFlowPutBody({ flow: { nodes: 'not-array' } }).success).toBe(false);
  });

  it('rejects overlong node and edge ids', () => {
    const longId = 'x'.repeat(201);

    expect(
      parseFlowPutBody({ flow: { nodes: [{ id: longId, type: 'utility.note', settings: {} }] } }).success
    ).toBe(false);
    expect(
      parseFlowPutBody({
        flow: {
          edges: [{ id: longId, source: 'a', target: 'b', sourcePortId: 'out', targetPortId: 'in' }]
        }
      }).success
    ).toBe(false);
  });

  it('rejects excessive node and edge counts', () => {
    const nodes = Array.from({ length: 501 }, (_unused, index) => ({
      id: `n-${index}`,
      type: 'utility.note',
      settings: {}
    }));
    const edges = Array.from({ length: 1001 }, (_unused, index) => ({
      id: `e-${index}`,
      source: 'a',
      target: 'b',
      sourcePortId: 'out',
      targetPortId: 'in'
    }));

    expect(parseFlowPutBody({ flow: { nodes } }).success).toBe(false);
    expect(parseFlowPutBody({ flow: { edges } }).success).toBe(false);
  });

  it('rejects malformed edges', () => {
    expect(
      parseFlowPutBody({ flow: { edges: [{ id: 'e1', source: 'n1' }] } }).success
    ).toBe(false);
  });

  it('rejects malformed schedule', () => {
    expect(
      parseFlowPutBody({ flow: { schedule: { enabled: 'yes' } } }).success
    ).toBe(false);
    expect(
      parseFlowPutBody({ flow: { schedule: { enabled: true, intervalMs: -5 } } }).success
    ).toBe(false);
  });

  it('rejects malformed node positions', () => {
    expect(
      parseFlowPutBody({ flow: { nodePositions: { n1: { x: 'a', y: 1 } } } }).success
    ).toBe(false);
  });
});

describe('parseRunPostBody', () => {
  it('accepts a safe flow id', () => {
    const result = parseRunPostBody({ flowId: 'primary-flow' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flowId).toBe('primary-flow');
    }
  });

  it('rejects a missing or unsafe flow id', () => {
    expect(parseRunPostBody({}).success).toBe(false);
    expect(parseRunPostBody({ flowId: '' }).success).toBe(false);
    expect(parseRunPostBody({ flowId: '../escape' }).success).toBe(false);
    expect(parseRunPostBody({ flowId: 42 }).success).toBe(false);
  });
});
