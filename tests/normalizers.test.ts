import { describe, expect, it } from 'vitest';
import { normalizeRedditPayload, normalizeTwitterPayload } from '../src/shared/normalizers';

describe('payload normalizers', () => {
  it('maps Reddit payloads into SocialItem', () => {
    const items = normalizeRedditPayload(
      {
        data: [
          {
            id: 'abc123',
            permalink: '/r/localdev/comments/abc123/test/',
            author: 'devops_dave',
            subreddit: 'localdev',
            title: 'Best open source CLI tools',
            selftext: 'I use Python and cron.',
            created_utc: 1716500000,
            score: 42,
            num_comments: 7,
            url: 'https://reddit.com/r/localdev/comments/abc123/test/'
          }
        ]
      },
      'search'
    );

    expect(items[0]).toMatchObject({
      platform: 'reddit',
      sourceBlockId: 'search',
      id: 'abc123',
      author: 'devops_dave',
      community: 'localdev',
      title: 'Best open source CLI tools',
      body: 'I use Python and cron.',
      text: 'Best open source CLI tools I use Python and cron.',
      engagement: { score: 42, comments: 7 }
    });
    expect(items[0].createdAt).toBe('2024-05-23T21:33:20.000Z');
  });

  it('maps real twitter-cli item shape (metrics, author.screenName, derived url, createdAtISO)', () => {
    const items = normalizeTwitterPayload(
      {
        ok: true,
        schema_version: '1',
        data: [
          {
            id: '2063363922716188763',
            text: 'CI/CD automation thread',
            author: { id: '193', name: 'Jai', screenName: 'jai_baradia', verified: false },
            metrics: { likes: 1, retweets: 0, replies: 0, quotes: 0, views: 6, bookmarks: 0 },
            createdAt: 'Sat Jun 06 20:54:29 +0000 2026',
            createdAtISO: '2026-06-06T20:54:29+00:00',
            media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg', width: 1920, height: 1080 }],
            urls: [],
            lang: 'en'
          }
        ]
      },
      'twitter-search'
    );

    expect(items[0]).toMatchObject({
      platform: 'twitter',
      id: '2063363922716188763',
      author: 'jai_baradia',
      url: 'https://x.com/jai_baradia/status/2063363922716188763',
      body: 'CI/CD automation thread',
      engagement: { likes: 1, retweets: 0, replies: 0, bookmarks: 0, views: 6 },
      media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg' }]
    });
    expect(items[0].createdAt).toBe('2026-06-06T20:54:29.000Z');
  });

  it('maps X/Twitter payloads into SocialItem with nulls for missing fields', () => {
    const items = normalizeTwitterPayload(
      {
        data: [
          {
            id: 'tweet-1',
            url: 'https://x.com/public_cli/status/tweet-1',
            author: { handle: 'public_cli' },
            text: 'Automation via local CLIs',
            created_at: '2026-06-01T10:00:00Z',
            likes: 12,
            retweets: 3,
            replies: 2,
            views: 1000,
            links: ['https://example.com']
          }
        ]
      },
      'twitter-search'
    );

    expect(items[0]).toMatchObject({
      platform: 'twitter',
      sourceBlockId: 'twitter-search',
      id: 'tweet-1',
      author: 'public_cli',
      community: null,
      title: null,
      body: 'Automation via local CLIs',
      text: 'Automation via local CLIs',
      engagement: { likes: 12, retweets: 3, replies: 2, views: 1000 },
      links: ['https://example.com']
    });
  });

  it('falls back to the Unix epoch when CLI timestamps are invalid', () => {
    expect(
      normalizeRedditPayload({ data: [{ id: 'bad-date', title: 'Bad', created_utc: 999999999999999 }] }, 'reddit')[0]
        .createdAt
    ).toBe('1970-01-01T00:00:00.000Z');
    expect(
      normalizeTwitterPayload({ data: [{ id: 'bad-date', text: 'Bad', createdAtISO: 'not-a-date' }] }, 'twitter')[0]
        .createdAt
    ).toBe('1970-01-01T00:00:00.000Z');
  });
});
