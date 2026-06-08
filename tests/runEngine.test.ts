import { describe, expect, it } from 'vitest';
import { runFlow } from '../server/runEngine';
import { MAX_FANOUT_CALLS } from '../src/shared/runLimits';
import type { FlowDefinition } from '../server/types';

describe('run engine', () => {
  it('executes a valid source-transform-output flow with a fake executor', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          data: [
            {
              id: 'abc',
              title: 'CLI automation',
              selftext: 'local export',
              created_utc: 1716500000,
              score: 8
            }
          ]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(result.steps.map((step) => step.status)).toEqual(['success', 'success', 'success']);
    expect(result.outputFiles[0].path).toBe('outputs/reddit-20260601-100000.json');
  });

  it('surfaces the CLI envelope error message when a step fails with ok:false on stdout', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          ok: false,
          schema_version: '1',
          error: { code: 'forbidden', message: 'Search failed: Access forbidden: Resource' }
        }),
        stderr: '',
        exitCode: 1
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    const searchStep = result.steps.find((step) => step.blockId === 'search');
    expect(searchStep?.status).toBe('failed');
    expect(searchStep?.error).toBe('Search failed: Access forbidden: Resource (forbidden)');
  });

  it('treats ok:false as a failure even when the CLI exits 0', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({ ok: false, error: { message: 'rate limited' } }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'search')?.error).toBe('rate limited');
  });

  it('writes a self-contained HTML report artifact and threads the flow name into it', async () => {
    const written: Array<{ path: string; contents: string }> = [];
    const flow: FlowDefinition = {
      id: 'flow-html',
      name: 'Weekly Digest',
      failFast: false,
      nodes: [
        {
          id: 'search',
          type: 'reddit.searchPosts',
          settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
        },
        { id: 'report', type: 'output.exportHtml', settings: { path: 'outputs/report.html' } }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'report', sourcePortId: 'items', targetPortId: 'items' }]
    };

    const result = await runFlow({
      flow,
      executor: async () => ({
        stdout: JSON.stringify({ data: [{ id: 'abc', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => {
        written.push({ path: filePath, contents });
        return { path: filePath, bytes: contents.length };
      },
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    const htmlFiles = result.outputFiles.filter((file) => file.path.endsWith('.html'));
    expect(htmlFiles).toHaveLength(1);
    expect(htmlFiles[0].path).toBe('outputs/report-20260601-100000.html');
    const report = written.find((file) => file.path.endsWith('.html'));
    expect(report?.contents.toLowerCase()).toContain('<!doctype html>');
    expect(report?.contents).toContain('Weekly Digest');
    expect(report?.contents).toContain('CLI automation');
  });

  it('continues unrelated branches after a source failure and skips dependents', async () => {
    const flow: FlowDefinition = {
      id: 'two-branch',
      name: 'Two Branch',
      failFast: false,
      nodes: [
        ...starterFlow().nodes,
        {
          id: 'twitter-search',
          type: 'twitter.searchTweets',
          settings: { query: 'cli', tab: 'latest', maxCount: 5 }
        },
        { id: 'csv', type: 'output.exportCsv', settings: { path: 'outputs/tweets.csv' } }
      ],
      edges: [
        ...starterFlow().edges,
        {
          id: 'e-twitter',
          source: 'twitter-search',
          target: 'csv',
          sourcePortId: 'items',
          targetPortId: 'items'
        }
      ]
    };

    const result = await runFlow({
      flow,
      executor: async (command) => {
        if (command.provider === 'reddit') {
          return { stdout: '', stderr: 'not found', exitCode: 1 };
        }
        return {
          stdout: JSON.stringify({ data: [{ id: 'tw1', text: 'healthy branch', created_at: '2026-01-01T00:00:00Z' }] }),
          stderr: '',
          exitCode: 0
        };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'filter')?.status).toBe('skipped');
    expect(result.steps.find((step) => step.blockId === 'csv')?.status).toBe('success');
  });

  it('skips a deep downstream chain after a failed source without stack overflow', async () => {
    const transformNodes = Array.from({ length: 6000 }, (_unused, index) => ({
      id: `filter-${index}`,
      type: 'transform.filterText',
      settings: {}
    }));
    const nodes = [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      ...transformNodes
    ];
    const edges = transformNodes.map((node, index) => ({
      id: `e-${index}`,
      source: index === 0 ? 'search' : `filter-${index - 1}`,
      target: node.id,
      sourcePortId: 'items',
      targetPortId: 'items'
    }));

    const result = await runFlow({
      flow: { id: 'deep', name: 'Deep', failFast: false, nodes, edges },
      executor: async () => ({ stdout: '', stderr: 'failed', exitCode: 1 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.at(-1)?.status).toBe('skipped');
  });

  it('carries a projected sample of produced items on the run', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          data: [{ id: 'abc', title: 'CLI automation', selftext: 'x', created_utc: 1716500000, score: 8, author: 'alice' }]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sample).toBeDefined();
    expect(result.sample).toHaveLength(1);
    expect(result.sample?.[0]).toMatchObject({ platform: 'reddit', id: 'abc', title: 'CLI automation', score: 8 });
  });

  it('caps the run sample at 50 rows', async () => {
    const data = Array.from({ length: 60 }, (_unused, index) => ({
      id: `r${index}`,
      title: `automation ${index}`,
      created_utc: 1716500000,
      score: index
    }));
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({ stdout: JSON.stringify({ data }), stderr: '', exitCode: 0 }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sample).toHaveLength(50);
  });

  it('uses upstream tweet ids when a wired Tweet Detail block has a blank id field', async () => {
    const commands: string[][] = [];
    const flow: FlowDefinition = {
      id: 'tweet-detail-flow',
      name: 'Tweet Detail Flow',
      failFast: false,
      nodes: [
        {
          id: 'search',
          type: 'twitter.searchTweets',
          settings: { query: 'bedroom', tab: 'top', maxCount: 10, fullText: true }
        },
        {
          id: 'detail',
          type: 'twitter.tweetDetail',
          settings: { tweetIdOrUrl: '', fullText: true }
        }
      ],
      edges: [{ id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
    };

    const result = await runFlow({
      flow,
      executor: async (command) => {
        commands.push(command.argv);
        if (command.argv[0] === 'search') {
          return {
            stdout: JSON.stringify({
              data: [
                {
                  id: '2063363922716188763',
                  text: 'A search result',
                  author: { screenName: 'public_cli' },
                  createdAtISO: '2026-06-06T20:54:29+00:00'
                }
              ]
            }),
            stderr: '',
            exitCode: 0
          };
        }
        return {
          stdout: JSON.stringify({
            data: {
              id: '2063363922716188763',
              text: 'The detailed tweet',
              author: { screenName: 'public_cli' },
              createdAtISO: '2026-06-06T20:54:29+00:00'
            }
          }),
          stderr: '',
          exitCode: 0
        };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(commands).toEqual([
      ['search', 'bedroom', '--type', 'top', '--max', '10', '--full-text', '--json'],
      ['tweet', '2063363922716188763', '--full-text', '--json']
    ]);
  });

  it('fans a wired Tweet Detail out over every upstream tweet id', async () => {
    const detailIds: string[] = [];
    const result = await runFlow({
      flow: tweetDetailFanOutFlow(['111', '222', '333']),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['111', '222', '333']), stderr: '', exitCode: 0 };
        }
        detailIds.push(command.argv[1]);
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(detailIds).toEqual(['111', '222', '333']);
    expect(result.sample?.map((row) => row.id)).toEqual(['111', '222', '333']);
  });

  it('dedups repeated upstream ids so each tweet is fetched once', async () => {
    const detailIds: string[] = [];
    await runFlow({
      flow: tweetDetailFanOutFlow(['dup']),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['dup', 'dup', 'dup']), stderr: '', exitCode: 0 };
        }
        detailIds.push(command.argv[1]);
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(detailIds).toEqual(['dup']);
  });

  it('fans out using a user binding that overrides the default source field', async () => {
    const flow = tweetDetailFanOutFlow(['111', '222', '333']);
    // Override the default tweetIdOrUrl←id binding with a user binding to author.
    flow.nodes = flow.nodes.map((node) =>
      node.id === 'detail'
        ? { ...node, settings: { ...node.settings, __bindings: { tweetIdOrUrl: 'author' } } }
        : node
    );

    const detailArgs: string[] = [];
    const result = await runFlow({
      flow,
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          // All three results share author 'public_cli' (see searchStdout).
          return { stdout: searchStdout(['111', '222', '333']), stderr: '', exitCode: 0 };
        }
        detailArgs.push(command.argv[1]);
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    // The user binding resolved every item to the same author, so dedup collapses
    // three upstream items into a single fan-out call.
    expect(detailArgs).toEqual(['public_cli']);
  });

  it('continues the fan-out when one item fails and keeps the rest', async () => {
    const result = await runFlow({
      flow: tweetDetailFanOutFlow(['ok1', 'bad', 'ok2']),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['ok1', 'bad', 'ok2']), stderr: '', exitCode: 0 };
        }
        if (command.argv[1] === 'bad') {
          return { stdout: JSON.stringify({ ok: false, error: 'not found' }), stderr: '', exitCode: 1 };
        }
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    const detailStep = result.steps.find((step) => step.blockId === 'detail');
    expect(detailStep?.status).toBe('success');
    expect(result.sample?.map((row) => row.id)).toEqual(['ok1', 'ok2']);
  });

  it('fails the fan-out node and blocks downstream when every call fails', async () => {
    const result = await runFlow({
      flow: tweetDetailFanOutFlow(['a', 'b']),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['a', 'b']), stderr: '', exitCode: 0 };
        }
        return { stdout: JSON.stringify({ ok: false, error: 'denied' }), stderr: '', exitCode: 1 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'detail')?.status).toBe('failed');
    expect(result.steps.find((step) => step.blockId === 'export')?.status).toBe('skipped');
  });

  it('caps the fan-out at MAX_FANOUT_CALLS distinct items', async () => {
    const ids = Array.from({ length: MAX_FANOUT_CALLS + 12 }, (_unused, index) => `id-${index}`);
    let detailCalls = 0;
    const result = await runFlow({
      flow: tweetDetailFanOutFlow(ids),
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(ids), stderr: '', exitCode: 0 };
        }
        detailCalls += 1;
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(detailCalls).toBe(MAX_FANOUT_CALLS);
  });

  it('labels the sample as saved with a true item count when an Export block ran', async () => {
    const result = await runFlow({
      flow: {
        id: 'saved-meta',
        name: 'Saved',
        failFast: false,
        nodes: [
          {
            id: 'search',
            type: 'reddit.searchPosts',
            settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
          },
          { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/x.json', pretty: true } }
        ],
        edges: [{ id: 'e1', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' }]
      },
      executor: async () => ({
        stdout: JSON.stringify({
          data: [
            { id: 'a', title: 'one', created_utc: 1716500000, score: 1 },
            { id: 'b', title: 'two', created_utc: 1716500000, score: 2 }
          ]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sampleMeta).toEqual({ sourceLabel: 'Export JSON', saved: true, totalItems: 2 });
  });

  it('labels the sample with the producing node and marks it unsaved when no Export block exists', async () => {
    const result = await runFlow({
      flow: {
        id: 'unsaved-meta',
        name: 'Unsaved',
        failFast: false,
        nodes: [
          {
            id: 'search',
            type: 'twitter.searchTweets',
            settings: { query: 'x', tab: 'latest', maxCount: 5, fullText: true }
          },
          { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '', fullText: true } }
        ],
        edges: [{ id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' }]
      },
      executor: async (command) => {
        if (command.argv[0] === 'search') {
          return { stdout: searchStdout(['1', '2', '3']), stderr: '', exitCode: 0 };
        }
        return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
      },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.sampleMeta).toEqual({ sourceLabel: 'Tweet Detail', saved: false, totalItems: 3 });
  });

  it('records per-node input/output/skipped counts and normalized fields in step.io', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      executor: async () => ({
        stdout: JSON.stringify({
          data: [
            { id: 'a', title: 'CLI automation', created_utc: 1716500000, score: 8, author: 'alice' },
            { id: 'b', title: 'unrelated note', created_utc: 1716500000, score: 2, author: 'bob' }
          ]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    const search = result.steps.find((step) => step.blockId === 'search');
    expect(search?.io).toMatchObject({ inputCount: 0, outputCount: 2, skippedCount: 0 });
    expect(search?.io?.normalizedFields).toEqual(expect.arrayContaining(['id', 'title', 'author']));

    // filterText include:'automation' keeps 1 of 2 → the dropped item is skipped.
    const filter = result.steps.find((step) => step.blockId === 'filter');
    expect(filter?.io).toMatchObject({ inputCount: 2, outputCount: 1, skippedCount: 1 });
  });

  it('redacts secret values inside the per-node io sample', async () => {
    const result = await runFlow({
      flow: starterFlow(),
      secrets: { TWITTER_AUTH_TOKEN: 'SUPERSECRET' },
      executor: async () => ({
        stdout: JSON.stringify({
          data: [{ id: 'a', title: 'CLI automation SUPERSECRET', created_utc: 1716500000, score: 1, author: 'SUPERSECRET' }]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    const search = result.steps.find((step) => step.blockId === 'search');
    expect(JSON.stringify(search?.io?.sampleItems)).not.toContain('SUPERSECRET');
    expect(search?.io?.sampleItems?.[0]?.author).toBe('[REDACTED]');
  });

  it('counts incompatible upstream items as skipped under the default skip policy', async () => {
    const result = await runFlow({
      flow: mixedDetailFlow('skip'),
      executor: mixedDetailExecutor,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    const detail = result.steps.find((step) => step.blockId === 'detail');
    expect(detail?.status).toBe('success');
    // The single reddit item cannot drive a Twitter block → skipped, not failed.
    expect(detail?.io?.skippedCount).toBeGreaterThanOrEqual(1);
    expect(detail?.io?.outputCount).toBe(2);
  });

  it('fails the node and blocks downstream when bind policy is fail and an item is incompatible', async () => {
    const result = await runFlow({
      flow: mixedDetailFlow('fail'),
      executor: mixedDetailExecutor,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    const detail = result.steps.find((step) => step.blockId === 'detail');
    expect(detail?.status).toBe('failed');
    expect(detail?.error).toContain('incompatible');
    expect(result.steps.find((step) => step.blockId === 'export')?.status).toBe('skipped');
  });

  it('keeps a source available for ALL consumers under output eviction', async () => {
    const result = await runFlow({
      flow: {
        id: 'diamond',
        name: 'Diamond',
        failFast: false,
        nodes: [
          {
            id: 'search',
            type: 'reddit.searchPosts',
            settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
          },
          { id: 'exportA', type: 'output.exportJson', settings: { path: 'outputs/a.json', pretty: true } },
          { id: 'exportB', type: 'output.exportJson', settings: { path: 'outputs/b.json', pretty: true } }
        ],
        edges: [
          { id: 'e1', source: 'search', target: 'exportA', sourcePortId: 'items', targetPortId: 'items' },
          { id: 'e2', source: 'search', target: 'exportB', sourcePortId: 'items', targetPortId: 'items' }
        ]
      },
      executor: async () => ({
        stdout: JSON.stringify({
          data: [
            { id: 'a', title: 'one', created_utc: 1716500000, score: 1 },
            { id: 'b', title: 'two', created_utc: 1716500000, score: 2 }
          ]
        }),
        stderr: '',
        exitCode: 0
      }),
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    // Both consumers received the source's two items: eviction must not free
    // `search`'s output after the FIRST consumer ran (ref-counted by consumer).
    expect(result.steps.find((step) => step.blockId === 'exportA')?.io?.inputCount).toBe(2);
    expect(result.steps.find((step) => step.blockId === 'exportB')?.io?.inputCount).toBe(2);
  });
});

/** Wire a reddit source AND a twitter source into one Tweet Detail block, so the
 *  detail block sees one incompatible (reddit) item and two compatible (twitter)
 *  ones — exercising the skip-vs-fail policy. */
function mixedDetailFlow(policy: 'skip' | 'fail'): FlowDefinition {
  return {
    id: 'mixed-detail',
    name: 'Mixed Detail',
    failFast: false,
    nodes: [
      {
        id: 'reddit-search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      {
        id: 'twitter-search',
        type: 'twitter.searchTweets',
        settings: { query: 'cli', tab: 'top', maxCount: 10, fullText: true }
      },
      { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '', fullText: true, __bindPolicy: policy } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/details.json', pretty: true } }
    ],
    edges: [
      { id: 'e1', source: 'reddit-search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' },
      { id: 'e2', source: 'twitter-search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' },
      { id: 'e3', source: 'detail', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
    ]
  };
}

async function mixedDetailExecutor(command: { provider: string; argv: string[] }) {
  if (command.argv[0] === 'search' && command.provider === 'reddit') {
    return {
      stdout: JSON.stringify({ data: [{ id: 'r1', title: 'reddit post', created_utc: 1716500000, score: 1 }] }),
      stderr: '',
      exitCode: 0
    };
  }
  if (command.argv[0] === 'search') {
    return { stdout: searchStdout(['t1', 't2']), stderr: '', exitCode: 0 };
  }
  return { stdout: detailStdout(command.argv[1]), stderr: '', exitCode: 0 };
}

function tweetDetailFanOutFlow(_ids: string[]): FlowDefinition {
  return {
    id: 'tweet-detail-fanout',
    name: 'Tweet Detail Fan-out',
    failFast: false,
    nodes: [
      {
        id: 'search',
        type: 'twitter.searchTweets',
        settings: { query: 'bedroom', tab: 'top', maxCount: 10, fullText: true }
      },
      { id: 'detail', type: 'twitter.tweetDetail', settings: { tweetIdOrUrl: '', fullText: true } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/details.json', pretty: true } }
    ],
    edges: [
      { id: 'e1', source: 'search', target: 'detail', sourcePortId: 'items', targetPortId: 'items' },
      { id: 'e2', source: 'detail', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
    ]
  };
}

function searchStdout(ids: string[]): string {
  return JSON.stringify({
    data: ids.map((id) => ({
      id,
      text: `result ${id}`,
      author: { screenName: 'public_cli' },
      createdAtISO: '2026-06-06T20:54:29+00:00'
    }))
  });
}

function detailStdout(id: string): string {
  return JSON.stringify({
    data: {
      id,
      text: `detail ${id}`,
      author: { screenName: 'public_cli' },
      createdAtISO: '2026-06-06T20:54:29+00:00'
    }
  });
}

function starterFlow(): FlowDefinition {
  return {
    id: 'flow-1',
    name: 'Starter',
    failFast: false,
    nodes: [
      {
        id: 'search',
        type: 'reddit.searchPosts',
        settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
      },
      { id: 'filter', type: 'transform.filterText', settings: { include: 'automation' } },
      { id: 'export', type: 'output.exportJson', settings: { path: 'outputs/reddit.json', pretty: true } }
    ],
    edges: [
      { id: 'e1', source: 'search', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
      { id: 'e2', source: 'filter', target: 'export', sourcePortId: 'items', targetPortId: 'items' }
    ]
  };
}
