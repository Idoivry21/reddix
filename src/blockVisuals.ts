import type { IconName } from './icons';
import type { BlockCategory, BlockSpec, ProviderId } from './shared/types';

/** Source-coded accent buckets that drive node/palette colors. */
export type AccentKey = 'reddit' | 'x' | 'transform' | 'output' | 'utility';

export interface BlockSummaryItem {
  key: string;
  value: string;
  /** Render the value in the accent color (the block's headline setting). */
  accent?: boolean;
}

/** Map a provider + category onto a source-coded accent bucket. */
export function accentForBlock(provider: ProviderId, category: BlockCategory): AccentKey {
  if (provider === 'reddit') {
    return 'reddit';
  }
  if (provider === 'twitter') {
    return 'x';
  }
  if (category === 'Output') {
    return 'output';
  }
  if (category === 'Utility') {
    return 'utility';
  }
  return 'transform';
}

const ICON_BY_TYPE: Record<string, IconName> = {
  'reddit.searchPosts': 'search',
  'reddit.browseSubreddit': 'hash',
  'reddit.popularAll': 'flame',
  'reddit.readPost': 'message',
  'twitter.searchTweets': 'search',
  'twitter.timelineFeed': 'layout',
  'twitter.bookmarks': 'bookmark',
  'twitter.userTweets': 'at',
  'twitter.listTimeline': 'list',
  'twitter.tweetDetail': 'message',
  'twitter.userProfile': 'user',
  'twitter.article': 'file',
  'transform.limit': 'scissors',
  'transform.filterText': 'filter',
  'transform.engagementFilter': 'filter',
  'transform.sortLocal': 'sort',
  'transform.mergeStreams': 'merge',
  'output.exportJson': 'braces',
  'output.exportCsv': 'download',
  'output.exportMarkdown': 'file',
  'output.webhook': 'send',
  'utility.note': 'sparkle',
  'reddit.upvote': 'flame',
  'reddit.save': 'bookmark',
  'reddit.subscribe': 'hash',
  'reddit.comment': 'message',
  'twitter.post': 'send',
  'twitter.reply': 'message',
  'twitter.quote': 'message',
  'twitter.retweet': 'merge',
  'twitter.like': 'sparkle',
  'twitter.bookmark': 'bookmark',
  'twitter.follow': 'user',
  'twitter.delete': 'scissors'
};

/** Icon for a block type, falling back to a neutral glyph. */
export function iconForBlock(blockType: string): IconName {
  return ICON_BY_TYPE[blockType] ?? 'table';
}

/** Short eyebrow label shown above the node title. */
export function eyebrowForAccent(accent: AccentKey): string {
  return accent === 'x' ? 'X' : accent;
}

const str = (value: unknown, fallback = ''): string => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return String(value);
};

