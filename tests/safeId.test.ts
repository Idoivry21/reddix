import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeId, isSafeId, safeSegmentPath } from '../server/safeId';

describe('safeId validator', () => {
  it('accepts real-shaped ids (slugs, words, dotted, uuids)', () => {
    const valid = [
      'primary-flow',
      'flow-1',
      'Flow_2',
      'abc.def',
      'a1b2c3',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    ];
    for (const id of valid) {
      expect(isSafeId(id)).toBe(true);
      expect(assertSafeId(id)).toBe(id);
    }
  });

  it('rejects traversal, separators, dotfiles, and non-strings', () => {
    const invalid: unknown[] = [
      '',
      '.',
      '..',
      '.hidden',
      '..foo',
      'a/b',
      'a\\b',
      '/abs/path',
      '../../etc/passwd',
      'foo/../bar',
      '..\\..\\win',
      'x\0y',
      'space id',
      'tab\tid',
      'a'.repeat(201),
      null,
      undefined,
      42
    ];
    for (const id of invalid) {
      expect(isSafeId(id)).toBe(false);
      expect(() => assertSafeId(id)).toThrow(/invalid id/i);
    }
  });

  it('safeSegmentPath builds an in-base path for valid ids', () => {
    const base = '/tmp/reddix/flows';
    expect(safeSegmentPath(base, 'flow-1', '.json')).toBe(path.join(base, 'flow-1.json'));
  });

  it('safeSegmentPath rejects ids that would escape the base dir', () => {
    const base = '/tmp/reddix/flows';
    for (const id of ['../../etc/passwd', '..', 'a/b', '/abs']) {
      expect(() => safeSegmentPath(base, id, '.json')).toThrow(/invalid id/i);
    }
  });
});
