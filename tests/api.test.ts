import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFlow, postRun, saveFlow, subscribeRunEvents } from '../src/api';
import type { RunRecord } from '../src/shared/types';

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function nonJsonResponse(ok = false, status = 500): Response {
  return { ok, status, json: async () => { throw new Error('not json'); } } as unknown as Response;
}

describe('saveFlow', () => {
  it('PUTs the flow body and returns the saved flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flow: { id: 'primary' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await saveFlow('primary', { flow: { id: 'primary' } } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/flows/primary',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(result).toEqual({ id: 'primary' });
  });

  it('throws when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));

    await expect(saveFlow('primary', { flow: {} } as never)).rejects.toThrow();
  });

  it('surfaces the server error message instead of a bare status (finding 6)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Invalid flow graph: node3: missing required field' }, false, 400)
      )
    );

    await expect(saveFlow('primary', { flow: {} } as never)).rejects.toThrow(
      'Invalid flow graph: node3: missing required field'
    );
  });
});

describe('deleteFlow', () => {
  it('DELETEs the flow and resolves true on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, true, 204));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteFlow('primary')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/flows/primary', { method: 'DELETE' });
  });

  it('resolves false on 404 (already gone) without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Flow not found' }, false, 404)));

    await expect(deleteFlow('primary')).resolves.toBe(false);
  });

  it('throws the server error message on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid flow id' }, false, 400)));

    await expect(deleteFlow('..bad')).rejects.toThrow('Invalid flow id');
  });
});

describe('postRun', () => {
  it('POSTs the flow id and returns the run record', async () => {
    const run = { id: 'run-1', status: 'success' } as RunRecord;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ run }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postRun('primary');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual(run);
  });

  it('returns the failed run body on a 422 response', async () => {
    const run = { id: 'run-2', status: 'failed' } as RunRecord;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ run }, false, 422)));

    const result = await postRun('primary');

    expect(result.status).toBe('failed');
  });

  it('throws a status error when a non-JSON error response has no run body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nonJsonResponse(false, 503)));

    await expect(postRun('primary')).rejects.toThrow('status 503');
  });
});

describe('subscribeRunEvents', () => {
  it('wires handlers and returns an unsubscribe function', () => {
    const listeners: Record<string, (event: MessageEvent) => void> = {};
    const close = vi.fn();
    class FakeEventSource {
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        listeners[type] = handler;
      }
      close = close;
    }

    const onStep = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const unsubscribe = subscribeRunEvents(
      { onStep, onComplete, onError },
      (url) => new FakeEventSource() as unknown as EventSource
    );

    listeners['run-step']({ data: JSON.stringify({ type: 'step' }) } as MessageEvent);
    listeners['run-complete']({ data: JSON.stringify({ run: { id: 'r' } }) } as MessageEvent);

    expect(onStep).toHaveBeenCalledWith({ type: 'step' });
    expect(onComplete).toHaveBeenCalledWith({ run: { id: 'r' } });

    expect(() => listeners['run-step']({ data: '{' } as MessageEvent)).not.toThrow();
    expect(onError).toHaveBeenCalled();

    unsubscribe();
    expect(close).toHaveBeenCalled();
  });
});
