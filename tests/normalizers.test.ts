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
});
