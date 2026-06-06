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
});

