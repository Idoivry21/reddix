import { describe, expect, it, vi } from 'vitest';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';

describe('normalizers unrecognized-shape signal (finding 15)', () => {
  it('invokes the callback with top-level keys when data resolves to a non-record', () => {
    const onUnrecognized = vi.fn();
    // `data` is a primitive, so no array and no single record can be extracted —
    // the silent-empty case the signal exists to catch.
    const items = normalizeRedditPayload({ data: 'unexpected string payload' }, 'block', onUnrecognized);

    expect(items).toEqual([]);
    expect(onUnrecognized).toHaveBeenCalledWith({ keys: ['data'] });
  });

  it('does not fire for a well-formed but empty data envelope', () => {
    const onUnrecognized = vi.fn();
    const items = normalizeTwitterPayload({ ok: true, data: [] }, 'block', onUnrecognized);

    expect(items).toEqual([]);
    expect(onUnrecognized).not.toHaveBeenCalled();
  });

  it('does not fire when items are present', () => {
    const onUnrecognized = vi.fn();
    const items = normalizeRedditPayload(
      { data: [{ id: 'a', title: 'hi', created_utc: 1, score: 1 }] },
      'block',
      onUnrecognized
    );

    expect(items).toHaveLength(1);
    expect(onUnrecognized).not.toHaveBeenCalled();
  });
});
