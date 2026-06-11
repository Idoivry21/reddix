import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../src/hooks/useTheme';

const STORAGE_KEY = 'reddix-theme';

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  });
  return store;
}

function stubMatchMediaDark(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme', () => {
  it('defaults to light when nothing is stored and no OS preference is available', () => {
    stubLocalStorage();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('reads a stored theme from localStorage', () => {
    stubLocalStorage({ [STORAGE_KEY]: 'dark' });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('falls back to the OS dark preference when no theme is stored', () => {
    stubLocalStorage();
    stubMatchMediaDark(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('ignores an invalid stored value and falls back', () => {
    stubLocalStorage({ [STORAGE_KEY]: 'neon' });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('toggles the theme, syncs <html data-theme>, and persists the choice', () => {
    const store = stubLocalStorage();
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(store.get(STORAGE_KEY)).toBe('dark');
  });
});
