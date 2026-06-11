import { describe, expect, it } from 'vitest';
import { isWriteBlockType, summarizeFlowWrites } from '../src/shared/writeActions';
import type { FlowDefinition } from '../src/shared/types';

describe('isWriteBlockType', () => {
  it('is true for write blocks and false for reads/unknown', () => {
    expect(isWriteBlockType('twitter.like')).toBe(true);
    expect(isWriteBlockType('reddit.comment')).toBe(true);
    expect(isWriteBlockType('reddit.searchPosts')).toBe(false);
    expect(isWriteBlockType('nope.nope')).toBe(false);
  });
});

describe('summarizeFlowWrites', () => {
  const flow = (nodes: FlowDefinition['nodes']): FlowDefinition => ({ id: 'f1', name: 'F', nodes, edges: [] });

  it('returns one summary per write node with literal target and destructive flag', () => {
    const out = summarizeFlowWrites(
      flow([
        { id: 'a', type: 'twitter.post', position: { x: 0, y: 0 }, settings: { text: 'gm' } },
        { id: 'b', type: 'twitter.delete', position: { x: 0, y: 0 }, settings: { tweetId: '123' } },
        { id: 'c', type: 'reddit.searchPosts', position: { x: 0, y: 0 }, settings: { query: 'x' } }
      ] as FlowDefinition['nodes'])
    );
    expect(out).toEqual([
      { blockId: 'a', blockType: 'twitter.post', label: 'Post Tweet', destructive: false, target: 'gm', fromUpstream: false },
      { blockId: 'b', blockType: 'twitter.delete', label: 'Delete Tweet', destructive: true, target: '123', fromUpstream: false }
    ]);
  });

  it('marks a blank bound target as fromUpstream', () => {
    const out = summarizeFlowWrites(
      flow([{ id: 'a', type: 'twitter.like', position: { x: 0, y: 0 }, settings: { tweetId: '' } }] as FlowDefinition['nodes'])
    );
    expect(out[0]).toMatchObject({ blockId: 'a', target: null, fromUpstream: true });
  });
});
