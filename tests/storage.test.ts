import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage, sweepStaleTempFiles } from '../server/storage';
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
      await expect(storage.deleteFlow(id)).rejects.toThrow(/invalid id/i);
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

  it('keeps every record when appends race concurrently', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir, maxRunsPerFlow: 100 });

    await Promise.all(
      Array.from({ length: 25 }, (_unused, index) =>
        storage.appendRun(run(`run-${index}`, 'flow-race'))
      )
    );

    const ids = (await storage.listRuns('flow-race')).map((record) => record.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('ignores corrupt JSON files during reads but refuses to overwrite them', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'flows'), { recursive: true });
    await mkdir(path.join(dir, 'runs'), { recursive: true });
    const flowPath = path.join(dir, 'flows', 'broken.json');
    const runsPath = path.join(dir, 'runs', 'flow-1.json');
    await writeFile(flowPath, '{"id":');
    await writeFile(runsPath, '[');
    const storage = createStorage({ baseDir: dir });

    await expect(storage.listFlows()).resolves.toEqual([]);
    await expect(storage.getFlow('broken')).resolves.toBeNull();
    await expect(storage.listRuns('flow-1')).resolves.toEqual([]);

    await expect(storage.appendRun(run('new', 'flow-1'))).rejects.toThrow(/corrupt JSON/i);
    await expect(storage.saveFlow(flow('broken'))).rejects.toThrow(/corrupt JSON/i);
    expect(await readFile(runsPath, 'utf8')).toBe('[');
    expect(await readFile(flowPath, 'utf8')).toBe('{"id":');
  });

  it('treats valid JSON with the wrong run-list shape as empty before appending', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'runs'), { recursive: true });
    await writeFile(path.join(dir, 'runs', 'flow-1.json'), '{"not":"an array"}');
    const storage = createStorage({ baseDir: dir });

    await expect(storage.listRuns('flow-1')).resolves.toEqual([]);
    await storage.appendRun(run('new', 'flow-1'));

    expect((await storage.listRuns('flow-1')).map((record) => record.id)).toEqual(['new']);
  });

  it('skips valid JSON flow files that do not match the persisted flow shape', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'flows'), { recursive: true });
    await writeFile(path.join(dir, 'flows', 'broken.json'), '{"id":"broken"}');
    const storage = createStorage({ baseDir: dir });

    await expect(storage.getFlow('broken')).resolves.toBeNull();
    await expect(storage.listFlows()).resolves.toEqual([]);
  });

  it('deletes a flow and its run history, reporting whether it existed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    await storage.saveFlow(flow('flow-1'));
    await storage.appendRun(run('r1', 'flow-1'));

    expect(await storage.deleteFlow('flow-1')).toBe(true);
    expect(await storage.getFlow('flow-1')).toBeNull();
    // Run history is dropped with the flow, not orphaned under runs/.
    expect(await storage.listRuns('flow-1')).toEqual([]);
    await expect(readdir(path.join(dir, 'runs'))).resolves.not.toContain('flow-1.json');
  });

  it('treats deleting a nonexistent flow as a no-op returning false', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    expect(await storage.deleteFlow('never-saved')).toBe(false);
  });

  it('does not recreate run history when a flow is appended after deletion (finding #10)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    await storage.saveFlow(flow('flow-1'));
    await storage.appendRun(run('r1', 'flow-1'));
    await storage.deleteFlow('flow-1');

    // A late in-flight append after delete must NOT resurrect the runs file.
    await storage.appendRun(run('zombie', 'flow-1'));

    await expect(readdir(path.join(dir, 'runs'))).resolves.not.toContain('flow-1.json');
    expect(await storage.listRuns('flow-1')).toEqual([]);
  });

  it('does not disturb other flows when deleting one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const storage = createStorage({ baseDir: dir });
    await storage.saveFlow(flow('flow-1'));
    await storage.saveFlow(flow('flow-2'));
    await storage.appendRun(run('keep', 'flow-2'));

    await storage.deleteFlow('flow-1');

    expect(await storage.getFlow('flow-2')).toEqual(flow('flow-2'));
    expect((await storage.listRuns('flow-2')).map((record) => record.id)).toEqual(['keep']);
  });

  it('refuses to overwrite run history written by a newer schema version', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'runs'), { recursive: true });
    const future = JSON.stringify([{ schemaVersion: 2, id: 'from-the-future', extra: 'field' }]);
    const runsPath = path.join(dir, 'runs', 'flow-1.json');
    await writeFile(runsPath, future);
    const storage = createStorage({ baseDir: dir });

    // The append must FAIL rather than silently drop the unparseable future record.
    await expect(storage.appendRun(run('new', 'flow-1'))).rejects.toThrow(/newer Reddix version/i);
    // The on-disk history is preserved byte-for-byte — no data loss.
    expect(await readFile(runsPath, 'utf8')).toBe(future);
  });

  it('refuses to overwrite a flow file written by a newer schema version', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await mkdir(path.join(dir, 'flows'), { recursive: true });
    const future = JSON.stringify({ schemaVersion: 2, id: 'flow-1', name: 'future flow' });
    const flowPath = path.join(dir, 'flows', 'flow-1.json');
    await writeFile(flowPath, future);
    const storage = createStorage({ baseDir: dir });

    await expect(storage.saveFlow(flow('flow-1'))).rejects.toThrow(/newer Reddix version/i);
    expect(await readFile(flowPath, 'utf8')).toBe(future);
  });

  it('does not rewrite a preferences file written by a newer schema version', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const future = JSON.stringify({ schemaVersion: 2, defaultExportDir: 'exports', futureField: true });
    const prefsPath = path.join(dir, 'preferences.json');
    await writeFile(prefsPath, future);
    const storage = createStorage({ baseDir: dir });

    // A usable view is still returned, but the file is left intact (not downgraded).
    const prefs = await storage.getPreferences();
    expect(prefs.defaultExportDir).toBe('exports');
    expect(await readFile(prefsPath, 'utf8')).toBe(future);
  });

  it('sweeps orphan temp files from other processes but keeps its own', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const foreign = `.flow-1.json.99999.${uuid}.tmp`;
    const own = `.flow-2.json.${process.pid}.${uuid}.tmp`;
    const realFile = 'flow-3.json';
    await writeFile(path.join(dir, foreign), 'orphan');
    await writeFile(path.join(dir, own), 'in-flight');
    await writeFile(path.join(dir, realFile), '{}');

    await sweepStaleTempFiles([dir]);

    const remaining = await readdir(dir);
    expect(remaining).not.toContain(foreign); // another process's orphan: removed
    expect(remaining).toContain(own); // our own in-flight temp: untouched
    expect(remaining).toContain(realFile); // a real file: never matched
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

  it('preserves valid preference fields while normalizing an invalid schema version', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-'));
    await writeFile(
      path.join(dir, 'preferences.json'),
      JSON.stringify({ schemaVersion: '1', defaultExportDir: 'exports', selectedFlowId: 'flow-1' })
    );

    const storage = createStorage({ baseDir: dir });
    expect(await storage.getPreferences()).toEqual({
      schemaVersion: 1,
      defaultExportDir: 'exports',
      selectedFlowId: 'flow-1'
    });
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
