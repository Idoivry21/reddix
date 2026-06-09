import type { BlockSpec, FieldOption } from './types';

// Per-fetch result-count bounds, shared by every source block's limit/maxCount
// field so the cap is single-sourced and self-documenting.
const MIN_FETCH_LIMIT = 1;
const MAX_FETCH_LIMIT = 1000;

const socialArrayPort = { id: 'items', label: 'Items', type: 'SocialItem[]' as const };
const artifactPort = { id: 'artifact', label: 'Artifact', type: 'FileArtifact' as const };
const redditSortOptions = options(['hot', 'new', 'top', 'rising', 'controversial']);
const redditSearchSortOptions = options(['relevance', 'hot', 'top', 'new', 'comments']);
const redditTimeRangeOptions = options(['hour', 'day', 'week', 'month', 'year', 'all']);
const twitterSearchTabOptions = options(['latest', 'top', 'media']);
const twitterTimelineOptions = options(['following', 'for-you']);
const QUERY_MAX_LENGTH = 4096;
const SHORT_TEXT_MAX_LENGTH = 256;
const EXPORT_PATH_MAX_LENGTH = 512;
const WEBHOOK_URL_MAX_LENGTH = 2048;
const ENV_VAR_NAME_MAX_LENGTH = 128;
// An env var name: leading letter/underscore, then word chars. Single-sourced so
// the block field validation and `collectWebhookSecrets` resolution stay aligned.
export const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const blockSpecs: BlockSpec[] = [
  {
    type: 'reddit.searchPosts',
    label: 'Search Reddit',
    provider: 'reddit',
    category: 'Sources',
    priority: 'P0',
    description: 'Search Reddit posts and comments with compact JSON output.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'rdt',
    fields: [
      { key: 'query', label: 'Query', type: 'text', required: true, maxLength: QUERY_MAX_LENGTH },
      { key: 'subreddit', label: 'Subreddit', type: 'text', maxLength: SHORT_TEXT_MAX_LENGTH },
      {
        key: 'sort',
        label: 'Sort',
        type: 'select',
        options: redditSearchSortOptions
      },
      {
        key: 'timeRange',
        label: 'Time Range',
        type: 'select',
        options: redditTimeRangeOptions
      },
      { key: 'limit', label: 'Limit', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT }
    ],
    defaultSettings: {
      query: 'CLI tools',
      subreddit: 'localdev',
      sort: 'relevance',
      timeRange: 'month',
      limit: 100
    },
    note: 'Compact output — body/comment fields may be truncated. Add Read Post downstream for full bodies.'
  },
  {
    type: 'reddit.browseSubreddit',
    label: 'Subreddit Posts',
    provider: 'reddit',
    category: 'Sources',
    priority: 'P1',
    description: 'Browse a subreddit listing.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'rdt',
    fields: [
      { key: 'subreddit', label: 'Subreddit', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH },
      { key: 'sort', label: 'Sort', type: 'select', options: redditSortOptions },
      { key: 'timeRange', label: 'Time Range', type: 'select', options: redditTimeRangeOptions },
      { key: 'limit', label: 'Limit', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT }
    ],
    defaultSettings: { subreddit: 'localdev', sort: 'hot', timeRange: 'day', limit: 50 }
  },
  {
    type: 'reddit.popularAll',
    label: 'Popular / All',
    provider: 'reddit',
    category: 'Sources',
    priority: 'P1',
    description: 'Read Reddit popular or all listings.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'rdt',
    fields: [
      { key: 'listing', label: 'Listing', type: 'select', options: options(['popular', 'all']) },
      { key: 'limit', label: 'Limit', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT }
    ],
    defaultSettings: { listing: 'popular', limit: 50 }
  },
  {
    type: 'reddit.readPost',
    label: 'Read Post',
    provider: 'reddit',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read a Reddit post by stable ID.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    executable: 'rdt',
    fields: [
      { key: 'postId', label: 'Post ID', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH },
      { key: 'expandMore', label: 'Expand More', type: 'boolean' }
    ],
    defaultSettings: { postId: '', expandMore: false },
    note: 'Blank Post ID → fans out, one call per distinct upstream item (≤50; duplicate and wrong-platform items are skipped). Comments are not exported — post record only.'
  },
  {
    type: 'twitter.searchTweets',
    label: 'Search Tweets',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P0',
    description: 'Search X/Twitter and return structured tweet results.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'query', label: 'Query', type: 'text', required: true, maxLength: QUERY_MAX_LENGTH },
      { key: 'tab', label: 'Tab', type: 'select', options: twitterSearchTabOptions },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT },
      { key: 'language', label: 'Language', type: 'text', maxLength: 16, pattern: /^[A-Za-z-]+$/ },
      { key: 'fromUser', label: 'From User', type: 'text', maxLength: SHORT_TEXT_MAX_LENGTH },
      { key: 'since', label: 'Since', type: 'text', maxLength: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ },
      { key: 'excludeRetweets', label: 'Exclude Retweets', type: 'boolean' },
      { key: 'hasLinks', label: 'Has Links', type: 'boolean' },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: {
      query: 'CI automation',
      tab: 'latest',
      maxCount: 100,
      language: 'en',
      fromUser: '',
      since: '',
      excludeRetweets: true,
      hasLinks: false,
      fullText: true
    },
    note: 'Requires TWITTER_AUTH_TOKEN and TWITTER_CT0 in the environment.'
  },
  {
    type: 'twitter.timelineFeed',
    label: 'Timeline Feed',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read the For You or Following timeline.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'timeline', label: 'Timeline', type: 'select', options: twitterTimelineOptions },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { timeline: 'following', maxCount: 50, fullText: true },
    note: 'Requires TWITTER_AUTH_TOKEN and TWITTER_CT0 in the environment.'
  },
  {
    type: 'twitter.bookmarks',
    label: 'Bookmarks',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read authenticated X/Twitter bookmarks.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'maxCount', label: 'Max Count', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { maxCount: 50, fullText: true },
    note: 'Requires TWITTER_AUTH_TOKEN and TWITTER_CT0 in the environment.'
  },
  {
    type: 'twitter.userTweets',
    label: 'User Tweets',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read posts by handle.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'handle', label: 'Handle', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: MIN_FETCH_LIMIT, max: MAX_FETCH_LIMIT },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { handle: 'public_cli', maxCount: 50, fullText: true }
  },
  {
    type: 'twitter.listTimeline',
    label: 'List Timeline',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read an X/Twitter list timeline.',
    ports: { input: [], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'listId', label: 'List ID', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { listId: '', fullText: true }
  },
  {
    type: 'twitter.tweetDetail',
    label: 'Tweet Detail',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read a single tweet by ID or URL.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'tweetIdOrUrl', label: 'Tweet ID or URL', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH, format: 'twitter-id-or-url' },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { tweetIdOrUrl: '', fullText: true },
    note: 'Blank Tweet ID/URL → fans out, one call per distinct upstream item (≤50; duplicate and wrong-platform items are skipped).'
  },
  {
    type: 'twitter.userProfile',
    label: 'User Profile',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read X/Twitter user metadata.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [{ key: 'handle', label: 'Handle', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH }],
    defaultSettings: { handle: '' },
    note: 'Blank Handle → fans out, one call per distinct upstream item (≤50; duplicate and wrong-platform items are skipped).'
  },
  {
    type: 'twitter.article',
    label: 'Article',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read an X/Twitter article by ID or URL.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    executable: 'twitter',
    fields: [
      { key: 'articleIdOrUrl', label: 'Article ID or URL', type: 'text', required: true, maxLength: SHORT_TEXT_MAX_LENGTH, format: 'twitter-id-or-url' },
      { key: 'format', label: 'Format', type: 'select', options: options(['json', 'markdown']) }
    ],
    defaultSettings: { articleIdOrUrl: '', format: 'json' },
    note: 'Map the ID/URL field from upstream to enrich per item; otherwise reads one.'
  },
  {
    type: 'transform.limit',
    label: 'Limit',
    provider: 'local',
    category: 'Transform',
    priority: 'P0',
    description: 'Cap result count.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [{ key: 'limit', label: 'Limit', type: 'number', required: true, min: MIN_FETCH_LIMIT }],
    defaultSettings: { limit: 100 }
  },
  {
    type: 'transform.filterText',
    label: 'Filter Text',
    provider: 'local',
    category: 'Transform',
    priority: 'P0',
    description: 'Include or exclude text across normalized fields.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [
      { key: 'include', label: 'Include', type: 'text', maxLength: QUERY_MAX_LENGTH },
      { key: 'exclude', label: 'Exclude', type: 'text', maxLength: QUERY_MAX_LENGTH }
    ],
    defaultSettings: { include: 'cli automation', exclude: '' }
  },
  {
    type: 'transform.engagementFilter',
    label: 'Engagement Filter',
    provider: 'local',
    category: 'Transform',
    priority: 'P0',
    description: 'Filter by platform-appropriate engagement fields.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [
      { key: 'minScore', label: 'Min Score', type: 'number', min: 0 },
      { key: 'minComments', label: 'Min Comments', type: 'number', min: 0 },
      { key: 'minReplies', label: 'Min Replies', type: 'number', min: 0 },
      { key: 'minLikes', label: 'Min Likes', type: 'number', min: 0 },
      { key: 'minRetweets', label: 'Min Retweets', type: 'number', min: 0 },
      { key: 'minBookmarks', label: 'Min Bookmarks', type: 'number', min: 0 },
      { key: 'minViews', label: 'Min Views', type: 'number', min: 0 }
    ],
    defaultSettings: {
      minScore: 0,
      minComments: 0,
      minReplies: 0,
      minLikes: 10,
      minRetweets: 0,
      minBookmarks: 0,
      minViews: 0
    }
  },
  {
    type: 'transform.sortLocal',
    label: 'Sort Local',
    provider: 'local',
    category: 'Transform',
    priority: 'P1',
    description: 'Sort normalized social items.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [
      {
        key: 'field',
        label: 'Field',
        type: 'select',
        options: options([
          'createdAt',
          'score',
          'comments',
          'replies',
          'likes',
          'retweets',
          'bookmarks',
          'views'
        ])
      }
    ],
    defaultSettings: { field: 'createdAt' }
  },
  {
    type: 'transform.mergeStreams',
    label: 'Merge Streams',
    provider: 'local',
    category: 'Transform',
    priority: 'P1',
    description: 'Merge compatible social item streams.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [],
    defaultSettings: {},
    note: 'Wire 2+ streams in; provenance (source block) is preserved.'
  },
  {
    type: 'output.exportJson',
    label: 'Export JSON',
    provider: 'local',
    category: 'Output',
    priority: 'P0',
    description: 'Write normalized results to JSON.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [
      { key: 'path', label: 'Path', type: 'path', required: true, maxLength: EXPORT_PATH_MAX_LENGTH, extensions: ['.json'] },
      { key: 'pretty', label: 'Pretty Print', type: 'boolean' }
    ],
    defaultSettings: { path: 'outputs/research.json', pretty: true }
  },
  {
    type: 'output.exportCsv',
    label: 'Export CSV',
    provider: 'local',
    category: 'Output',
    priority: 'P0',
    description: 'Write normalized results to CSV.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [{ key: 'path', label: 'Path', type: 'path', required: true, maxLength: EXPORT_PATH_MAX_LENGTH, extensions: ['.csv'] }],
    defaultSettings: { path: 'outputs/research.csv' }
  },
  {
    type: 'output.exportMarkdown',
    label: 'Export Markdown',
    provider: 'local',
    category: 'Output',
    priority: 'P1',
    description: 'Write a research digest grouped by platform.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [{ key: 'path', label: 'Path', type: 'path', required: true, maxLength: EXPORT_PATH_MAX_LENGTH, extensions: ['.md'] }],
    defaultSettings: { path: 'outputs/research.md' }
  },
  {
    type: 'output.exportHtml',
    label: 'Export HTML Report',
    provider: 'local',
    category: 'Output',
    priority: 'P1',
    description: 'Write a styled, self-contained HTML report of results.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [{ key: 'path', label: 'Path', type: 'path', required: true, maxLength: EXPORT_PATH_MAX_LENGTH, extensions: ['.html'] }],
    defaultSettings: { path: 'outputs/report.html' },
    note: 'Self-contained report; content is escaped and only http(s) links are allowed.'
  },
  {
    type: 'output.webhook',
    label: 'Send Webhook',
    provider: 'local',
    category: 'Output',
    priority: 'P1',
    description: 'POST flow results to an HTTPS webhook endpoint.',
    // Terminal sink: consumes items, emits nothing back into the flow (no output port).
    ports: { input: [socialArrayPort], output: [] },
    fields: [
      {
        key: 'url',
        label: 'URL',
        type: 'text',
        required: true,
        maxLength: WEBHOOK_URL_MAX_LENGTH,
        pattern: /^https:\/\//,
        help: 'HTTPS endpoint to POST results to.'
      },
      {
        key: 'authTokenEnvVar',
        label: 'Auth Token Env Var',
        type: 'text',
        maxLength: ENV_VAR_NAME_MAX_LENGTH,
        pattern: ENV_VAR_NAME_PATTERN,
        help: 'Optional env var name holding a bearer token. Sent as Authorization: Bearer. The value is never stored or logged.'
      }
    ],
    defaultSettings: { url: '', authTokenEnvVar: '' },
    note: 'POSTs {flowName, runId, count, items} as JSON. HTTPS only. Auth token is read from the named env var at run time and never stored or logged.'
  },
  {
    type: 'utility.note',
    label: 'Note',
    provider: 'local',
    category: 'Utility',
    priority: 'P1',
    description: 'Canvas-only annotation.',
    ports: { input: [], output: [{ id: 'any', label: 'Any', type: 'Any' }] },
    fields: [{ key: 'text', label: 'Text', type: 'text', maxLength: QUERY_MAX_LENGTH }],
    defaultSettings: { text: 'Research note' }
  }
];

export const blockSpecByType = new Map(blockSpecs.map((spec) => [spec.type, spec]));

function options(values: string[]): FieldOption[] {
  return values.map((value) => ({ label: value, value }));
}
