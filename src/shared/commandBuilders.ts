import { blockSpecs, blockSpecByType } from './blockSpecs';
import type { BlockSpec, BuiltCommand, CommandBuildInput } from './types';

export function listBlockSpecs(): BlockSpec[] {
  return blockSpecs;
}

export function getBlockSpec(blockType: string): BlockSpec {
  const spec = blockSpecByType.get(blockType);
  if (!spec) {
    throw new Error(`Unknown block type: ${blockType}`);
  }
  return spec;
}

export function getDefaultSettings(blockType: string): Record<string, unknown> {
  return { ...getBlockSpec(blockType).defaultSettings };
}

export function buildBlockCommand(input: CommandBuildInput): BuiltCommand {
  switch (input.blockType) {
    case 'reddit.searchPosts':
      return buildRedditSearch(input.settings);
    case 'reddit.browseSubreddit':
      return buildRedditSubreddit(input.settings);
    case 'reddit.popularAll':
      return buildRedditPopularAll(input.settings);
    case 'reddit.readPost':
      return buildRedditReadPost(input.settings);
    case 'twitter.searchTweets':
      return buildTwitterSearch(input.settings);
    case 'twitter.timelineFeed':
      return buildTwitterTimeline(input.settings);
    case 'twitter.bookmarks':
      return buildTwitterBookmarks(input.settings);
    case 'twitter.userTweets':
      return buildTwitterUserTweets(input.settings);
    case 'twitter.listTimeline':
      return buildTwitterListTimeline(input.settings);
    case 'twitter.tweetDetail':
      return buildTwitterTweetDetail(input.settings);
    case 'twitter.userProfile':
      return buildTwitterUserProfile(input.settings);
    case 'twitter.article':
      return buildTwitterArticle(input.settings);
    default:
      throw new Error(`Block type does not produce a CLI command: ${input.blockType}`);
  }
}

export function previewCommand(command: BuiltCommand): string {
  return [command.executable, ...command.displayArgv].map(formatArgForPreview).join(' ');
}

export function getProviderHealthCommands() {
  return [
    { provider: 'reddit' as const, executable: 'rdt' as const, argv: ['auth', 'status', '--json'] },
    {
      provider: 'twitter' as const,
      executable: 'twitter' as const,
      argv: ['auth', 'status', '--json']
    }
  ];
}

function buildRedditSearch(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'search',
    stringSetting(settings, 'query', 'CLI tools'),
    setting(settings, 'subreddit') && '--subreddit',
    setting(settings, 'subreddit'),
    '--sort',
    stringSetting(settings, 'sort', 'relevance'),
    '--time',
    stringSetting(settings, 'timeRange', 'month'),
    '--limit',
    numberSetting(settings, 'limit', 100).toString(),
    '--compact',
    '--json'
  ]);
  return { provider: 'reddit', executable: 'rdt', argv, displayArgv: [...argv] };
}

function buildRedditSubreddit(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'sub',
    stringSetting(settings, 'subreddit', 'localdev'),
    '--sort',
    stringSetting(settings, 'sort', 'hot'),
    '--time',
    stringSetting(settings, 'timeRange', 'day'),
    '--limit',
    numberSetting(settings, 'limit', 50).toString(),
    '--compact',
    '--json'
  ]);
  return { provider: 'reddit', executable: 'rdt', argv, displayArgv: [...argv] };
}

function buildRedditPopularAll(settings: Record<string, unknown>): BuiltCommand {
  const listing = stringSetting(settings, 'listing', 'popular') === 'all' ? 'all' : 'popular';
  const argv = [listing, '--limit', numberSetting(settings, 'limit', 50).toString(), '--compact', '--json'];
  return { provider: 'reddit', executable: 'rdt', argv, displayArgv: [...argv] };
}

function buildRedditReadPost(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'read',
    stringSetting(settings, 'postId', ''),
    boolSetting(settings, 'expandMore') && '--expand-more',
    '--json'
  ]);
  return { provider: 'reddit', executable: 'rdt', argv, displayArgv: [...argv] };
}

function buildTwitterSearch(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'search',
    stringSetting(settings, 'query', 'CI automation'),
    '--tab',
    stringSetting(settings, 'tab', 'latest'),
    '--max',
    numberSetting(settings, 'maxCount', 100).toString(),
    setting(settings, 'language') && '--lang',
    setting(settings, 'language'),
    setting(settings, 'fromUser') && '--from',
    setting(settings, 'fromUser'),
    setting(settings, 'since') && '--since',
    setting(settings, 'since'),
    boolSetting(settings, 'excludeRetweets') && '--exclude-retweets',
    boolSetting(settings, 'hasLinks') && '--has-links',
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterTimeline(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'feed',
    '--timeline',
    stringSetting(settings, 'timeline', 'following'),
    '--max',
    numberSetting(settings, 'maxCount', 50).toString(),
    setting(settings, 'cursor') && '--cursor',
    setting(settings, 'cursor'),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterBookmarks(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'bookmarks',
    '--max',
    numberSetting(settings, 'maxCount', 50).toString(),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterUserTweets(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'user-posts',
    stringSetting(settings, 'handle', ''),
    '--max',
    numberSetting(settings, 'maxCount', 50).toString(),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterListTimeline(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'list',
    stringSetting(settings, 'listId', ''),
    setting(settings, 'cursor') && '--cursor',
    setting(settings, 'cursor'),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterTweetDetail(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'tweet',
    stringSetting(settings, 'tweetIdOrUrl', ''),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterUserProfile(settings: Record<string, unknown>): BuiltCommand {
  const argv = ['user', stringSetting(settings, 'handle', ''), '--json'];
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function buildTwitterArticle(settings: Record<string, unknown>): BuiltCommand {
  const format = stringSetting(settings, 'format', 'json') === 'markdown' ? '--markdown' : '--json';
  const argv = ['article', stringSetting(settings, 'articleIdOrUrl', ''), format];
  return { provider: 'twitter', executable: 'twitter', argv, displayArgv: [...argv] };
}

function setting(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback: string): string {
  return setting(settings, key) ?? fallback;
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function boolSetting(settings: Record<string, unknown>, key: string): boolean {
  return settings[key] === true;
}

function compact(values: Array<string | false | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function formatArgForPreview(value: string): string {
  if (!value) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) {
    return value;
  }
  return `'${value.split("'").join("'\\''")}'`;
}
