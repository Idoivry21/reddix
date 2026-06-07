import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactWriter } from '../server/routes';
import { resolveContainedPath } from '../server/safeId';

describe('resolveContainedPath', () => {
  const base = '/tmp/reddix-data/artifacts';

  it('resolves a normal relative export path inside the base dir', () => {
    expect(resolveContainedPath(base, 'outputs/digest-20260606.json')).toBe(
      path.join(base, 'outputs/digest-20260606.json')
    );
  });

  it('rejects traversal that escapes the base dir', () => {
    for (const evil of ['../../etc/passwd', '../secret.json', 'a/../../b', '/etc/passwd']) {
      expect(() => resolveContainedPath(base, evil)).toThrow(/invalid path/i);
    }
  });

  it('rejects empty or null-byte paths', () => {
    expect(() => resolveContainedPath(base, '')).toThrow(/invalid path/i);
    expect(() => resolveContainedPath(base, 'a\0b')).toThrow(/invalid path/i);
  });
});

describe('createArtifactWriter', () => {
  it('refuses to write through a symlink planted inside the artifacts directory', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'reddix-artifact-write-'));
    await mkdir(path.join(dataDir, 'artifacts'), { recursive: true });
    const outside = path.join(dataDir, 'outside.txt');
    await writeFile(outside, 'TOPSECRET');
    await symlink(outside, path.join(dataDir, 'artifacts', 'report.md'));

    const writeArtifact = createArtifactWriter(dataDir);

    await expect(writeArtifact('report.md', 'OVERWRITTEN')).rejects.toThrow(/artifact|symlink|outside/i);
    expect(await readFile(outside, 'utf8')).toBe('TOPSECRET');
  });
});
