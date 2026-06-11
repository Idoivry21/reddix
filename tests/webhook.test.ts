import { describe, expect, it } from 'vitest';
import { maskWebhookUrl, postWebhook } from '../server/webhook';

/** A minimal fetch stub that records the call and returns a chosen status. */
function fetchStub(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { status } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ENVELOPE = { flowName: 'Weekly', runId: 'run-1', count: 1, items: [{ id: 'a' }] };

describe('maskWebhookUrl', () => {
  it('reduces a URL to scheme + host, dropping path and query', () => {
    expect(maskWebhookUrl('https://hooks.example.com/services/SECRET?token=abc')).toBe('https://hooks.example.com');
  });

  it('returns a sentinel for an unparseable URL', () => {
    expect(maskWebhookUrl('not a url')).toBe('[invalid-url]');
  });
});

describe('postWebhook', () => {
  it('rejects a non-HTTPS URL without making a request', async () => {
    const { impl, calls } = fetchStub(200);
    const result = await postWebhook({ url: 'http://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain('non-HTTPS');
    expect(calls).toHaveLength(0);
  });

  it('rejects an unparseable URL', async () => {
    const { impl, calls } = fetchStub(200);
    const result = await postWebhook({ url: 'http://', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a 2xx response as ok with the status code', async () => {
    const { impl } = fetchStub(204);
    const result = await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(result.error).toBeNull();
    expect(result.summary).toBe('POST https://hooks.example.com → 204');
  });

  it('rejects loopback/private/link-local hosts without making a request (finding #2)', async () => {
    const blocked = [
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.0.5/x',
      'https://192.168.1.10/x',
      'https://172.16.4.4/x',
      'https://169.254.1.1/x',
      'https://[fe80::1]/x',
      'https://[fc00::1]/x',
      'https://localhost/x',
      'https://localhost./x',
      'https://api.local/x',
      'https://[::]/x',
      'https://0.0.0.0/x'
    ];
    for (const url of blocked) {
      const { impl, calls } = fetchStub(200);
      const result = await postWebhook({ url, body: ENVELOPE, fetchImpl: impl });
      expect(result.ok, url).toBe(false);
      expect(result.statusCode, url).toBeNull();
      expect(result.summary, url).toMatch(/→ blocked$/);
      // Core SSRF assertion: no socket was ever opened.
      expect(calls, url).toHaveLength(0);
    }
  });

  it('allows a public host through to fetch (finding #2 — no over-blocking)', async () => {
    const { impl, calls } = fetchStub(200);
    const result = await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('masks the origin and never leaks path/query when blocking a private host (finding #2)', async () => {
    const { impl } = fetchStub(200);
    const result = await postWebhook({ url: 'https://127.0.0.1/services/SECRET?t=SECRET', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('SECRET');
    expect(result.error).not.toContain('/services/');
  });

  it('reports a non-2xx response as a failure', async () => {
    const { impl } = fetchStub(500);
    const result = await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain('500');
  });

  it('reports a network error / timeout as a failure', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('POSTs the JSON envelope with a JSON Content-Type', async () => {
    const { impl, calls } = fetchStub(200);
    await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    const { init } = calls[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(ENVELOPE);
  });

  it('disables automatic redirect following', async () => {
    const { impl, calls } = fetchStub(302);
    await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect(calls[0].init.redirect).toBe('error');
  });

  it('sends Authorization: Bearer when a token is provided', async () => {
    const { impl, calls } = fetchStub(200);
    await postWebhook({ url: 'https://hooks.example.com/x', token: 'sekret', body: ENVELOPE, fetchImpl: impl });

    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sekret');
  });

  it('omits the Authorization header when the token is empty or undefined', async () => {
    const { impl, calls } = fetchStub(200);
    await postWebhook({ url: 'https://hooks.example.com/x', token: '', body: ENVELOPE, fetchImpl: impl });
    await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, fetchImpl: impl });

    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('never leaks the URL path or query in summary or error strings', async () => {
    const url = 'https://hooks.example.com/services/T000/B000/xyzSECRET?token=querySECRET';

    const failed = await postWebhook({ url, body: ENVELOPE, fetchImpl: fetchStub(500).impl });
    expect(failed.summary).toBe('POST https://hooks.example.com → 500');
    expect(`${failed.summary} ${failed.error}`).not.toContain('SECRET');
    expect(`${failed.summary} ${failed.error}`).not.toContain('/services/');

    const networkImpl = (async () => {
      // Simulate a fetch impl that echoes the full URL back in its error.
      throw new Error(`connect failed to ${url}`);
    }) as unknown as typeof fetch;
    const errored = await postWebhook({ url, body: ENVELOPE, fetchImpl: networkImpl });
    expect(errored.error).not.toContain('querySECRET');
    expect(errored.error).not.toContain('/services/');
    expect(errored.error).toContain('https://hooks.example.com');
  });

  it('passes the configured timeout into an abort signal without throwing', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined);
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;
    const result = await postWebhook({ url: 'https://hooks.example.com/x', body: ENVELOPE, timeoutMs: 500, fetchImpl: impl });

    expect(result.ok).toBe(true);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });
});
