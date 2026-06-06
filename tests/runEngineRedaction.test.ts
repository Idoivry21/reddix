import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import { createStorage } from '../server/storage';
import type { FlowDefinition, RunStep } from '../server/types';

const SECRET = 'super-secret-auth-token-xyz';

describe('security invariant 2: secrets never leak from the run pipeline', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-redaction-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('redacts an auth token from RunRecord, the SSE broadcast, and the persisted run JSON', async () => {
    const emitted: RunStep[] = [];

    const run = await runFlow({
      flow: leakyFlow(),
      secrets: { TWITTER_AUTH_TOKEN: SECRET },
      executor: async () => ({
        // The token shows up in BOTH stdout (-> stdoutSummary) and stderr.
        stdout: `leaking ${SECRET} in stdout`,
        stderr: `auth failed using ${SECRET}`,
        exitCode: 1
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z'),
      emit: (event) => {
        if (event.step) {
          emitted.push(event.step);
        }
      }
    });

    // 1. Persisted RunRecord must not contain the secret anywhere.
    expect(JSON.stringify(run)).not.toContain(SECRET);

    const failedStep = run.steps.find((step) => step.blockId === 'twitter-search');
    expect(failedStep?.status).toBe('failed');
    expect(failedStep?.stderr).toContain('[REDACTED]');
    expect(failedStep?.stderr).not.toContain(SECRET);
    expect(failedStep?.stdoutSummary).not.toContain(SECRET);
    expect(failedStep?.error).not.toContain(SECRET);

    // 2. The SSE broadcast payload must not contain the secret.
    expect(JSON.stringify(emitted)).not.toContain(SECRET);

    // 3. The on-disk run JSON must not contain the secret.
    const storage = createStorage({ baseDir: dataDir });
    await storage.appendRun(run);
    const onDisk = await readFile(path.join(dataDir, 'runs', `${run.flowId}.json`), 'utf8');
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).toContain('[REDACTED]');
  });

  it('redacts a secret that straddles the stdout truncation boundary', async () => {
    // The secret starts before the 240-char summarize cutoff and ends after it.
    // If redaction ran AFTER truncation, a prefix fragment of the token would
    // survive in stdoutSummary; redacting the full string first prevents that.
    const prefix = 'A'.repeat(230);
    const stdout = `${prefix}${SECRET}${'B'.repeat(50)}`;
    const emitted: RunStep[] = [];

    const run = await runFlow({
      flow: leakyFlow(),
      secrets: { TWITTER_AUTH_TOKEN: SECRET },
      executor: async () => ({ stdout, stderr: '', exitCode: 1 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-06T10:00:00Z'),
      emit: (event) => {
        if (event.step) {
          emitted.push(event.step);
        }
      }
    });

    const failedStep = run.steps.find((step) => step.blockId === 'twitter-search');
    expect(failedStep?.stdoutSummary).not.toContain(SECRET);
    // No prefix fragment of the token may survive the truncation boundary.
    expect(failedStep?.stdoutSummary).not.toContain(SECRET.slice(0, 10));
    expect(failedStep?.stdoutSummary).toContain('[REDACTED]');
    expect(JSON.stringify(run)).not.toContain(SECRET.slice(0, 10));
    expect(JSON.stringify(emitted)).not.toContain(SECRET.slice(0, 10));
  });
});

function leakyFlow(): FlowDefinition {
  return {
    id: 'leaky-flow',
    name: 'Leaky Flow',
    failFast: false,
    nodes: [
      {
        id: 'twitter-search',
        type: 'twitter.searchTweets',
        settings: { query: 'cli', tab: 'latest', maxCount: 5 }
      },
      { id: 'csv', type: 'output.exportCsv', settings: { path: 'outputs/tweets.csv' } }
    ],
    edges: [
      {
        id: 'e1',
        source: 'twitter-search',
        target: 'csv',
        sourcePortId: 'items',
        targetPortId: 'items'
      }
    ]
  };
}
