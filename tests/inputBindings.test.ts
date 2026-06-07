import { describe, expect, it } from 'vitest';
import {
  blankBoundFieldKeys,
  inputBindingMeta,
  resolveInputBoundSettingsForItem
} from '../src/shared/inputBindings';
import type { SocialItem } from '../src/shared/types';

function tweet(overrides: Partial<SocialItem> = {}): SocialItem {
  return {
    platform: 'twitter',
    sourceBlockId: 'search',
    id: 'tw-1',
    url: 'https://x.com/u/status/tw-1',
    author: 'public_cli',
    community: null,
    title: null,
    body: null,
    text: 'a tweet',
    createdAt: '2026-06-06T20:54:29Z',
    engagement: {},
    media: [],
    links: [],
    raw: {},
    ...overrides
  };
}

function redditItem(overrides: Partial<SocialItem> = {}): SocialItem {
  return tweet({ platform: 'reddit', id: 'r-1', url: null, ...overrides });
}

describe('inputBindingMeta', () => {
  it('exposes the source-field label for the visible mapper', () => {
    expect(inputBindingMeta('twitter.tweetDetail')).toEqual([
      { fieldKey: 'tweetIdOrUrl', label: 'Tweet ID or URL', sourceLabel: 'id or url' }
    ]);
    expect(inputBindingMeta('twitter.userProfile')).toEqual([
      { fieldKey: 'handle', label: 'Handle', sourceLabel: 'author' }
    ]);
    expect(inputBindingMeta('reddit.readPost')).toEqual([
      { fieldKey: 'postId', label: 'Post ID', sourceLabel: 'id' }
    ]);
  });

  it('returns an empty list for a block without bindings', () => {
    expect(inputBindingMeta('twitter.searchTweets')).toEqual([]);
  });
});

describe('blankBoundFieldKeys', () => {
  it('returns the bound field when it is blank', () => {
    expect(blankBoundFieldKeys('twitter.tweetDetail', { tweetIdOrUrl: '', fullText: true })).toEqual([
      'tweetIdOrUrl'
    ]);
  });

  it('returns nothing when the bound field has a static value', () => {
    expect(blankBoundFieldKeys('twitter.tweetDetail', { tweetIdOrUrl: '123', fullText: true })).toEqual([]);
  });

  it('returns nothing for a block without input bindings', () => {
    expect(blankBoundFieldKeys('twitter.searchTweets', { query: 'x' })).toEqual([]);
  });
});

describe('resolveInputBoundSettingsForItem', () => {
  it('fills a blank bound field from a single upstream item', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.tweetDetail',
      { tweetIdOrUrl: '', fullText: true },
      tweet({ id: '999' })
    );
    expect(resolved).toEqual({ tweetIdOrUrl: '999', fullText: true });
  });

  it('falls back to the url when the item id is empty', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.tweetDetail',
      { tweetIdOrUrl: '', fullText: true },
      tweet({ id: '', url: 'https://x.com/u/status/abc' })
    );
    expect(resolved).toEqual({ tweetIdOrUrl: 'https://x.com/u/status/abc', fullText: true });
  });

  it('returns null when the item cannot drive this block (wrong platform)', () => {
    expect(
      resolveInputBoundSettingsForItem('twitter.tweetDetail', { tweetIdOrUrl: '', fullText: true }, redditItem())
    ).toBeNull();
  });

  it('keeps a static value and does not override it from the item', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.tweetDetail',
      { tweetIdOrUrl: 'pinned', fullText: true },
      tweet({ id: '999' })
    );
    expect(resolved).toEqual({ tweetIdOrUrl: 'pinned', fullText: true });
  });

  it('does not mutate the original settings object', () => {
    const settings = { tweetIdOrUrl: '', fullText: true };
    resolveInputBoundSettingsForItem('twitter.tweetDetail', settings, tweet({ id: '999' }));
    expect(settings.tweetIdOrUrl).toBe('');
  });
});
