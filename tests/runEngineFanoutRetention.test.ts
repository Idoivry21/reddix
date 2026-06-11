import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import type { FlowDefinition, RunStep } from '../server/types';

// Fan-out must not retain or persist multi-MiB per-call stdout/stderr (finding
// #14). The observable surface is the all-failed fan-out step's persisted error,
// which derives from per-call stderr and must be capped like every other sink.
const CAP = 240;

function fanOutFlow(): FlowDefinition {
  return {
    id: 'fanout-flow',
    name: 'Fan-out Flow',
    failFast: false,
    nodes: [
      { id: 'search', type: 'twitter.searchTweets', settings: { query: 'cli', tab: 'latest', maxCount: 5 } },
      { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '', fullText: true } }
    ],
    edges: [{ id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
  };
}

function searchStdout(ids: string[]): string {
  return JSON.stringify({ data: ids.map((id) => ({ id, text: 't', author: { screenName: 'u' }, createdAtISO: '2026-01-01T00:00:00Z' })) });
}

describe('run engine — fan-out output retention (finding #14)', () => {
  it('caps the persisted error when every fan-out call fails with huge stderr', async () => {
    const huge = 'E'.repeat(50_000);
    const emitted: RunStep[] = [];

    const run = await runFlow({
      flow: fanOutFlow(),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['111', '222', '333']), stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: huge, exitCode: 1 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z'),
      emit: (event) => {
        if (event.step) {
          emitted.push(event.step);
        }
      }
    });

    const step = run.steps.find((s) => s.blockId === 'detail');
    expect(step?.status).toBe('failed');
    expect(step?.error?.length).toBeLessThanOrEqual(CAP + 3);
    expect(JSON.stringify(run).length).toBeLessThan(huge.length);
    expect(JSON.stringify(emitted).length).toBeLessThan(huge.length);
  });
});
