import { describe, expect, it } from 'vitest';
import { applyEngagementFilter, applyFilterText, applyLimit, applyMerge, applySort } from '../src/shared/transforms';
import type { SocialItem } from '../src/shared/types';

const items: SocialItem[] = [
  {
    platform: 'reddit',
    sourceBlockId: 'a',
    id: '1',
    url: null,
    author: 'alice',
    community: 'localdev',
    title: 'CLI automation',
    body: 'cron workflow',
    text: 'CLI automation cron workflow',
    createdAt: '2026-01-01T00:00:00.000Z',
    engagement: { score: 10, comments: 2 },
    media: [],
    links: [],
    raw: {}
  },
  {
    platform: 'twitter',
    sourceBlockId: 'b',
    id: '2',
    url: null,
    author: 'bob',
    community: null,
    title: null,
    body: 'manual spreadsheet',
    text: 'manual spreadsheet',
    createdAt: '2026-01-02T00:00:00.000Z',
    engagement: { likes: 2, replies: 0 },
    media: [],
    links: [],
    raw: {}
  }
];

describe('transforms', () => {
  it('limits result count', () => {
    expect(applyLimit(items, { limit: 1 })).toEqual([items[0]]);
  });

  it('filters by include and exclude text across normalized text', () => {
    expect(applyFilterText(items, { include: 'automation', exclude: 'spreadsheet' })).toEqual([
      items[0]
    ]);
  });

  it('filters by engagement fields present on each platform', () => {
    expect(applyEngagementFilter(items, { minScore: 5, minLikes: 5 })).toEqual([items[0]]);
  });

  it('filters on the less-common engagement thresholds', () => {
    // minComments only excludes the reddit item (2 comments); the twitter item has
    // no comments field so it passes (absent fields never fail a threshold).
    expect(applyEngagementFilter(items, { minComments: 5 })).toEqual([items[1]]);
  });

  it('sorts by createdAt descending (newest first) without mutating input', () => {
    const sorted = applySort(items, { field: 'createdAt' });
    expect(sorted).toEqual([items[1], items[0]]);
    // input order is preserved (immutable)
    expect(items[0].id).toBe('1');
  });

  it('sorts by an engagement field descending, treating missing values as lowest', () => {
    expect(applySort(items, { field: 'score' })).toEqual([items[0], items[1]]);
  });

  it('merges streams by dropping duplicate platform+id items, keeping the first', () => {
    const dup = { ...items[0], author: 'second-copy' };
    expect(applyMerge([items[0], items[1], dup])).toEqual([items[0], items[1]]);
  });

  it('keeps distinct items that do not have ids', () => {
    const firstBlank = { ...items[0], id: '', text: 'first blank' };
    const secondBlank = { ...items[0], id: '', text: 'second blank' };

    expect(applyMerge([firstBlank, secondBlank])).toEqual([firstBlank, secondBlank]);
  });
});
