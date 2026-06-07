import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import { createMetrics } from '../server/metrics';
import type { FlowDefinition } from '../server/types';

function captureLogger() {
  const lines: Array<{ level: string; message: string; fields: Record<string, unknown> }> = [];
  const push = (level: string) => (message: string, fields: Record<string, unknown> = {}) =>
    lines.push({ level, message, fields });
  return { lines, logger: { info: push('info'), warn: push('warn'), error: push('error') } };
}

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

describe('runEngine observability (findings 2, 14, 16, 23)', () => {
  it('logs flow start/end and per-step lifecycle, and counts the run', async () => {
    const { lines, logger } = captureLogger();
    const metrics = createMetrics();
    await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({ data: [{ id: 'abc', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z'),
      logger,
      metrics
    });

    expect(lines.find((l) => l.message === 'flow.start')?.fields.flowId).toBe('flow-1');
    const end = lines.find((l) => l.message === 'flow.end');
    expect(end?.fields.status).toBe('success');
    expect(lines.filter((l) => l.message === 'flow.step')).toHaveLength(3);
    expect(metrics.snapshot().counters['flow_runs_total{status=success}']).toBe(1);
  });

  it('logs transform input/output counts so a filter dropping everything is visible', async () => {
    const { lines, logger } = captureLogger();
    await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({ data: [{ id: 'a', title: 'unrelated text', created_utc: 1716500000, score: 1 }] }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z'),
      logger
    });

    const transform = lines.find((l) => l.message === 'flow.transform');
    expect(transform?.fields.inputCount).toBe(1);
    expect(transform?.fields.outputCount).toBe(0); // filtered out -> visible, not silent
  });

  it('warns when a CLI exits 0 with empty stdout (finding 14)', async () => {
    const { lines, logger } = captureLogger();
    await runFlow({
      flow: starterFlow(),
      executor: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z'),
      logger
    });

    expect(lines.some((l) => l.message === 'cli.emptyStdout' && l.level === 'warn')).toBe(true);
  });

  it('logs a step error with operation class when a step throws', async () => {
    const { lines, logger } = captureLogger();
    await runFlow({
      flow: starterFlow(),
      // Exit 0 but non-JSON stdout -> parseJson throws inside the try.
      executor: async () => ({ stdout: 'not json at all', stderr: '', exitCode: 0 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z'),
      logger
    });

    const stepError = lines.find((l) => l.message === 'flow.stepError');
    expect(stepError?.level).toBe('error');
    expect(stepError?.fields.operation).toBe('cli');
  });
});
