import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProviderHealth } from '../src/hooks/useProviderHealth';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function healthResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const PROVIDERS = [
  { provider: 'reddit', executable: 'rdt', available: true },
  { provider: 'twitter', executable: 'twitter', available: false }
];

describe('useProviderHealth', () => {
  it('starts in a loading state', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() => useProviderHealth());
    expect(result.current).toEqual({ providers: [], isLoading: true, hasError: false });
  });

  it('resolves to the provider list on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(healthResponse({ ok: true, app: 'Reddix', providers: PROVIDERS }))
    );

    const { result } = renderHook(() => useProviderHealth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(false);
    expect(result.current.providers).toEqual(PROVIDERS);
  });

  it('resolves to an error state when the health request fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse({ error: 'down' }, false, 503)));

    const { result } = renderHook(() => useProviderHealth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(true);
    expect(result.current.providers).toEqual([]);
  });

  it('flags an error when fetch is unavailable in the environment', async () => {
    vi.stubGlobal('fetch', undefined);

    const { result } = renderHook(() => useProviderHealth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(true);
  });
});