/** Per-block summary rows for the node card body (label, value, accent flag). */
export function summaryForBlock(blockType: string, settings: Record<string, unknown>): BlockSummaryItem[] {
  switch (blockType) {
    case 'reddit.searchPosts':
      return [
        { key: 'q', value: str(settings.query, '—'), accent: true },
        { key: 'r/', value: str(settings.subreddit, 'all') },
        { key: 'n', value: str(settings.limit) }
      ];
    case 'reddit.browseSubreddit':
      return [
        { key: 'r/', value: str(settings.subreddit, '—'), accent: true },
        { key: 'sort', value: str(settings.sort) },
        { key: 'n', value: str(settings.limit) }
      ];
    case 'reddit.popularAll':
      return [
        { key: 'listing', value: str(settings.listing, 'popular'), accent: true },
        { key: 'n', value: str(settings.limit) }
      ];
    case 'reddit.readPost':
      return [{ key: 'id', value: str(settings.postId, '—'), accent: true }];
    case 'twitter.searchTweets':
      return [
        { key: 'q', value: str(settings.query, '—'), accent: true },
        { key: 'tab', value: str(settings.tab) },
        { key: 'n', value: str(settings.maxCount) }
      ];
    case 'twitter.timelineFeed':
      return [
        { key: 'feed', value: str(settings.timeline, 'following'), accent: true },
        { key: 'n', value: str(settings.maxCount) }
      ];
    case 'twitter.bookmarks':
      return [{ key: 'n', value: str(settings.maxCount), accent: true }];
    case 'twitter.userTweets':
      return [
        { key: '@', value: str(settings.handle, '—'), accent: true },
        { key: 'n', value: str(settings.maxCount) }
      ];
    case 'twitter.listTimeline':
      return [{ key: 'list', value: str(settings.listId, '—'), accent: true }];
    case 'twitter.tweetDetail':
      return [{ key: 'id', value: str(settings.tweetIdOrUrl, '—'), accent: true }];
    case 'twitter.userProfile':
      return [{ key: '@', value: str(settings.handle, '—'), accent: true }];
    case 'twitter.article':
      return [
        { key: 'id', value: str(settings.articleIdOrUrl, '—'), accent: true },
        { key: 'fmt', value: str(settings.format) }
      ];
    case 'transform.limit':
      return [{ key: 'n', value: str(settings.limit), accent: true }];
    case 'transform.filterText':
      return [
        { key: 'incl', value: str(settings.include, '—'), accent: true },
        { key: 'excl', value: str(settings.exclude, 'none') }
      ];
    case 'transform.engagementFilter':
      return [
        { key: '≥score', value: str(settings.minScore, '0') },
        { key: '≥likes', value: str(settings.minLikes, '0'), accent: true },
        { key: '≥reply', value: str(settings.minReplies, '0') }
      ];
    case 'transform.sortLocal':
      return [{ key: 'by', value: str(settings.field, 'createdAt'), accent: true }];
    case 'transform.mergeStreams':
      return [{ key: 'mode', value: 'concat' }];
    case 'output.exportJson':
    case 'output.exportCsv':
    case 'output.exportMarkdown':
      return [{ key: 'file', value: str(settings.path, '—'), accent: true }];
    case 'output.webhook':
      return [{ key: 'url', value: str(settings.url, '—'), accent: true }];
    case 'utility.note':
      return [{ key: 'note', value: str(settings.text, '—') }];
    case 'reddit.upvote':
    case 'reddit.save':
    case 'reddit.comment':
      return [{ key: 'id', value: str(settings.postId, 'upstream'), accent: true }];
    case 'reddit.subscribe':
      return [{ key: 'r/', value: str(settings.subreddit, '—'), accent: true }];
    case 'twitter.post':
    case 'twitter.reply':
    case 'twitter.quote':
      return [{ key: 'text', value: str(settings.text, '—'), accent: true }];
    case 'twitter.retweet':
    case 'twitter.like':
    case 'twitter.bookmark':
    case 'twitter.delete':
      return [{ key: 'id', value: str(settings.tweetId, 'upstream'), accent: true }];
    case 'twitter.follow':
      return [{ key: '@', value: str(settings.handle, 'upstream'), accent: true }];
    default:
      return [{ key: 'status', value: 'ready' }];
  }
}

export interface PaletteGroup {
  accent: AccentKey;
  label: string;
  specs: BlockSpec[];
}

const GROUP_ORDER: Array<{ accent: AccentKey; label: string }> = [
  { accent: 'reddit', label: 'Reddit' },
  { accent: 'x', label: 'X / Twitter' },
  { accent: 'transform', label: 'Transform' },
  { accent: 'output', label: 'Output' },
  { accent: 'utility', label: 'Utility' }
];

/** Group block specs into ordered, source-coded palette sections. */
export function buildPaletteGroups(specs: BlockSpec[]): PaletteGroup[] {
  return GROUP_ORDER.map(({ accent, label }) => ({
    accent,
    label,
    specs: specs.filter((spec) => accentForBlock(spec.provider, spec.category) === accent)
  })).filter((group) => group.specs.length > 0);
}
