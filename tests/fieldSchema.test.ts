import { describe, expect, it } from 'vitest';
import {
  availableInputFields,
  getSocialItemField,
  outputFieldsForBlock,
  SOCIAL_ITEM_FIELDS
} from '../src/shared/fieldSchema';
import type { SocialItem } from '../src/shared/types';

function keys(blockType: string): string[] {
  return outputFieldsForBlock(blockType).map((field) => field.key);
}

function item(overrides: Partial<SocialItem> = {}): SocialItem {
  return {
    platform: 'reddit',
    sourceBlockId: 'src',
    id: 'r-1',
    url: 'https://reddit.com/r/x/1',
    author: 'alice',
    community: 'localdev',
    title: 'A title',
    body: 'A body',
    text: 'text content',
    createdAt: '2026-06-06T20:54:29Z',
    engagement: { score: 42, comments: 7 },
    media: [{ type: 'image', url: 'https://img/1' }],
    links: ['https://link/1'],
    raw: {},
    ...overrides
  };
}

describe('outputFieldsForBlock', () => {
  it('narrows a reddit source to reddit + shared fields, excluding twitter-only', () => {
    const out = keys('reddit.searchPosts');
    expect(out).toContain('title');
    expect(out).toContain('engagement.score');
    expect(out).toContain('id');
    expect(out).not.toContain('engagement.likes');
    expect(out).not.toContain('engagement.retweets');
  });

  it('narrows a twitter source to twitter + shared fields, excluding reddit-only', () => {
    const out = keys('twitter.searchTweets');
    expect(out).toContain('engagement.likes');
    expect(out).toContain('text');
    expect(out).not.toContain('title');
    expect(out).not.toContain('engagement.score');
    expect(out).not.toContain('community');
  });

  it('returns the full union for a pass-through transform', () => {
    const out = keys('transform.filterText');
    expect(out).toEqual(SOCIAL_ITEM_FIELDS.map((field) => field.key));
  });

  it('returns the artifact descriptor for an output block', () => {
    expect(keys('output.exportJson')).toEqual(['path', 'bytes']);
  });

  it('returns nothing for a block whose output port is not SocialItem[]', () => {
    expect(outputFieldsForBlock('utility.note')).toEqual([]);
  });
});

describe('availableInputFields', () => {
  const nodes = [
    { id: 'reddit', type: 'reddit.searchPosts' },
    { id: 'twitter', type: 'twitter.searchTweets' },
    { id: 'merge', type: 'transform.mergeStreams' },
    { id: 'limit', type: 'transform.limit' },
    { id: 'export', type: 'output.exportJson' }
  ];

  it('returns nothing for a node with no upstream', () => {
    expect(availableInputFields('reddit', nodes, [])).toEqual([]);
  });

  it('propagates a single source schema to a downstream transform', () => {
    const edges = [{ source: 'reddit', target: 'limit' }];
    const out = availableInputFields('limit', nodes, edges).map((field) => field.key);
    expect(out).toContain('title');
    expect(out).toContain('engagement.score');
    expect(out).not.toContain('engagement.likes');
  });

  it('unions reddit + twitter sources through a merge', () => {
    const edges = [
      { source: 'reddit', target: 'merge' },
      { source: 'twitter', target: 'merge' },
      { source: 'merge', target: 'export' }
    ];
    const out = availableInputFields('export', nodes, edges).map((field) => field.key);
    expect(out).toContain('title'); // reddit-only
    expect(out).toContain('engagement.likes'); // twitter-only
  });

  it('walks transitively across a transform chain', () => {
    const edges = [
      { source: 'reddit', target: 'limit' },
      { source: 'limit', target: 'export' }
    ];
    const out = availableInputFields('export', nodes, edges).map((field) => field.key);
    expect(out).toContain('title');
  });

  it('dedups fields when a diamond reaches the same source twice', () => {
    const diamond = [
      { id: 'a', type: 'reddit.searchPosts' },
      { id: 'b', type: 'transform.limit' },
      { id: 'c', type: 'transform.limit' },
      { id: 'd', type: 'transform.mergeStreams' }
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' }
    ];
    const out = availableInputFields('d', diamond, edges).map((field) => field.key);
    const idCount = out.filter((key) => key === 'id').length;
    expect(idCount).toBe(1);
  });
});

describe('getSocialItemField', () => {
  it('reads a top-level string field', () => {
    expect(getSocialItemField(item(), 'author')).toBe('alice');
  });

  it('reads a dotted engagement field and stringifies the number', () => {
    expect(getSocialItemField(item(), 'engagement.score')).toBe('42');
  });

  it('returns null for an engagement field absent on the item', () => {
    expect(getSocialItemField(item({ engagement: {} }), 'engagement.likes')).toBeNull();
  });

  it('returns null for array fields (media/links) and unknown keys', () => {
    expect(getSocialItemField(item(), 'media')).toBeNull();
    expect(getSocialItemField(item(), 'links')).toBeNull();
    expect(getSocialItemField(item(), 'raw')).toBeNull();
    expect(getSocialItemField(item(), 'nope')).toBeNull();
  });

  it('returns null for blank or null values and trims the rest', () => {
    expect(getSocialItemField(item({ url: null }), 'url')).toBeNull();
    expect(getSocialItemField(item({ author: '   ' }), 'author')).toBeNull();
    expect(getSocialItemField(item({ id: '  r-9  ' }), 'id')).toBe('r-9');
  });
});
