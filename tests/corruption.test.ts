import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStorage } from '../server/storage';

describe('corrupted JSON handling', () => {
  it('falls back to an empty run list when a runs file is corrupted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'reddix-corrupt-'));
    const flowId = 'test-flow';

    await mkdir(path.join(dir, 'runs'));
    await writeFile(path.join(dir, 'runs', `${flowId}.json`), '{"incomplete');

    const storage = createStorage({ baseDir: dir });

    await expect(storage.listRuns(flowId)).resolves.toEqual([]);
  });
});
