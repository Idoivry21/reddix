import { describe, expect, it, vi } from 'vitest';
import { runSingleNode } from '../server/runEngine';
import { computeFlowGraphHash } from '../server/flowHash';
import type { FlowDefinition, RunRecord } from '../server/types';
import type { RunStepSampleItem } from '../src/shared/types';

const NOW = () => new Date('2026-06-01T10:00:00Z');

describe('runSingleNode', () => {
  it('runs a source node in static mode and returns a one-step, ephemeral-tagged record', async () => {
    const run = await runSingleNode({
      flow: sourceFlow(),
      nodeId: 'search',
      mode: 'static',
      executor: async () => ({
        stdout: JSON.stringify({ data: [{ id: 'a', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
        stderr: '',
        exitCode: 0
      }),
      now: NOW
    });

    expect(run.status).toBe('success');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].blockId).toBe('search');
    expect(run.steps[0].io?.outputCount).toBe(1);
    expect(run.outputFiles).toEqual([]);
    expect(run.trigger).toEqual({ kind: 'single-node', nodeId: 'search', mode: 'static' });
    expect(run.sample?.[0]?.id).toBe('a');
  });

  it('fails cleanly when a blank-bound enrichment node runs static with no upstream value', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'static',
      executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('failed');
    expect(run.steps[0].status).toBe('failed');
    expect(typeof run.steps[0].error).toBe('string');
  });

  it('feeds cached upstream samples into a fan-out enrichment node', async () => {
    const detailIds: string[] = [];
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'cached-upstream',
      priorRun: priorRunWith([tweetSample('111'), tweetSample('222')]),
      executor: async (command) => {
        detailIds.push(command.argv[1]);
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      now: NOW
    });

    expect(run.status).toBe('success');
    expect(detailIds).toEqual(['111', '222']);
    expect(run.steps[0].io).toMatchObject({ outputCount: 2, skippedCount: 0 });
    expect(run.trigger?.mode).toBe('cached-upstream');
  });

  it('counts a wrong-platform cached item as skipped, not failed', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'cached-upstream',
      priorRun: priorRunWith([redditSample('r1'), tweetSample('111'), tweetSample('222')]),
      executor: async (command) => ({ stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('success');
    expect(run.steps[0].io?.outputCount).toBe(2);
    expect(run.steps[0].io?.skippedCount).toBeGreaterThanOrEqual(1);
  });

  it('fails when cached-upstream mode has no previous full run', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'cached-upstream',
      priorRun: null,
      executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('No previous full run');
  });

  it('rejects cached-upstream when the cached run was tagged for a different flow version', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'cached-upstream',
      // A full run whose flow hash does not match the current flow (e.g. the
      // upstream search query was edited after this run was cached).
      priorRun: { ...priorRunWith([tweetSample('111')]), flowGraphHash: 'stale-flow-hash' },
      executor: async (command) => ({ stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/changed|run the full flow/i);
  });

  it('accepts cached-upstream when the cached run matches the current flow version', async () => {
    const flow = detailFlow();
    const run = await runSingleNode({
      flow,
      nodeId: 'detail',
      mode: 'cached-upstream',
      priorRun: { ...priorRunWith([tweetSample('111')]), flowGraphHash: computeFlowGraphHash(flow) },
      executor: async (command) => ({ stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('success');
    expect(run.steps[0].io?.outputCount).toBe(1);
  });

  it('fails when the upstream node has no cached output (old record)', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'detail',
      mode: 'cached-upstream',
      priorRun: priorRunWithoutIo(),
      executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('no cached output');
  });

  it('does not write an artifact when running an output node in isolation', async () => {
    const executor = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const run = await runSingleNode({
      flow: exportFlow(),
      nodeId: 'export',
      mode: 'cached-upstream',
      priorRun: priorRunWith([tweetSample('111')]),
      executor,
      now: NOW
    });

    expect(run.status).toBe('success');
    expect(run.outputFiles).toEqual([]);
    expect(run.steps[0].io?.outputCount).toBe(1);
    // An output node is local — it must never spawn a CLI.
    expect(executor).not.toHaveBeenCalled();
  });

  it('returns a failed record when the node id is not in the flow', async () => {
    const run = await runSingleNode({
      flow: detailFlow(),
      nodeId: 'missing',
      mode: 'static',
      executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      now: NOW
    });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('not found');
  });
});

function sourceFlow(): FlowDefinition {
  return {
    id: 'snf',
    name: 'Single Node Flow',
    failFast: false,
    nodes: [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      }
    ],
    edges: []
  };
}

function detailFlow(): FlowDefinition {
  return {
    id: 'snf',
    name: 'Single Node Flow',
    failFast: false,
    nodes: [
      { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'top', maxCount: 10, fullText: true } },
      { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '', fullText: true } }
    ],
    edges: [{ id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
  };
}

function exportFlow(): FlowDefinition {
  return {
    id: 'snf',
    name: 'Single Node Flow',
    failFast: false,
    nodes: [
      { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'top', maxCount: 10, fullText: true } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/x.json', pretty: true } }
    ],
    edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
  };
}

function tweetSample(id: string): RunStepSampleItem {
  return {
    platform: 'twitter',
    sourceBlockId: 'search',
    id,
    url: `https://x.com/u/status/${id}`,
    author: 'public_cli',
    community: null,
    title: null,
    text: `result ${id}`,
    createdAt: '2026-06-06T20:54:29Z',
    engagement: {}
  };
}

function redditSample(id: string): RunStepSampleItem {
  return { ...tweetSample(id), platform: 'reddit', url: null };
}

function priorRunWith(searchSample: RunStepSampleItem[]): RunRecord {
  return {
    schemaVersion: 1,
    id: 'prev',
    flowId: 'snf',
    status: 'success',
    startedAt: '2026-06-01T09:00:00Z',
    endedAt: '2026-06-01T09:00:01Z',
    steps: [
      {
        blockId: 'search',
        status: 'success',
        startedAt: '2026-06-01T09:00:00Z',
        endedAt: '2026-06-01T09:00:01Z',
        io: {
          inputCount: 0,
          outputCount: searchSample.length,
          skippedCount: 0,
          normalizedFields: ['id', 'author'],
          sampleItems: searchSample
        }
      }
    ],
    outputFiles: [],
    error: null
  };
}

function priorRunWithoutIo(): RunRecord {
  const prior = priorRunWith([tweetSample('111')]);
  return { ...prior, steps: [{ ...prior.steps[0], io: undefined }] };
}

function detailStdout(id: string): string {
  return JSON.stringify({
    data: {
      id,
      text: `detail ${id}`,
      author: { screenName: 'public_cli' },
      createdAtISO: '2026-06-06T20:54:29+00:00'
    }
  });
}
