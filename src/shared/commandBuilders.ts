import { blockSpecs, blockSpecByType } from './blockSpecs';
import { CLI_PROVIDERS } from './providers';
import type { BlockSpec, BuiltCommand, CommandBuildInput, FieldSpec } from './types';
import { coerceNumber, isBlank } from './values';

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
  const errors = validateBlockSettings(input.blockType, input.settings, {
    enforceRequired: false,
    rejectFlagLikeStrings: true
  });
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
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

interface ValidateSettingsOptions {
  enforceRequired: boolean;
  rejectFlagLikeStrings: boolean;
  optionalRequiredFields?: readonly string[];
}

export function validateBlockSettings(
  blockType: string,
  settings: Record<string, unknown>,
  options: ValidateSettingsOptions = { enforceRequired: true, rejectFlagLikeStrings: true }
): string[] {
  const spec = getBlockSpec(blockType);
  const errors: string[] = [];
  for (const field of spec.fields) {
    const value = settings[field.key];
    const requiredFieldCanBeFilledElsewhere = options.optionalRequiredFields?.includes(field.key) ?? false;
    if (options.enforceRequired && field.required && !requiredFieldCanBeFilledElsewhere && isBlank(value)) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (isBlank(value)) {
      continue;
    }
    errors.push(...validateFieldValue(spec, field, value, options));
  }
  return errors;
}

export function previewCommand(command: BuiltCommand): string {
  return [command.executable, ...command.displayArgv].map(formatArgForPreview).join(' ');
}

export function getProviderHealthCommands() {
  return CLI_PROVIDERS.map((meta) => ({
    provider: meta.id,
    executable: meta.executable,
    argv: ['status', '--json']
  }));
}

// Per-provider command wrappers: set provider + executable and the load-bearing
// `displayArgv: [...argv]` copy (the redaction boundary) in one place, so each
// builder only has to construct its argv.
const redditCommand = (argv: string[]): BuiltCommand => ({
  provider: 'reddit',
  executable: 'rdt',
  argv,
  displayArgv: [...argv]
});

const twitterCommand = (argv: string[]): BuiltCommand => ({
  provider: 'twitter',
  executable: 'twitter',
  argv,
  displayArgv: [...argv]
});

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
  return redditCommand(argv);
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
  return redditCommand(argv);
}

function buildRedditPopularAll(settings: Record<string, unknown>): BuiltCommand {
  const listing = stringSetting(settings, 'listing', 'popular') === 'all' ? 'all' : 'popular';
  const argv = [listing, '--limit', numberSetting(settings, 'limit', 50).toString(), '--compact', '--json'];
  return redditCommand(argv);
}

function buildRedditReadPost(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'read',
    stringSetting(settings, 'postId', ''),
    boolSetting(settings, 'expandMore') && '--expand-more',
    '--json'
  ]);
  return redditCommand(argv);
}

function buildTwitterSearch(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'search',
    stringSetting(settings, 'query', 'CI automation'),
    '--type',
    stringSetting(settings, 'tab', 'latest'),
    '--max',
    numberSetting(settings, 'maxCount', 100).toString(),
    setting(settings, 'language') && '--lang',
    setting(settings, 'language'),
    setting(settings, 'fromUser') && '--from',
    setting(settings, 'fromUser'),
    setting(settings, 'since') && '--since',
    setting(settings, 'since'),
    // twitter-cli uses repeatable value options, not bare flags:
    // `--exclude retweets`, `--has links` (not `--exclude-retweets`/`--has-links`).
    ...(boolSetting(settings, 'excludeRetweets') ? ['--exclude', 'retweets'] : []),
    ...(boolSetting(settings, 'hasLinks') ? ['--has', 'links'] : []),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return twitterCommand(argv);
}

function buildTwitterTimeline(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'feed',
    '--type',
    stringSetting(settings, 'timeline', 'following'),
    '--max',
    numberSetting(settings, 'maxCount', 50).toString(),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return twitterCommand(argv);
}

function buildTwitterBookmarks(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'bookmarks',
    '--max',
    numberSetting(settings, 'maxCount', 50).toString(),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return twitterCommand(argv);
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
  return twitterCommand(argv);
}

function buildTwitterListTimeline(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'list',
    stringSetting(settings, 'listId', ''),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return twitterCommand(argv);
}

function buildTwitterTweetDetail(settings: Record<string, unknown>): BuiltCommand {
  const argv = compact([
    'tweet',
    stringSetting(settings, 'tweetIdOrUrl', ''),
    boolSetting(settings, 'fullText') && '--full-text',
    '--json'
  ]);
  return twitterCommand(argv);
}

function buildTwitterUserProfile(settings: Record<string, unknown>): BuiltCommand {
  const argv = ['user', stringSetting(settings, 'handle', ''), '--json'];
  return twitterCommand(argv);
}

function buildTwitterArticle(settings: Record<string, unknown>): BuiltCommand {
  const format = stringSetting(settings, 'format', 'json') === 'markdown' ? '--markdown' : '--json';
  const argv = ['article', stringSetting(settings, 'articleIdOrUrl', ''), format];
  return twitterCommand(argv);
}

function setting(settings: Record<string, unknown>, key: string): string | undefined {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringSetting(settings: Record<string, unknown>, key: string, fallback: string): string {
  return setting(settings, key) ?? fallback;
}

function numberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  return coerceNumber(settings[key], fallback);
}

function boolSetting(settings: Record<string, unknown>, key: string): boolean {
  return settings[key] === true;
}

function validateFieldValue(
  spec: BlockSpec,
  field: FieldSpec,
  value: unknown,
  options: ValidateSettingsOptions
): string[] {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? [] : [`${field.label} must be a boolean`];
  }
  if (field.type === 'number') {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(numeric)) {
      return [`${field.label} must be a number`];
    }
    if (field.min !== undefined && numeric < field.min) {
      return [`${field.label} must be at least ${field.min}`];
    }
    if (field.max !== undefined && numeric > field.max) {
      return [`${field.label} must be at most ${field.max}`];
    }
    return [];
  }
  if (field.type === 'select') {
    const allowed = field.options?.map((option) => option.value) ?? [];
    if (!allowed.some((allowedValue) => allowedValue === value)) {
      return [`${field.label} must be one of: ${allowed.map(String).join(', ')}`];
    }
    return [];
  }
  if (typeof value !== 'string') {
    return [`${field.label} must be text`];
  }
  if (options.rejectFlagLikeStrings && spec.executable && value.trim().startsWith('-')) {
    return [`${field.label} cannot start with "-"`];
  }
  return [];
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
