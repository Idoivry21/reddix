import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
