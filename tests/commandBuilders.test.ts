import { describe, expect, it } from 'vitest';
import {
  buildBlockCommand,
  getBlockSpec,
  getDefaultSettings,
  getProviderHealthCommands,
  listBlockSpecs,
  previewCommand
} from '../src/shared/commandBuilders';

describe('provider command builders', () => {
  it('builds Reddit search as a fixed argv array with query as one value', () => {
    const command = buildBlockCommand({
      blockId: 'reddit-source-1',
      blockType: 'reddit.searchPosts',
      settings: {
        query: 'cli automation && rm -rf /',
        subreddit: 'localdev',
        sort: 'relevance',
        timeRange: 'month',
        limit: 50
      }
    });

    expect(command).toEqual({
      provider: 'reddit',
      executable: 'rdt',
      argv: [
        'search',
        'cli automation && rm -rf /',
        '--subreddit',
        'localdev',
        '--sort',
        'relevance',
        '--time',
        'month',
        '--limit',
        '50',
        '--compact',
        '--json'
      ],
      displayArgv: [
        'search',
        'cli automation && rm -rf /',
        '--subreddit',
        'localdev',
        '--sort',
        'relevance',
        '--time',
        'month',
        '--limit',
        '50',
        '--compact',
        '--json'
      ]
    });
  });

  it('builds Twitter search as a fixed argv array with query as one value', () => {
    const command = buildBlockCommand({
      blockId: 'twitter-source-1',
      blockType: 'twitter.searchTweets',
      settings: {
        query: 'automation; echo leaked',
        tab: 'latest',
        maxCount: 25,
        language: 'en',
        fromUser: 'public_cli',
        since: '2026-01-01',
        excludeRetweets: true,
        hasLinks: true,
        fullText: true
      }
    });

    expect(command.executable).toBe('twitter');
    expect(command.argv).toEqual([
      'search',
      'automation; echo leaked',
      '--type',
      'latest',
      '--max',
      '25',
      '--lang',
      'en',
      '--from',
      'public_cli',
      '--since',
      '2026-01-01',
      '--exclude',
      'retweets',
      '--has',
      'links',
      '--full-text',
      '--json'
    ]);
  });

  it('builds Twitter timeline feed with --type and no unsupported --cursor', () => {
    const command = buildBlockCommand({
      blockId: 'twitter-feed-1',
      blockType: 'twitter.timelineFeed',
      settings: { timeline: 'following', maxCount: 20, fullText: true }
    });

    expect(command.argv).toEqual(['feed', '--type', 'following', '--max', '20', '--full-text', '--json']);
  });

  it('builds Twitter list timeline without unsupported --cursor', () => {
    const command = buildBlockCommand({
      blockId: 'twitter-list-1',
      blockType: 'twitter.listTimeline',
      settings: { listId: '12345', fullText: true }
    });

    expect(command.argv).toEqual(['list', '12345', '--full-text', '--json']);
  });

  it('exposes P0 and P1 block specs grouped by provider and category', () => {
    const specs = listBlockSpecs();

    expect(specs.map((spec) => spec.type)).toContain('reddit.searchPosts');
    expect(specs.map((spec) => spec.type)).toContain('twitter.searchTweets');
    expect(getBlockSpec('transform.filterText').ports.input[0].type).toBe('SocialItem[]');
    expect(getBlockSpec('output.exportCsv').priority).toBe('P0');
  });

  it('registers output.exportHtml as a local block with a required path field and default', () => {
    const spec = getBlockSpec('output.exportHtml');

    expect(spec.provider).toBe('local');
    expect(spec.category).toBe('Output');
    expect(spec.executable).toBeUndefined();
    expect(spec.ports.input[0].type).toBe('SocialItem[]');
    const pathField = spec.fields.find((field) => field.key === 'path');
    expect(pathField?.required).toBe(true);
    expect(getDefaultSettings('output.exportHtml').path).toBe('outputs/report.html');
  });

  it('creates command preview text without shell concatenation semantics', () => {
    const command = buildBlockCommand({
      blockId: 'reddit-source-1',
      blockType: 'reddit.searchPosts',
      settings: getDefaultSettings('reddit.searchPosts')
    });

    expect(previewCommand(command)).toBe(
      "rdt search 'CLI tools' --subreddit localdev --sort relevance --time month --limit 100 --compact --json"
    );
  });

  it('builds provider health checks without secrets', () => {
    expect(getProviderHealthCommands()).toEqual([
      { provider: 'reddit', executable: 'rdt', argv: ['status', '--json'] },
      { provider: 'twitter', executable: 'twitter', argv: ['status', '--json'] }
    ]);
  });

  it('exposes a UI field for every engagement threshold the filter reads', () => {
    // Guards against the filter reading a threshold the Inspector cannot configure.
    const spec = getBlockSpec('transform.engagementFilter');
    const fieldKeys = spec.fields.map((field) => field.key).sort();
    expect(fieldKeys).toEqual(
      ['minBookmarks', 'minComments', 'minLikes', 'minReplies', 'minRetweets', 'minScore', 'minViews'].sort()
    );
  });

  it('exposes every sortable engagement field for local sorting', () => {
    const spec = getBlockSpec('transform.sortLocal');
    const field = spec.fields.find((candidate) => candidate.key === 'field');
    const optionValues = field?.options?.map((option) => option.value).sort();

    expect(optionValues).toEqual([
      'bookmarks',
      'comments',
      'createdAt',
      'likes',
      'replies',
      'retweets',
      'score',
      'views'
    ]);
  });

  it('defines explicit options for every select field', () => {
    for (const spec of listBlockSpecs()) {
      for (const field of spec.fields.filter((candidate) => candidate.type === 'select')) {
        expect(field.options?.length, `${spec.type}.${field.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('rejects crafted command settings that would inject flags', () => {
    expect(() =>
      buildBlockCommand({
        blockId: 'reddit-source-1',
        blockType: 'reddit.searchPosts',
        settings: { query: '--proxy http://evil.example', sort: 'relevance', timeRange: 'month', limit: 10 }
      })
    ).toThrow(/query/i);
  });

  it('rejects select values outside the block spec options', () => {
    expect(() =>
      buildBlockCommand({
        blockId: 'twitter-source-1',
        blockType: 'twitter.searchTweets',
        settings: { query: 'cli', tab: '--output=/tmp/x', maxCount: 10 }
      })
    ).toThrow(/tab/i);
  });
});
