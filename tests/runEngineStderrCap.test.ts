import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import type { FlowDefinition, RunStep } from '../server/types';

// The single-call CLI sink must cap persisted/broadcast stderr like every other
// sink, so a CLI that exits non-zero with multi-MiB stderr cannot bloat the run
// record or an SSE frame (finding #15).
const STDERR_CAP = 240;

function sourceCliFlow(): FlowDefinition {
  return {
    id: 'stderr-flow',
    name: 'Stderr Flow',
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

describe('run engine — stderr cap (finding #15)', () => {
  it('caps persisted and broadcast stderr on a failed single-call CLI node', async () => {
    const huge = 'E'.repeat(50_000);
    const emitted: RunStep[] = [];

    const run = await runFlow({
      flow: sourceCliFlow(),
      executor: async () => ({ stdout: '', stderr: huge, exitCode: 1 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z'),
      emit: (event) => {
        if (event.step) {
          emitted.push(event.step);
        }
      }
    });

    const step = run.steps.find((s) => s.blockId === 'search');
    expect(step?.status).toBe('failed');
    // Capped to the summary length plus the truncation ellipsis.
    expect(step?.stderr?.length).toBeLessThanOrEqual(STDERR_CAP + 3);
    expect(step?.stderr).toMatch(/\.\.\.$/);
    // The huge string is never carried on the SSE frame either.
    expect(JSON.stringify(emitted).length).toBeLessThan(huge.length);
  });
});
