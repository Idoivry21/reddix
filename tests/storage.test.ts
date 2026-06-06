import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage } from '../server/storage';
import type { PersistedFlow, RunRecord } from '../server/types';

describe('local JSON storage', () => {
  it('round-trips flows and caps run history per flow', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir, maxRunsPerFlow: 2 });
    const flow: PersistedFlow = {
      schemaVersion: 1,
      id: 'flow-1',
      name: 'Starter',
      nodes: [],
      edges: [],
      nodePositions: {},
      blockSettings: {},
      schedule: { enabled: false },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    await storage.saveFlow(flow);
    await storage.appendRun(run('old', 'flow-1'));
    await storage.appendRun(run('middle', 'flow-1'));
    await storage.appendRun(run('new', 'flow-1'));

    expect(await storage.getFlow('flow-1')).toEqual(flow);
    expect((await storage.listRuns('flow-1')).map((record) => record.id)).toEqual(['middle', 'new']);
  });

  it('migrates schema-less preferences on load', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await writeFile(
      path.join(dir, 'preferences.json'),
      JSON.stringify({ defaultExportDir: 'exports', selectedFlowId: 'flow-1' })
    );

    const storage = createStorage({ baseDir: dir });
    expect(await storage.getPreferences()).toEqual({
      schemaVersion: 1,
      defaultExportDir: 'exports',
      selectedFlowId: 'flow-1'
    });
    expect(JSON.parse(await readFile(path.join(dir, 'preferences.json'), 'utf8')).schemaVersion).toBe(1);
  });
});

function run(id: string, flowId: string): RunRecord {
  return {
    schemaVersion: 1,
    id,
    flowId,
    status: 'success',
    startedAt: id,
    endedAt: id,
    steps: [],
    outputFiles: [],
    error: null
  };
}

