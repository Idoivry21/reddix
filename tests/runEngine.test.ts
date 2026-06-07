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

  it('surfaces the CLI envelope error message when a step fails with ok:false on stdout', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          ok: false,
          schema_version: '1',
          error: { code: 'forbidden', message: 'Search failed: Access forbidden: Resource' }
        }),
        stderr: '',
        exitCode: 1
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    const searchStep = result.steps.find((step) => step.blockId === 'search');
    expect(searchStep?.status).toBe('failed');
    expect(searchStep?.error).toBe('Search failed: Access forbidden: Resource (forbidden)');
  });

  it('treats ok:false as a failure even when the CLI exits 0', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({ ok: false, error: { message: 'rate limited' } }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'search')?.error).toBe('rate limited');
  });

  it('writes a self-contained HTML report artifact and threads the flow name into it', async () => {
    const written: Array<{ path: string; contents: string }> = [];
    const flow: FlowDefinition = {
      id: 'flow-html',
      name: 'Weekly Digest',
      failFast: false,
      nodes: [
        {
          id: 'search',
          type: 'reddit.searchPosts',
          settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
        },
        { id: 'report', type: 'output.exportHtml', settings: { path: 'outputs/report.html' } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'report', sourcePortId: 'items', targetPortId: 'items' }]
    };

    const result = await runFlow({
      flow,
      executor: async () => ({
        stdout: JSON.stringify({ data: [{ id: 'abc', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => {
        written.push({ path: filePath, contents });
        return { path: filePath, bytes: contents.length };
      },
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    const htmlFiles = result.outputFiles.filter((file) => file.path.endsWith('.html'));
    expect(htmlFiles).toHaveLength(1);
    expect(htmlFiles[0].path).toBe('outputs/report-20260601-100000.html');
    const report = written.find((file) => file.path.endsWith('.html'));
    expect(report?.contents.toLowerCase()).toContain('<!doctype html>');
    expect(report?.contents).toContain('Weekly Digest');
    expect(report?.contents).toContain('CLI automation');
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

  it('skips a deep downstream chain after a failed source without stack overflow', async () => {
    const transformNodes = Array.from({ length: 6000 }, (_unused, index) => ({
      id: `filter-${index}`,
      type: 'transform.filterText',
      settings: {}
    }));
    const nodes = [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      ...transformNodes
    ];
    const edges = transformNodes.map((node, index) => ({
      id: `e-${index}`,
      source: index === 0 ? 'search' : `filter-${index - 1}`,
      target: node.id,
      sourcePortId: 'items',
      targetPortId: 'items'
    }));

    const result = await runFlow({
      flow: { id: 'deep', name: 'Deep', failFast: false, nodes, edges },
      executor: async () => ({ stdout: '', stderr: 'failed', exitCode: 1 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.at(-1)?.status).toBe('skipped');
  });

  it('carries a projected sample of produced items on the run', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          data: [{ id: 'abc', title: 'CLI automation', selftext: 'x', created_utc: 1716500000, score: 8, author: 'alice' }]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sample).toBeDefined();
    expect(result.sample).toHaveLength(1);
    expect(result.sample?.[0]).toMatchObject({ kind: 'reddit', id: 'abc', title: 'CLI automation', score: 8 });
  });

  it('caps the run sample at 50 rows', async () => {
    const data = Array.from({ length: 60 }, (_unused, index) => ({
      id: `r${index}`,
      title: `automation ${index}`,
      created_utc: 1716500000,
      score: index
    }));
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({ stdout: JSON.stringify({ data }), stderr: '', exitCode: 0 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sample).toHaveLength(50);
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
