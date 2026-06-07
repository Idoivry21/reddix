import { describe, expect, it } from 'vitest';
import { canConnect, validateFlow } from '../src/shared/graph';

const starterNodes = [
  {
    id: 'search',
    type: 'reddit.searchPosts',
    settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
  },
  {
    id: 'filter',
    type: 'transform.filterText',
    settings: { include: 'automation', exclude: '' }
  },
  {
    id: 'export',
    type: 'output.exportJson',
    settings: { path: 'outputs/reddit.json', pretty: true }
  }
];

describe('graph validation', () => {
  it('allows compatible social item ports and rejects incompatible detail ports', () => {
    expect(
      canConnect({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: true });

    expect(
      canConnect({
        sourceBlockType: 'twitter.tweetDetail',
        sourcePortId: 'detail',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({
      valid: false,
      reason: 'DetailObject cannot connect to SocialItem[]'
    });
  });

  it('validates a starter flow', () => {
    expect(
      validateFlow({
        nodes: starterNodes,
        edges: [
          { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
          { id: 'e2', source: 'filter', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
        ]
      })
    ).toEqual({ valid: true, errors: [] });
  });

  it('reports missing required settings, cycles, and unreachable outputs', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: '' } },
        { id: 'filter', type: 'transform.filterText', settings: {} },
        { id: 'export', type: 'output.exportJson', settings: { path: '' } }
      ],
      edges: [
        { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
        { id: 'e2', source: 'filter', target: 'search', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'search', message: 'Query is required' },
        { nodeId: 'export', message: 'Path is required' },
        { nodeId: 'flow', message: 'Graph contains a cycle' },
        { nodeId: 'export', message: 'Output block is not reachable from a source' }
      ])
    );
  });

  it('reports unknown block types and invalid setting values without throwing', () => {
    const result = validateFlow({
      nodes: [
        { id: 'unknown', type: 'reddit.search', settings: {} },
        {
          id: 'search',
          type: 'reddit.searchPosts',
          settings: { query: '--proxy http://evil.example', sort: 'invalid', timeRange: 'month', limit: 10 }
        }
      ],
      edges: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'unknown', message: 'Unknown block type: reddit.search' },
        { nodeId: 'search', message: 'Query cannot start with "-"' },
        { nodeId: 'search', message: 'Sort must be one of: relevance, hot, top, new, comments' }
      ])
    );
  });

  it('validates a deep acyclic graph without recursive stack overflow', () => {
    const nodes = Array.from({ length: 6000 }, (_unused, index) => ({
      id: `n-${index}`,
      type: index === 0 ? 'reddit.searchPosts' : 'transform.filterText',
      settings:
        index === 0
          ? { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
          : {}
    }));
    const edges = nodes.slice(1).map((node, index) => ({
      id: `e-${index}`,
      source: `n-${index}`,
      target: node.id,
      sourcePortId: 'items',
      targetPortId: 'items'
    }));

    expect(validateFlow({ nodes, edges }).valid).toBe(true);
  });
});
