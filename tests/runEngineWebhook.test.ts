import { describe, expect, it, vi } from 'vitest';
import { runFlow, runSingleNode } from '../server/runEngine';
import type { WebhookResult } from '../server/webhook';
import type { FlowDefinition } from '../server/types';

const HTTPS_URL = 'https://hooks.example.com/services/abc';

/** reddit source → webhook sink. `webhookSettings` lets a test set the url /
 *  auth env var; a second export branch off the same source is optional. */
function webhookFlow(
  webhookSettings: Record<string, unknown> = { url: HTTPS_URL, authTokenEnvVar: '' },
  options: { failFast?: boolean; withExportBranch?: boolean } = {}
): FlowDefinition {
  const nodes = [
    {
      id: 'search',
      type: 'reddit.searchPosts',
      settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 }
    },
    { id: 'hook', type: 'output.webhook', settings: webhookSettings }
  ];
  const edges = [{ id: 'e1', source: 'search', target: 'hook', sourcePortId: 'items', targetPortId: 'items' }];
  if (options.withExportBranch) {
    nodes.push({ id: 'export', type: 'output.exportJson', settings: { path: 'outputs/x.json', pretty: true } });
    edges.push({ id: 'e2', source: 'search', target: 'export', sourcePortId: 'items', targetPortId: 'items' });
  }
  return { id: 'wh-flow', name: 'Webhook Flow', failFast: options.failFast ?? false, nodes, edges };
}

function redditExecutor() {
  return async () => ({
    stdout: JSON.stringify({ data: [{ id: 'abc', title: 'CLI automation', created_utc: 1716500000, score: 8 }] }),
    stderr: '',
    exitCode: 0
  });
}

const okResult: WebhookResult = { ok: true, statusCode: 200, error: null, summary: 'POST https://hooks.example.com → 200' };

describe('run engine — webhook node', () => {
  it('POSTs the { flowName, runId, count, items } envelope to the sink', async () => {
    const sendWebhook = vi.fn(async () => okResult);
    const result = await runFlow({
      flow: webhookFlow(),
      executor: redditExecutor(),
      sendWebhook,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    const input = sendWebhook.mock.calls[0][0];
    expect(input.url).toBe(HTTPS_URL);
    expect(input.body).toEqual({
      flowName: 'Webhook Flow',
      runId: result.id,
      count: 1,
      items: [expect.objectContaining({ id: 'abc', platform: 'reddit' })]
    });
    const step = result.steps.find((s) => s.blockId === 'hook');
    expect(step?.status).toBe('success');
    expect(step?.argv).toEqual(['POST', 'https://hooks.example.com']);
    expect(step?.stdoutSummary).toContain('POST');
  });

  it('fires the webhook even when the upstream produced zero items', async () => {
    const sendWebhook = vi.fn(async () => okResult);
    await runFlow({
      flow: webhookFlow(),
      executor: async () => ({ stdout: JSON.stringify({ data: [] }), stderr: '', exitCode: 0 }),
      sendWebhook,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect((sendWebhook.mock.calls[0][0].body as { count: number }).count).toBe(0);
  });

  it('resolves the bearer token from the run secret map by the node env var name', async () => {
    const sendWebhook = vi.fn(async () => okResult);
    await runFlow({
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: 'WEBHOOK_TOKEN' }),
      executor: redditExecutor(),
      sendWebhook,
      secrets: { WEBHOOK_TOKEN: 'resolved-secret' },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(sendWebhook.mock.calls[0][0].token).toBe('resolved-secret');
  });

  it('sends a null token when no auth env var is configured', async () => {
    const sendWebhook = vi.fn(async () => okResult);
    await runFlow({
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: '' }),
      executor: redditExecutor(),
      sendWebhook,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(sendWebhook.mock.calls[0][0].token).toBeNull();
  });

  it('marks the step failed on a non-2xx / network failure (continue-on-error)', async () => {
    const sendWebhook = vi.fn(
      async (): Promise<WebhookResult> => ({
        ok: false,
        statusCode: 500,
        error: 'POST https://hooks.example.com responded 500',
        summary: 'POST https://hooks.example.com → 500'
      })
    );
    const result = await runFlow({
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: '' }, { withExportBranch: true }),
      executor: redditExecutor(),
      sendWebhook,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((s) => s.blockId === 'hook')?.status).toBe('failed');
    // Terminal node: an unrelated export branch off the same source still runs.
    expect(result.steps.find((s) => s.blockId === 'export')?.status).toBe('success');
  });

  it('stops the flow on a failed webhook when failFast is set', async () => {
    const sendWebhook = vi.fn(
      async (): Promise<WebhookResult> => ({
        ok: false,
        statusCode: 500,
        error: 'boom',
        summary: 'POST https://hooks.example.com → 500'
      })
    );
    const result = await runFlow({
      // The webhook is ordered before the export (both depend on the source), so
      // failFast breaks the loop before the export node is reached.
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: '' }, { failFast: true, withExportBranch: true }),
      executor: redditExecutor(),
      sendWebhook,
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('failed');
    expect(result.steps.find((s) => s.blockId === 'hook')?.status).toBe('failed');
    expect(result.steps.find((s) => s.blockId === 'export')).toBeUndefined();
  });

  it('redacts a resolved token echoed back in a webhook error', async () => {
    const sendWebhook = vi.fn(
      async (): Promise<WebhookResult> => ({
        ok: false,
        statusCode: 401,
        error: 'auth rejected token SUPERSECRETTOKEN',
        summary: 'POST https://hooks.example.com → 401'
      })
    );
    const result = await runFlow({
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: 'WEBHOOK_TOKEN' }),
      executor: redditExecutor(),
      sendWebhook,
      secrets: { WEBHOOK_TOKEN: 'SUPERSECRETTOKEN' },
      writeArtifact: async (filePath, contents) => ({ path: filePath, bytes: contents.length }),
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    const step = result.steps.find((s) => s.blockId === 'hook');
    expect(step?.error).not.toContain('SUPERSECRETTOKEN');
    expect(step?.error).toContain('[REDACTED]');
  });

  it('previews a webhook node in single-node mode without firing a request', async () => {
    const executor = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const result = await runSingleNode({
      flow: webhookFlow({ url: HTTPS_URL, authTokenEnvVar: '' }),
      nodeId: 'hook',
      mode: 'static',
      executor,
      now: () => new Date('2026-06-01T10:00:00Z')
    });

    expect(result.status).toBe('success');
    const step = result.steps[0];
    expect(step.blockId).toBe('hook');
    expect(step.status).toBe('success');
    expect(step.stdoutSummary).toContain('preview');
    // No CLI was spawned and (by the no-op sender) no network request was made.
    expect(executor).not.toHaveBeenCalled();
  });
});
