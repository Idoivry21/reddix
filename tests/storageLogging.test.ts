import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage } from '../server/storage';

function captureLogger() {
  const lines: Array<{ level: string; message: string; fields: Record<string, unknown> }> = [];
  const push = (level: string) => (message: string, fields: Record<string, unknown> = {}) =>
    lines.push({ level, message, fields });
  return { lines, logger: { info: push('info'), warn: push('warn'), error: push('error') } };
}

describe('storage logging (finding 3: corrupt JSON must not be silent)', () => {
  it('warns when a corrupt flow file is skipped instead of silently dropping it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-log-'));
    await mkdir(path.join(dir, 'flows'), { recursive: true });
    await writeFile(path.join(dir, 'flows', 'broken.json'), '{"id":');
    const { lines, logger } = captureLogger();
    const storage = createStorage({ baseDir: dir, logger });

    await expect(storage.listFlows()).resolves.toEqual([]);

    const warn = lines.find((line) => line.message === 'storage.corruptJson');
    expect(warn?.level).toBe('warn');
    expect(String(warn?.fields.path)).toContain('broken.json');
  });

  it('does not warn when files are absent or valid', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-storage-log-'));
    const { lines, logger } = captureLogger();
    const storage = createStorage({ baseDir: dir, logger });

    await storage.getFlow('missing');
    await storage.listFlows();

    expect(lines.some((line) => line.message === 'storage.corruptJson')).toBe(false);
  });
});
