import { describe, expect, it } from 'vitest';
import { buildBlockCommand } from '../src/shared/commandBuilders';

const build = (blockType: string, settings: Record<string, unknown>) =>
  buildBlockCommand({ blockId: 'n1', blockType, settings });

describe('reddit write command builders', () => {
  it('builds upvote with the post id as a single argv value', () => {
    expect(build('reddit.upvote', { postId: 't3_abc', down: false, undo: false })).toEqual({
      provider: 'reddit',
      executable: 'rdt',
      argv: ['upvote', 't3_abc'],
      displayArgv: ['upvote', 't3_abc']
    });
  });

  it('appends --down and --undo flags when set', () => {
    expect(build('reddit.upvote', { postId: 't3_abc', down: true, undo: true }).argv).toEqual([
      'upvote', 't3_abc', '--down', '--undo'
    ]);
  });

  it('builds save with --undo', () => {
    expect(build('reddit.save', { postId: 't3_abc', undo: true }).argv).toEqual(['save', 't3_abc', '--undo']);
  });

  it('builds subscribe', () => {
    expect(build('reddit.subscribe', { subreddit: 'python', undo: false }).argv).toEqual(['subscribe', 'python']);
  });

  it('builds comment with id and text as separate values', () => {
    expect(build('reddit.comment', { postId: 't3_abc', text: 'nice & true' }).argv).toEqual([
      'comment', 't3_abc', 'nice & true'
    ]);
  });
});

describe('twitter write command builders', () => {
  it('builds post with text then --json', () => {
    expect(build('twitter.post', { text: 'gm builders' }).argv).toEqual(['post', 'gm builders', '--json']);
  });

  it('builds reply with id, text, --json', () => {
    expect(build('twitter.reply', { tweetId: '123', text: 'nice' }).argv).toEqual(['reply', '123', 'nice', '--json']);
  });

  it('builds quote with id, commentary, --json', () => {
    expect(build('twitter.quote', { tweetId: '123', text: 'this' }).argv).toEqual(['quote', '123', 'this', '--json']);
  });

  it('swaps subcommand to unretweet/unlike/unbookmark when undo is set', () => {
    expect(build('twitter.retweet', { tweetId: '123', undo: true }).argv).toEqual(['unretweet', '123', '--json']);
    expect(build('twitter.like', { tweetId: '123', undo: false }).argv).toEqual(['like', '123', '--json']);
    expect(build('twitter.bookmark', { tweetId: '123', undo: true }).argv).toEqual(['unbookmark', '123', '--json']);
  });

  it('builds follow/unfollow from a handle', () => {
    expect(build('twitter.follow', { handle: 'jack', undo: false }).argv).toEqual(['follow', 'jack', '--json']);
    expect(build('twitter.follow', { handle: 'jack', undo: true }).argv).toEqual(['unfollow', 'jack', '--json']);
  });

  it('builds delete with --yes so the CLI never blocks on a prompt', () => {
    expect(build('twitter.delete', { tweetId: '123' }).argv).toEqual(['delete', '123', '--yes', '--json']);
  });
});
