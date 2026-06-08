import { describe, expect, it } from 'vitest';
import {
  behaviorSummary,
  fanOutCapable,
  streamEffect,
  streamEffectLabel,
  type StreamEffect
} from '../src/shared/blockBehavior';
import { blockSpecs } from '../src/shared/blockSpecs';

describe('streamEffect', () => {
  it('classifies a source (no input, emits SocialItem[])', () => {
    expect(streamEffect('reddit.searchPosts')).toBe('source');
    expect(streamEffect('twitter.searchTweets')).toBe('source');
  });

  it('classifies a CLI enrichment (SocialItem[] in and out)', () => {
    expect(streamEffect('reddit.readPost')).toBe('enrich');
    expect(streamEffect('twitter.tweetDetail')).toBe('enrich');
    expect(streamEffect('twitter.article')).toBe('enrich');
  });

  it('classifies a local transform (SocialItem[] in and out, no CLI)', () => {
    expect(streamEffect('transform.limit')).toBe('transform');
    expect(streamEffect('transform.mergeStreams')).toBe('transform');
  });

  it('classifies an export by its FileArtifact output', () => {
    expect(streamEffect('output.exportJson')).toBe('export');
    expect(streamEffect('output.exportHtml')).toBe('export');
  });

  it('classifies a no-data block as annotation', () => {
    expect(streamEffect('utility.note')).toBe('annotation');
  });

  it('maps every registered block to exactly one effect without throwing', () => {
    const allowed: StreamEffect[] = ['source', 'enrich', 'transform', 'export', 'annotation'];
    for (const spec of blockSpecs) {
      expect(allowed).toContain(streamEffect(spec.type));
    }
  });
});

describe('streamEffectLabel', () => {
  it('returns an uppercase badge label', () => {
    expect(streamEffectLabel('enrich')).toBe('ENRICH');
    expect(streamEffectLabel('source')).toBe('SOURCE');
    expect(streamEffectLabel('annotation')).toBe('ANNOTATION');
  });
});

describe('fanOutCapable', () => {
  it('is true for default-binding CLI enrichment blocks (SocialItem[] input + executable + default binding)', () => {
    expect(fanOutCapable('reddit.readPost')).toBe(true);
    expect(fanOutCapable('twitter.tweetDetail')).toBe(true);
    expect(fanOutCapable('twitter.userProfile')).toBe(true);
  });

  it('is false for manual-map-only enrichment (no default binding → reads one by default)', () => {
    expect(fanOutCapable('twitter.article')).toBe(false);
  });

  it('is false for CLI sources (no input port to fan out over)', () => {
    expect(fanOutCapable('reddit.searchPosts')).toBe(false);
    expect(fanOutCapable('twitter.searchTweets')).toBe(false);
  });

  it('is false for local transforms, exports, and annotations', () => {
    expect(fanOutCapable('transform.limit')).toBe(false);
    expect(fanOutCapable('output.exportJson')).toBe(false);
    expect(fanOutCapable('utility.note')).toBe(false);
  });
});

describe('behaviorSummary', () => {
  it('summarizes an enrichment block with its authored note and port labels', () => {
    const summary = behaviorSummary('reddit.readPost');
    expect(summary.effect).toBe('enrich');
    expect(summary.label).toBe('ENRICH');
    expect(summary.inLabel).toBe('SocialItem[]');
    expect(summary.outLabel).toBe('SocialItem[]');
    expect(summary.fanOut).toBe(true);
    expect(summary.note).toMatch(/fans out/i);
    expect(summary.description).toBe('Read a Reddit post by stable ID.');
  });

  it('labels an export output as FileArtifact', () => {
    const summary = behaviorSummary('output.exportJson');
    expect(summary.effect).toBe('export');
    expect(summary.inLabel).toBe('SocialItem[]');
    expect(summary.outLabel).toBe('FileArtifact');
  });

  it('shows — for an annotation block with no data ports', () => {
    const summary = behaviorSummary('utility.note');
    expect(summary.effect).toBe('annotation');
    expect(summary.inLabel).toBe('—');
    expect(summary.outLabel).toBe('—');
    expect(summary.fanOut).toBe(false);
  });

  it('omits the note for a block that has none', () => {
    expect(behaviorSummary('reddit.browseSubreddit').note).toBeUndefined();
  });
});
