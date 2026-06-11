import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboarding } from '../src/hooks/useOnboarding';

// jsdom in this project ships without localStorage (hooks guard with `?.`), so
// install a minimal Map-backed stub for these persistence tests.
describe('useOnboarding', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear()
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the welcome overlay on first run', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.showWelcome).toBe(true);
  });

  it('persists dismissal to localStorage', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.dismissOnboarding());
    expect(result.current.showWelcome).toBe(false);
    expect(window.localStorage.getItem('reddix-onboarded')).toBe('1');
  });

  it('stays dismissed across remounts', () => {
    window.localStorage.setItem('reddix-onboarded', '1');
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.showWelcome).toBe(false);
  });
});
