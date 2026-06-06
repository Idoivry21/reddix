import type { BlockSpec } from './types';

const socialArrayPort = { id: 'items', label: 'Items', type: 'SocialItem[]' as const };
const detailPort = { id: 'detail', label: 'Detail', type: 'DetailObject' as const };
const artifactPort = { id: 'artifact', label: 'Artifact', type: 'FileArtifact' as const };

export const blockSpecs: BlockSpec[] = [
  {
    type: 'reddit.searchPosts',
    label: 'Search Reddit',
    provider: 'reddit',
    category: 'Sources',
    priority: 'P0',
    description: 'Search Reddit posts and comments with compact JSON output.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'rdt' },
    fields: [
      { key: 'query', label: 'Query', type: 'text', required: true },
      { key: 'subreddit', label: 'Subreddit', type: 'text' },
      {
        key: 'sort',
        label: 'Sort',
        type: 'select',
        options: ['relevance', 'hot', 'top', 'new', 'comments'].map((value) => ({
          label: value,
          value
        }))
      },
      {
        key: 'timeRange',
        label: 'Time Range',
        type: 'select',
        options: ['hour', 'day', 'week', 'month', 'year', 'all'].map((value) => ({
          label: value,
          value
        }))
      },
      { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 1000 }
    ],
    defaultSettings: {
      query: 'CLI tools',
      subreddit: 'localdev',
      sort: 'relevance',
      timeRange: 'month',
      limit: 100
    }
  },
  {
    type: 'reddit.browseSubreddit',
    label: 'Subreddit Posts',
    provider: 'reddit',
    category: 'Sources',
    priority: 'P1',
    description: 'Browse a subreddit listing.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'rdt' },
    fields: [
      { key: 'subreddit', label: 'Subreddit', type: 'text', required: true },
      { key: 'sort', label: 'Sort', type: 'select' },
      { key: 'timeRange', label: 'Time Range', type: 'select' },
      { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 1000 }
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
    command: { executable: 'rdt' },
    fields: [
      { key: 'listing', label: 'Listing', type: 'select' },
      { key: 'limit', label: 'Limit', type: 'number', min: 1, max: 1000 }
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
    ports: { input: [socialArrayPort], output: [detailPort] },
    command: { executable: 'rdt' },
    fields: [
      { key: 'postId', label: 'Post ID', type: 'text', required: true },
      { key: 'expandMore', label: 'Expand More', type: 'boolean' }
    ],
    defaultSettings: { postId: '', expandMore: false }
  },
  {
    type: 'twitter.searchTweets',
    label: 'Search Tweets',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P0',
    description: 'Search X/Twitter and return structured tweet results.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'query', label: 'Query', type: 'text', required: true },
      { key: 'tab', label: 'Tab', type: 'select' },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: 1, max: 1000 },
      { key: 'language', label: 'Language', type: 'text' },
      { key: 'fromUser', label: 'From User', type: 'text' },
      { key: 'since', label: 'Since', type: 'text' },
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
    }
  },
  {
    type: 'twitter.timelineFeed',
    label: 'Timeline Feed',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read the For You or Following timeline.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'timeline', label: 'Timeline', type: 'select' },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: 1, max: 1000 },
      { key: 'cursor', label: 'Cursor', type: 'text' },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { timeline: 'following', maxCount: 50, cursor: '', fullText: true }
  },
  {
    type: 'twitter.bookmarks',
    label: 'Bookmarks',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read authenticated X/Twitter bookmarks.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'maxCount', label: 'Max Count', type: 'number', min: 1, max: 1000 },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { maxCount: 50, fullText: true }
  },
  {
    type: 'twitter.userTweets',
    label: 'User Tweets',
    provider: 'twitter',
    category: 'Sources',
    priority: 'P1',
    description: 'Read posts by handle.',
    ports: { input: [], output: [socialArrayPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'handle', label: 'Handle', type: 'text', required: true },
      { key: 'maxCount', label: 'Max Count', type: 'number', min: 1, max: 1000 },
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
    command: { executable: 'twitter' },
    fields: [
      { key: 'listId', label: 'List ID', type: 'text', required: true },
      { key: 'cursor', label: 'Cursor', type: 'text' },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { listId: '', cursor: '', fullText: true }
  },
  {
    type: 'twitter.tweetDetail',
    label: 'Tweet Detail',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read a single tweet by ID or URL.',
    ports: { input: [socialArrayPort], output: [detailPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'tweetIdOrUrl', label: 'Tweet ID or URL', type: 'text', required: true },
      { key: 'fullText', label: 'Full Text', type: 'boolean' }
    ],
    defaultSettings: { tweetIdOrUrl: '', fullText: true }
  },
  {
    type: 'twitter.userProfile',
    label: 'User Profile',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read X/Twitter user metadata.',
    ports: { input: [socialArrayPort], output: [detailPort] },
    command: { executable: 'twitter' },
    fields: [{ key: 'handle', label: 'Handle', type: 'text', required: true }],
    defaultSettings: { handle: '' }
  },
  {
    type: 'twitter.article',
    label: 'Article',
    provider: 'twitter',
    category: 'Enrichment',
    priority: 'P1',
    description: 'Read an X/Twitter article by ID or URL.',
    ports: { input: [socialArrayPort], output: [detailPort] },
    command: { executable: 'twitter' },
    fields: [
      { key: 'articleIdOrUrl', label: 'Article ID or URL', type: 'text', required: true },
      { key: 'format', label: 'Format', type: 'select' }
    ],
    defaultSettings: { articleIdOrUrl: '', format: 'json' }
  },
  {
    type: 'transform.limit',
    label: 'Limit',
    provider: 'local',
    category: 'Transform',
    priority: 'P0',
    description: 'Cap result count.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [{ key: 'limit', label: 'Limit', type: 'number', required: true, min: 1 }],
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
      { key: 'include', label: 'Include', type: 'text' },
      { key: 'exclude', label: 'Exclude', type: 'text' }
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
      { key: 'minLikes', label: 'Min Likes', type: 'number', min: 0 },
      { key: 'minReplies', label: 'Min Replies', type: 'number', min: 0 }
    ],
    defaultSettings: { minScore: 0, minLikes: 10, minReplies: 0 }
  },
  {
    type: 'transform.sortLocal',
    label: 'Sort Local',
    provider: 'local',
    category: 'Transform',
    priority: 'P1',
    description: 'Sort normalized social items.',
    ports: { input: [socialArrayPort], output: [socialArrayPort] },
    fields: [{ key: 'field', label: 'Field', type: 'select' }],
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
    defaultSettings: {}
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
      { key: 'path', label: 'Path', type: 'path', required: true },
      { key: 'pretty', label: 'Pretty Print', type: 'boolean' }
    ],
    defaultSettings: { path: 'outputs/reddit.json', pretty: true }
  },
  {
    type: 'output.exportCsv',
    label: 'Export CSV',
    provider: 'local',
    category: 'Output',
    priority: 'P0',
    description: 'Write normalized results to CSV.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [{ key: 'path', label: 'Path', type: 'path', required: true }],
    defaultSettings: { path: 'outputs/tweets.csv' }
  },
  {
    type: 'output.exportMarkdown',
    label: 'Export Markdown',
    provider: 'local',
    category: 'Output',
    priority: 'P1',
    description: 'Write a research digest grouped by platform.',
    ports: { input: [socialArrayPort], output: [artifactPort] },
    fields: [{ key: 'path', label: 'Path', type: 'path', required: true }],
    defaultSettings: { path: 'outputs/research.md' }
  },
  {
    type: 'utility.note',
    label: 'Note',
    provider: 'local',
    category: 'Utility',
    priority: 'P1',
    description: 'Canvas-only annotation.',
    ports: { input: [], output: [{ id: 'any', label: 'Any', type: 'Any' }] },
    fields: [{ key: 'text', label: 'Text', type: 'text' }],
    defaultSettings: { text: 'Research note' }
  }
];

export const blockSpecByType = new Map(blockSpecs.map((spec) => [spec.type, spec]));

