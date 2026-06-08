import { afterEach, describe, expect, it, vi } from 'vitest';
import { postRunNode } from '../src/api';
import type { RunRecord } from '../src/shared/types';

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function nonJsonResponse(ok = false, status = 500): Response {
  return {
    ok,
    status,
    json: async () => {
      throw new Error('not json');
    }
  } as unknown as Response;
}

describe('postRunNode', () => {
  it('POSTs flowId + nodeId + mode and returns the run record', async () => {
    const run = { id: 'node-run-1', status: 'success' } as RunRecord;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postRunNode('primary', 'search', 'static');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({ method: 'POST' })
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody).toEqual({ flowId: 'primary', nodeId: 'search', mode: 'static' });
    expect(result).toEqual(run);
  });

  it('returns the failed run body on a 422 response (carries a run)', async () => {
    const run = { id: 'node-run-2', status: 'failed' } as RunRecord;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ run }, false, 422)));

    const result = await postRunNode('primary', 'search', 'cached-upstream');
    expect(result.status).toBe('failed');
  });

  it('throws the server error message when a 4xx body has no run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Too many runs for this flow' }, false, 429))
    );

    await expect(postRunNode('primary', 'search', 'static')).rejects.toThrow('Too many runs for this flow');
  });

  it('throws a status error when the response body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nonJsonResponse(false, 503)));

    await expect(postRunNode('primary', 'search', 'static')).rejects.toThrow('status 503');
  });

  it('throws a generic node-failed message when a run is absent and no error is provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 422)));

    await expect(postRunNode('primary', 'search', 'static')).rejects.toThrow('Run node failed (status 422)');
  });
});
