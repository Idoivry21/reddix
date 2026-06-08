import { describe, expect, it } from 'vitest';
import {
  blankBoundFieldKeys,
  boundFieldKeys,
  inputBindingMeta,
  resolveInputBoundSettings,
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

describe('boundFieldKeys', () => {
  it('unions the default-bound keys with the user __bindings keys', () => {
    expect(
      boundFieldKeys('twitter.tweetDetail', { tweetIdOrUrl: '', __bindings: { fullText: 'text' } })
    ).toEqual(['tweetIdOrUrl', 'fullText']);
  });

  it('reports a user binding on a block with no default bindings', () => {
    expect(boundFieldKeys('twitter.searchTweets', { query: '', __bindings: { query: 'text' } })).toEqual([
      'query'
    ]);
  });

  it('does not duplicate a key bound both by default and by the user', () => {
    expect(
      boundFieldKeys('twitter.tweetDetail', { tweetIdOrUrl: '', __bindings: { tweetIdOrUrl: 'url' } })
    ).toEqual(['tweetIdOrUrl']);
  });
});

describe('blankBoundFieldKeys with user bindings', () => {
  it('includes a blank user-bound field on a source block', () => {
    expect(blankBoundFieldKeys('twitter.searchTweets', { query: '', __bindings: { query: 'text' } })).toEqual([
      'query'
    ]);
  });

  it('excludes a user-bound field that has a static value', () => {
    expect(
      blankBoundFieldKeys('twitter.searchTweets', { query: 'cli', __bindings: { query: 'text' } })
    ).toEqual([]);
  });
});

describe('resolveInputBoundSettingsForItem with user bindings', () => {
  it('fills a user-bound field on a source block from the item', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.searchTweets',
      { query: '', __bindings: { query: 'author' } },
      tweet({ author: 'someone' })
    );
    expect(resolved).toEqual({ query: 'someone', __bindings: { query: 'author' } });
  });

  it('lets a user binding override the default source field', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.tweetDetail',
      { tweetIdOrUrl: '', fullText: true, __bindings: { tweetIdOrUrl: 'url' } },
      tweet({ id: '999', url: 'https://x.com/u/status/abc' })
    );
    expect(resolved).toMatchObject({ tweetIdOrUrl: 'https://x.com/u/status/abc' });
  });

  it('stringifies a numeric engagement field bound by the user', () => {
    const resolved = resolveInputBoundSettingsForItem(
      'twitter.searchTweets',
      { query: '', __bindings: { query: 'engagement.likes' } },
      tweet({ engagement: { likes: 12 } })
    );
    expect(resolved).toMatchObject({ query: '12' });
  });

  it('returns null when the bound upstream field is empty on the item', () => {
    expect(
      resolveInputBoundSettingsForItem(
        'twitter.searchTweets',
        { query: '', __bindings: { query: 'community' } },
        tweet({ community: null })
      )
    ).toBeNull();
  });
});

describe('resolveInputBoundSettings (first-match) with user bindings', () => {
  it('fills from the first item that supplies the bound value', () => {
    const resolved = resolveInputBoundSettings(
      'twitter.searchTweets',
      { query: '', __bindings: { query: 'author' } },
      [tweet({ author: null }), tweet({ author: 'second' })]
    );
    expect(resolved).toMatchObject({ query: 'second' });
  });

  it('throws when no upstream item supplies the bound value', () => {
    expect(() =>
      resolveInputBoundSettings(
        'twitter.searchTweets',
        { query: '', __bindings: { query: 'community' } },
        [tweet({ community: null })]
      )
    ).toThrow(/could not be resolved/);
  });
});
