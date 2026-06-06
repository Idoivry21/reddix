import { describe, expect, it } from 'vitest';
import {
  accentForBlock,
  buildPaletteGroups,
  iconForBlock,
  summaryForBlock
} from '../src/blockVisuals';
import { listBlockSpecs } from '../src/shared/commandBuilders';

describe('accentForBlock', () => {
  it('source-codes by provider, then category', () => {
    expect(accentForBlock('reddit', 'Sources')).toBe('reddit');
    expect(accentForBlock('twitter', 'Enrichment')).toBe('x');
    expect(accentForBlock('local', 'Transform')).toBe('transform');
    expect(accentForBlock('local', 'Output')).toBe('output');
    expect(accentForBlock('local', 'Utility')).toBe('utility');
  });
});

describe('iconForBlock', () => {
  it('returns a known icon for every catalog block', () => {
    for (const spec of listBlockSpecs()) {
      expect(typeof iconForBlock(spec.type)).toBe('string');
    }
  });
});

describe('summaryForBlock', () => {
  it('surfaces the headline setting as the accent value', () => {
    const summary = summaryForBlock('reddit.searchPosts', { query: 'cli', subreddit: 'aww', limit: 10 });
    const headline = summary.find((item) => item.accent);
    expect(headline?.value).toBe('cli');
  });

  it('falls back to a placeholder for blanks', () => {
    const summary = summaryForBlock('twitter.userTweets', {});
    expect(summary[0].value).toBe('—');
  });
});

describe('buildPaletteGroups', () => {
  it('groups the real catalog into ordered source-coded sections', () => {
    const groups = buildPaletteGroups(listBlockSpecs());
    const accents = groups.map((group) => group.accent);
    expect(accents).toContain('reddit');
    expect(accents).toContain('x');
    expect(accents).toContain('output');
    // Reddit group includes both Sources and Enrichment reddit blocks.
    const reddit = groups.find((group) => group.accent === 'reddit');
    expect(reddit?.specs.every((spec) => spec.provider === 'reddit')).toBe(true);
    // No empty groups.
    expect(groups.every((group) => group.specs.length > 0)).toBe(true);
  });
});
