import { describe, expect, it, vi } from 'vitest';
import { runFlow, runSingleNode } from '../server/runEngine';
import type { BuiltCommand } from '../src/shared/types';

const baseOptions = (nodes: any[], edges: any[], executor: any) => ({
  flow: { id: 'f1', name: 'F', nodes, edges },
  executor,
  secrets: {},
  writeArtifact: vi.fn(async () => ({ path: '', bytes: 0 })),
  now: () => new Date('2026-06-10T00:00:00Z')
});

describe('runWriteNode', () => {
  it('executes a literal write and records a success step', async () => {
    const executor = vi.fn(async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: '' }));
    const run = await runFlow(
      baseOptions([{ id: 'p', type: 'twitter.post', position: { x: 0, y: 0 }, settings: { text: 'gm' } }], [], executor) as any
    );
    expect(executor).toHaveBeenCalledTimes(1);
    expect((executor.mock.calls[0][0] as BuiltCommand).argv).toEqual(['post', 'gm', '--json']);
    expect(run.steps[0].status).toBe('success');
  });

  it('fans out one call per upstream item and passes input through', async () => {
    const search = { id: 's', type: 'twitter.searchTweets', position: { x: 0, y: 0 }, settings: { query: 'x', tab: 'latest', maxCount: 10 } };
    const like = { id: 'l', type: 'twitter.like', position: { x: 0, y: 0 }, settings: { tweetId: '', undo: false } };
    const edges = [{ id: 'e', source: 's', target: 'l', sourcePortId: 'items', targetPortId: 'items' }];
    // normalizeTwitterPayload unwraps data.tweets via extractArray -> data -> data.tweets
    const sourcePayload = JSON.stringify({ data: { tweets: [{ id: '111', text: 'a' }, { id: '222', text: 'b' }] } });
    const multi = vi.fn(async (command: BuiltCommand) =>
      command.argv[0] === 'search'
        ? { exitCode: 0, stdout: sourcePayload, stderr: '' }
        : { exitCode: 0, stdout: '{"ok":true}', stderr: '' }
    );
    const run = await runFlow(baseOptions([search, like], edges, multi) as any);
    const likeCalls = multi.mock.calls.filter((c) => (c[0] as BuiltCommand).argv[0] === 'like');
    expect(likeCalls.map((c) => (c[0] as BuiltCommand).argv[1]).sort()).toEqual(['111', '222']);
    const likeStep = run.steps.find((s) => s.blockId === 'l');
    expect(likeStep?.status).toBe('success');
    expect(likeStep?.io?.outputCount).toBe(2);
  });

  it('fails the step when the CLI returns a non-zero exit', async () => {
    const executor = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'not authenticated' }));
    const run = await runFlow(
      baseOptions([{ id: 'p', type: 'twitter.post', position: { x: 0, y: 0 }, settings: { text: 'gm' } }], [], executor) as any
    );
    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].error).toContain('not authenticated');
  });

  it('never fires a real write from a single-node debug preview', async () => {
    const executor = vi.fn(async () => ({ exitCode: 0, stdout: '{"ok":true}', stderr: '' }));
    const run = await runSingleNode({
      flow: { id: 'f1', name: 'F', nodes: [{ id: 'p', type: 'twitter.post', position: { x: 0, y: 0 }, settings: { text: 'gm' } }], edges: [] },
      nodeId: 'p',
      mode: 'static',
      executor,
      now: () => new Date('2026-06-10T00:00:00Z')
    } as any);
    expect(executor).not.toHaveBeenCalled();
    expect(run.steps[0].status).toBe('success');
    expect(run.steps[0].stdoutSummary).toContain('preview');
  });
});
