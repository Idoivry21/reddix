import { describe, expect, it } from 'vitest';
import { applyEngagementFilter, applyFilterText, applyLimit } from '../src/shared/transforms';
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
});

