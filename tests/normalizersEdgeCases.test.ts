import { describe, expect, it } from 'vitest';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';
import { applyEngagementFilter, applyFilterText, applyLimit } from '../src/shared/transforms';
import type { SocialItem } from '../src/shared/types';

/**
 * Malformed / boundary payloads for the normalizers and transforms. The
 * SocialItem contract requires absent fields to be null (never invented) and
 * malformed nested values to be dropped, not surfaced.
 */

function reddit(raw: Record<string, unknown>) {
  return normalizeRedditPayload({ data: [raw] }, 'src');
}

describe('normalizeTwitterPayload — missing author', () => {
  it('yields null author and null url when no handle exists at any fallback level', () => {
    const [item] = normalizeTwitterPayload({ data: [{ id: '123', text: 'hi' }] }, 'src');
    expect(item.id).toBe('123');
    expect(item.author).toBeNull();
    // url derivation needs a handle; without one it must stay null, not a broken /status/ link.
    expect(item.url).toBeNull();
  });
});

describe('extractMedia — malformed entries', () => {
  it('keeps only record entries with a string url and drops the rest', () => {
    const [item] = reddit({
      id: '1',
      title: 't',
      media: [
        { type: 'image', url: 'https://img.example/a.png' },
        { type: 'image' }, // no url -> dropped
        { url: 42 }, // non-string url -> dropped
        null, // non-record -> dropped
        'https://img.example/b.png' // string, not a record -> dropped
      ]
    });
    expect(item.media).toEqual([{ type: 'image', url: 'https://img.example/a.png' }]);
  });

  it('returns [] when media is not an array', () => {
    const [item] = reddit({ id: '1', title: 't', media: { url: 'https://x/y.png' } });
    expect(item.media).toEqual([]);
  });
});

describe('extractLinks — mixed and non-array', () => {
  it('keeps only string entries from a mixed array', () => {
    const [item] = reddit({
      id: '1',
      title: 't',
      links: ['https://a.example', 123, null, { x: 1 }, 'https://b.example']
    });
    expect(item.links).toEqual(['https://a.example', 'https://b.example']);
  });

  it('falls back to the urls field and returns [] when neither is an array', () => {
    expect(reddit({ id: '1', title: 't', urls: ['https://c.example'] })[0].links).toEqual([
      'https://c.example'
    ]);
    expect(reddit({ id: '1', title: 't', links: { not: 'an array' } })[0].links).toEqual([]);
  });
});

describe('normalizeRedditPayload — bare empty object', () => {
  it('treats a bare {} as a single empty record (documents current behavior)', () => {
    // extractArray unwraps {} to itself, which is a record, so one empty item is
    // produced. Locked here so any future "empty object -> []" change is intentional.
    const items = normalizeRedditPayload({}, 'src');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ platform: 'reddit', sourceBlockId: 'src', id: '' });
  });
});

describe('applyLimit — zero and negative bounds', () => {
  const items: SocialItem[] = [
    baseItem('1'),
    baseItem('2'),
    baseItem('3')
  ];

  it('returns [] for a zero limit', () => {
    expect(applyLimit(items, { limit: 0 })).toEqual([]);
  });

  it('returns [] for a negative limit (Math.max(0, n) clamp)', () => {
    expect(applyLimit(items, { limit: -5 })).toEqual([]);
  });

  it('returns all items when the limit is non-numeric (falls back to length)', () => {
    expect(applyLimit(items, { limit: 'not-a-number' })).toHaveLength(3);
  });
});

describe('applyFilterText / applyEngagementFilter — empty input and all-null item', () => {
  it('returns [] for an empty input array', () => {
    expect(applyFilterText([], { include: 'x' })).toEqual([]);
    expect(applyEngagementFilter([], { minScore: 5 })).toEqual([]);
  });

  it('excludes an all-null-field item when an include term is set (empty haystack)', () => {
    const blank = baseItem('blank', { text: '', title: null, body: null, community: null, author: null, url: null });
    expect(applyFilterText([blank], { include: 'automation' })).toEqual([]);
  });
});

function baseItem(id: string, overrides: Partial<SocialItem> = {}): SocialItem {
  return {
    platform: 'reddit',
    sourceBlockId: 'src',
    id,
    url: null,
    author: 'a',
    community: null,
    title: 't',
    body: 'b',
    text: 't b',
    createdAt: '2026-01-01T00:00:00.000Z',
    engagement: { score: 1 },
    media: [],
    links: [],
    raw: {},
    ...overrides
  };
}
