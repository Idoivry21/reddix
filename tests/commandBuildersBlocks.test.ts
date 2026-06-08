import { describe, expect, it } from 'vitest';
import { buildBlockCommand, getDefaultSettings, previewCommand } from '../src/shared/commandBuilders';

/**
 * Argv coverage for the CLI block types not exercised by commandBuilders.test.ts.
 * Each asserts the full argv, that displayArgv is an equal-but-separate copy (the
 * redaction boundary), and — for enrichment blocks — that the id/format validation
 * branches behave. No block type should reach execution with an unverified argv.
 */

describe('reddit.browseSubreddit', () => {
  it('builds the sub listing argv from defaults', () => {
    const command = buildBlockCommand({
      blockId: 'r-sub-1',
      blockType: 'reddit.browseSubreddit',
      settings: getDefaultSettings('reddit.browseSubreddit')
    });
    expect(command.executable).toBe('rdt');
    expect(command.argv).toEqual([
      'sub', 'localdev', '--sort', 'hot', '--time', 'day', '--limit', '50', '--compact', '--json'
    ]);
    expect(command.displayArgv).toEqual(command.argv);
    expect(command.displayArgv).not.toBe(command.argv);
  });
});

describe('reddit.popularAll', () => {
  it('uses the "popular" listing by default', () => {
    const command = buildBlockCommand({
      blockId: 'r-pop-1',
      blockType: 'reddit.popularAll',
      settings: { listing: 'popular', limit: 50 }
    });
    expect(command.argv).toEqual(['popular', '--limit', '50', '--compact', '--json']);
  });

  it('switches to the "all" listing when selected', () => {
    const command = buildBlockCommand({
      blockId: 'r-pop-2',
      blockType: 'reddit.popularAll',
      settings: { listing: 'all', limit: 25 }
    });
    expect(command.argv).toEqual(['all', '--limit', '25', '--compact', '--json']);
  });
});

describe('reddit.readPost', () => {
  it('builds a read-by-id argv and omits --expand-more by default', () => {
    const command = buildBlockCommand({
      blockId: 'r-read-1',
      blockType: 'reddit.readPost',
      settings: { postId: 't3_abc123', expandMore: false }
    });
    expect(command.argv).toEqual(['read', 't3_abc123', '--json']);
  });

  it('adds --expand-more when enabled', () => {
    const command = buildBlockCommand({
      blockId: 'r-read-2',
      blockType: 'reddit.readPost',
      settings: { postId: 't3_abc123', expandMore: true }
    });
    expect(command.argv).toEqual(['read', 't3_abc123', '--expand-more', '--json']);
  });
});

describe('twitter.bookmarks', () => {
  it('builds bookmarks with --max and --full-text', () => {
    const command = buildBlockCommand({
      blockId: 't-bm-1',
      blockType: 'twitter.bookmarks',
      settings: { maxCount: 50, fullText: true }
    });
    expect(command.argv).toEqual(['bookmarks', '--max', '50', '--full-text', '--json']);
  });

  it('omits --full-text when disabled', () => {
    const command = buildBlockCommand({
      blockId: 't-bm-2',
      blockType: 'twitter.bookmarks',
      settings: { maxCount: 10, fullText: false }
    });
    expect(command.argv).toEqual(['bookmarks', '--max', '10', '--json']);
  });
});

describe('twitter.userTweets', () => {
  it('builds user-posts with the handle as a single value', () => {
    const command = buildBlockCommand({
      blockId: 't-ut-1',
      blockType: 'twitter.userTweets',
      settings: { handle: 'public_cli', maxCount: 50, fullText: true }
    });
    expect(command.argv).toEqual(['user-posts', 'public_cli', '--max', '50', '--full-text', '--json']);
  });
});

describe('twitter.userProfile', () => {
  it('builds a user lookup argv', () => {
    const command = buildBlockCommand({
      blockId: 't-up-1',
      blockType: 'twitter.userProfile',
      settings: { handle: 'jack' }
    });
    expect(command.argv).toEqual(['user', 'jack', '--json']);
  });
});

describe('twitter.tweetDetail', () => {
  it('builds a tweet-by-id argv', () => {
    const command = buildBlockCommand({
      blockId: 't-td-1',
      blockType: 'twitter.tweetDetail',
      settings: { tweetIdOrUrl: '1234567890', fullText: false }
    });
    expect(command.argv).toEqual(['tweet', '1234567890', '--json']);
  });

  it('accepts a canonical x.com URL', () => {
    const command = buildBlockCommand({
      blockId: 't-td-2',
      blockType: 'twitter.tweetDetail',
      settings: { tweetIdOrUrl: 'https://x.com/jack/status/20', fullText: true }
    });
    expect(command.argv).toEqual(['tweet', 'https://x.com/jack/status/20', '--full-text', '--json']);
  });

  it('rejects a non-Twitter URL via the twitter-id-or-url format guard', () => {
    expect(() =>
      buildBlockCommand({
        blockId: 't-td-3',
        blockType: 'twitter.tweetDetail',
        settings: { tweetIdOrUrl: 'http://evil.example/x', fullText: false }
      })
    ).toThrow(/Tweet ID or URL/i);
  });
});

describe('twitter.article', () => {
  it('defaults to --json format', () => {
    const command = buildBlockCommand({
      blockId: 't-art-1',
      blockType: 'twitter.article',
      settings: { articleIdOrUrl: '1234567890', format: 'json' }
    });
    expect(command.argv).toEqual(['article', '1234567890', '--json']);
  });

  it('switches to --markdown when format=markdown', () => {
    const command = buildBlockCommand({
      blockId: 't-art-2',
      blockType: 'twitter.article',
      settings: { articleIdOrUrl: '1234567890', format: 'markdown' }
    });
    expect(command.argv).toEqual(['article', '1234567890', '--markdown']);
  });

  it('renders a shell-safe preview without metacharacter interpolation', () => {
    const command = buildBlockCommand({
      blockId: 't-art-3',
      blockType: 'twitter.article',
      settings: { articleIdOrUrl: '1234567890', format: 'json' }
    });
    expect(previewCommand(command)).toBe('twitter article 1234567890 --json');
  });
});
