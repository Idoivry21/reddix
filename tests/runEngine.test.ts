import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import type { FlowDefinition } from '../server/types';

describe('run engine', () => {
  it('executes a valid source-transform-output flow with a fake executor', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          data: [
            {
              id: 'abc',
              title: 'CLI automation',
              selftext: 'local export',
              created_utc: 1716500000,
              score: 8
            }
          ]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(result.steps.map((step) => step.status)).toEqual(['success', 'success', 'success']);
    expect(result.outputFiles[0].path).toBe('outputs/reddit-20260601-100000.json');
  });

  it('continues unrelated branches after a source failure and skips dependents', async () => {
    const flow: FlowDefinition = {
      id: 'two-branch',
      name: 'Two Branch',
      failFast: false,
      nodes: [
        ...starterFlow().nodes,
        {
          id: 'twitter-search',
          type: 'twitter.searchTweets',
          settings: { query: 'cli', tab: 'latest', maxCount: 5 }
        },
        { id: 'csv', type: 'output.exportCsv', settings: { path: 'outputs/tweets.csv' } }
      ],
      edges: [
        ...starterFlow().edges,
        {
          id: 'e-twitter',
          source: 'twitter-search',
          target: 'csv',
          sourcePortId: 'items',
          targetPortId: 'items'
        }
      ]
    };

    const result = await runFlow({
      flow,
      executor: async (command) => {
        if (command.provider === 'reddit') {
          return { stdout: '', stderr: 'not found', exitCode: 1 };
        }
        return {
          stdout: JSON.stringify({ data: [{ id: 'tw1', text: 'healthy branch', created_at: '2026-01-01T00:00:00Z' }] }),
          stderr: '',
          exitCode: 0
        };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'filter')?.status).toBe('skipped');
    expect(result.steps.find((step) => step.blockId === 'csv')?.status).toBe('success');
  });
});

function starterFlow(): FlowDefinition {
  return {
    id: 'flow-1',
    name: 'Starter',
    failFast: false,
    nodes: [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      { id: 'filter', type: 'transform.filterText', settings: { include: 'automation' } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/reddit.json', pretty: true } }
    ],
    edges: [
      { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
      { id: 'e2', source: 'filter', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
    ]
  };
}

