import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage } from '../server/storage';
import type { PersistedFlow, RunRecord } from '../server/types';

describe('local JSON storage', () => {
  it('round-trips flows and caps run history per flow', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir, maxRunsPerFlow: 2 });
    const saved = flow('flow-1');

    await storage.saveFlow(saved);
    await storage.appendRun(run('old', 'flow-1'));
    await storage.appendRun(run('middle', 'flow-1'));
    await storage.appendRun(run('new', 'flow-1'));

    expect(await storage.getFlow('flow-1')).toEqual(saved);
    expect((await storage.listRuns('flow-1')).map((record) => record.id)).toEqual(['middle', 'new']);
  });

  it('rejects flow ids that escape the data dir and writes no file outside it', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const dir = path.join(base, 'data');
    const storage = createStorage({ baseDir: dir });
    const malicious = [
      '../../etc/passwd',
      '..',
      '.',
      '.hidden',
      'a/b',
      'a\\b',
      'foo/../bar',
      'foo/../../bar',
      '/abs/path',
      '..\\..\\win',
      '',
      'x\0y'
    ];

    for (const id of malicious) {
      await expect(storage.getFlow(id)).rejects.toThrow(/invalid id/i);
      await expect(storage.listRuns(id)).rejects.toThrow(/invalid id/i);
      await expect(storage.saveFlow(flow(id))).rejects.toThrow(/invalid id/i);
      await expect(storage.appendRun(run('r', id))).rejects.toThrow(/invalid id/i);
    }

    // No artifact may exist anywhere under the temp root outside the data dir.
    const sentinelTargets = [
      path.join(base, 'etc'),
      path.join(base, 'bar.json'),
      path.join(base, 'bar'),
      path.join(path.dirname(base), 'etc')
    ];
    for (const target of sentinelTargets) {
      await expect(readdir(target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('round-trips a generated uuid-shaped flow id', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const saved = flow(id);

    await storage.saveFlow(saved);
    expect(await storage.getFlow(id)).toEqual(saved);

    await storage.appendRun(run('only', id));
    expect((await storage.listRuns(id)).map((record) => record.id)).toEqual(['only']);
  });

  it('accepts normal flow ids', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    for (const id of ['flow-1', 'Flow_2', 'abc.def', 'a1b2c3', 'primary-flow']) {
      await expect(storage.getFlow(id)).resolves.toBeNull();
    }
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

function flow(id: string): PersistedFlow {
  return {
    schemaVersion: 1,
    id,
    name: 'Starter',
    nodes: [],
    edges: [],
    nodePositions: {},
    blockSettings: {},
    schedule: { enabled: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

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

