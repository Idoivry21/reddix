import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from '../src/hooks/useIsMobile';

/** Controllable matchMedia: returns the same media object on every call so the
 *  hook's initial read and effect read agree, and exposes a setter to fire 'change'. */
function installMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    media: '',
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useIsMobile', () => {
  it('returns false when matchMedia is unavailable (e.g. SSR / jsdom default)', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true when the viewport matches the mobile breakpoint', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when the media query match state changes', () => {
    const controller = installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => controller.set(true));
    expect(result.current).toBe(true);

    act(() => controller.set(false));
    expect(result.current).toBe(false);
  });
});
