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
      '--tab',
      'latest',
      '--max',
      '25',
      '--lang',
      'en',
      '--from',
      'public_cli',
      '--since',
      '2026-01-01',
      '--exclude-retweets',
      '--has-links',
      '--full-text',
      '--json'
    ]);
  });

  it('exposes P0 and P1 block specs grouped by provider and category', () => {
    const specs = listBlockSpecs();

    expect(specs.map((spec) => spec.type)).toContain('reddit.searchPosts');
    expect(specs.map((spec) => spec.type)).toContain('twitter.searchTweets');
    expect(getBlockSpec('transform.filterText').ports.input[0].type).toBe('SocialItem[]');
    expect(getBlockSpec('output.exportCsv').priority).toBe('P0');
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
      { provider: 'reddit', executable: 'rdt', argv: ['auth', 'status', '--json'] },
      { provider: 'twitter', executable: 'twitter', argv: ['auth', 'status', '--json'] }
    ]);
  });
});

