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
  it('allows compatible social item ports and rejects incompatible artifact ports', () => {
    expect(
      canConnect({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'items',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: true });

    // Enrichment blocks emit SocialItem[] so their output can feed transforms/exports.
    expect(
      canConnect({
        sourceBlockType: 'twitter.tweetDetail',
        sourcePortId: 'items',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: true });

    expect(
      canConnect({
        sourceBlockType: 'output.exportJson',
        sourcePortId: 'artifact',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({
      valid: false,
      reason: 'FileArtifact cannot connect to SocialItem[]'
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

  it('reports an unknown upstream block for bindings without throwing', () => {
    const result = validateFlow({
      nodes: [
        { id: 'unknown', type: 'reddit.legacyRemoved', settings: {} },
        {
          id: 'detail',
          type: 'twitter.tweetDetail',
          settings: { tweetIdOrUrl: '', fullText: true, __bindings: { tweetIdOrUrl: 'author' } }
        }
      ],
      edges: [{ id: 'e1', source: 'unknown', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ nodeId: 'unknown', message: 'Unknown block type: reddit.legacyRemoved' });
  });

  it('rejects export paths whose extension does not match the output block type', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'reddit.searchPosts', settings: { query: 'cli', sort: 'relevance', timeRange: 'month', limit: 10 } },
        { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/payload.html', pretty: true } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'export', message: 'Path must end with .json' }
      ])
    );
  });

  it('rejects unsafe URL-like CLI settings and overlong text before execution', () => {
    const result = validateFlow({
      nodes: [
        {
          id: 'article',
          type: 'twitter.article',
          settings: { articleIdOrUrl: 'http://169.254.169.254/latest/meta-data/', format: 'json' }
        },
        {
          id: 'search',
          type: 'twitter.searchTweets',
          settings: { query: 'a'.repeat(4097), tab: 'latest', maxCount: 10 }
        }
      ],
      edges: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'article', message: 'Article ID or URL must be an X/Twitter URL or id' },
        { nodeId: 'search', message: 'Query must be at most 4096 characters' }
      ])
    );
  });

  it('exempts a user-bound required field and accepts a binding to a provided upstream field', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'latest', maxCount: 10 } },
        {
          id: 'article',
          type: 'twitter.article',
          settings: { articleIdOrUrl: '', format: 'json', __bindings: { articleIdOrUrl: 'url' } }
        }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'article', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('reports a dangling binding to a field no upstream node provides', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'latest', maxCount: 10 } },
        {
          id: 'article',
          type: 'twitter.article',
          settings: { articleIdOrUrl: '', format: 'json', __bindings: { articleIdOrUrl: 'community' } }
        }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'article', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { nodeId: 'article', message: 'Field "articleIdOrUrl" is bound to "community", which no upstream node provides' }
    ]);
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

  it('flags an unconnected webhook output as unreachable from a source', () => {
    const result = validateFlow({
      nodes: [{ id: 'hook', type: 'output.webhook', settings: { url: 'https://hooks.example.com/x', authTokenEnvVar: '' } }],
      edges: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      nodeId: 'hook',
      message: 'Output block is not reachable from a source'
    });
  });

  it('rejects a non-HTTPS webhook url via the field pattern', () => {
    const result = validateFlow({
      nodes: [
        starterNodes[0],
        { id: 'hook', type: 'output.webhook', settings: { url: 'http://hooks.example.com/x', authTokenEnvVar: '' } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'hook', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ nodeId: 'hook', message: 'URL has an invalid format' });
  });

  it('requires the webhook url', () => {
    const result = validateFlow({
      nodes: [
        starterNodes[0],
        { id: 'hook', type: 'output.webhook', settings: { url: '', authTokenEnvVar: '' } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'hook', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ nodeId: 'hook', message: 'URL is required' });
  });

  it('accepts a wired webhook output with a valid HTTPS url', () => {
    const result = validateFlow({
      nodes: [
        starterNodes[0],
        { id: 'hook', type: 'output.webhook', settings: { url: 'https://hooks.example.com/x', authTokenEnvVar: 'WEBHOOK_TOKEN' } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'hook', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(true);
  });

  it('accepts static enrichment blocks as standalone producers for outputs', () => {
    const cases = [
      {
        node: { id: 'detail', type: 'reddit.readPost', settings: { postId: 't3_abc123', expandMore: false } }
      },
      {
        node: { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '1234567890', fullText: true } }
      },
      {
        node: { id: 'detail', type: 'twitter.userProfile', settings: { handle: 'public_cli' } }
      },
      {
        node: { id: 'detail', type: 'twitter.article', settings: { articleIdOrUrl: '1234567890', format: 'json' } }
      }
    ];

    for (const { node } of cases) {
      expect(
        validateFlow({
          nodes: [
            node,
            { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/research.json', pretty: true } }
          ],
          edges: [{ id: 'e1', source: 'detail', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
        }),
        node.type
      ).toEqual({ valid: true, errors: [] });
    }
  });

  it('validates a flow whose write block is fed by a source', () => {
    const model = {
      id: 'f', name: 'F',
      nodes: [
        { id: 's', type: 'twitter.searchTweets', position: { x: 0, y: 0 }, settings: { query: 'x', tab: 'latest', maxCount: 10 } },
        { id: 'l', type: 'twitter.like', position: { x: 0, y: 0 }, settings: { tweetId: '' } }
      ],
      edges: [{ id: 'e', source: 's', target: 'l', sourcePortId: 'items', targetPortId: 'items' }]
    };
    expect(validateFlow(model as any).valid).toBe(true);
  });

  it('blocks a write block missing its required literal field with no upstream', () => {
    const model = {
      id: 'f', name: 'F',
      nodes: [{ id: 'p', type: 'twitter.post', position: { x: 0, y: 0 }, settings: { text: '' } }],
      edges: []
    };
    expect(validateFlow(model as any).valid).toBe(false);
  });

  it('accepts static enrichment blocks through a transform chain', () => {
    expect(
      validateFlow({
        nodes: [
          { id: 'detail', type: 'twitter.article', settings: { articleIdOrUrl: '1234567890', format: 'json' } },
          { id: 'filter', type: 'transform.filterText', settings: { include: 'automation', exclude: '' } },
          { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/research.json', pretty: true } }
        ],
        edges: [
          { id: 'e1', source: 'detail', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
          { id: 'e2', source: 'filter', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
        ]
      })
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects standalone enrichment output when its producer lacks a static id', () => {
    const result = validateFlow({
      nodes: [
        { id: 'detail', type: 'twitter.article', settings: { articleIdOrUrl: '', format: 'json' } },
        { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/research.json', pretty: true } }
      ],
      edges: [{ id: 'e1', source: 'detail', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { nodeId: 'detail', message: 'Article ID or URL is required' },
        { nodeId: 'export', message: 'Output block is not reachable from a source' }
      ])
    );
  });

  it('rejects bindings to non-scalar upstream fields', () => {
    const result = validateFlow({
      nodes: [
        { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'latest', maxCount: 10 } },
        {
          id: 'detail',
          type: 'twitter.tweetDetail',
          settings: { tweetIdOrUrl: '', fullText: true, __bindings: { tweetIdOrUrl: 'media' } }
        }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { nodeId: 'detail', message: 'Field "tweetIdOrUrl" is bound to "media", which no upstream node provides' }
    ]);
  });
});
