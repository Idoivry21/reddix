import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import { MAX_NODE_OUTPUT_ITEMS } from '../src/shared/runLimits';
import type { FlowDefinition } from '../server/types';

// Every node must cap its output at MAX_NODE_OUTPUT_ITEMS, not just fan-out
// (finding #18). Overflow is counted as skipped, never silently dropped.

function redditItems(count: number, idPrefix: string): string {
  const data = Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}${i}`,
    title: `automation ${i}`,
    created_utc: 1716500000,
    score: 1
  }));
  return JSON.stringify({ data });
}

function source(id: string, idPrefix: string): FlowDefinition['nodes'][number] {
  return {
    id,
    type: 'reddit.searchPosts',
    settings: { query: idPrefix, subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
  };
}

describe('run engine — node output ceiling (finding #18)', () => {
  it('caps a single CLI source output and counts the overflow as skipped', async () => {
    const run = await runFlow({
      flow: {
        id: 'cap-flow',
        name: 'Cap Flow',
        failFast: false,
        nodes: [source('search', 'a')],
        edges: []
      },
      executor: async () => ({ stdout: redditItems(MAX_NODE_OUTPUT_ITEMS + 5, 'a'), stderr: '', exitCode: 0 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z')
    });

    const step = run.steps.find((s) => s.blockId === 'search');
    expect(step?.io?.outputCount).toBe(MAX_NODE_OUTPUT_ITEMS);
    expect(step?.io?.skippedCount).toBe(5);
  });

  it('caps a fan-in merge node output and surfaces the dropped overflow', async () => {
    const run = await runFlow({
      flow: {
        id: 'merge-flow',
        name: 'Merge Flow',
        failFast: false,
        nodes: [source('s1', 'a'), source('s2', 'b'), { id: 'merge', type: 'transform.mergeStreams', settings: {} }],
        edges: [
          { id: 'e1', source: 's1', target: 'merge', sourcePortId: 'items', targetPortId: 'items' },
          { id: 'e2', source: 's2', target: 'merge', sourcePortId: 'items', targetPortId: 'items' }
        ]
      },
      // Each source returns exactly the cap; merged fan-in is 2x cap → must truncate.
      executor: async (command) => ({
        stdout: redditItems(MAX_NODE_OUTPUT_ITEMS, command.argv.includes('a') ? 'a' : 'b'),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z')
    });

    const merge = run.steps.find((s) => s.blockId === 'merge');
    expect(merge?.io?.outputCount).toBe(MAX_NODE_OUTPUT_ITEMS);
    expect(merge?.io?.skippedCount).toBe(MAX_NODE_OUTPUT_ITEMS);
  });
});
