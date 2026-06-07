import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '../src/hooks/useToasts';

describe('useToasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pushes a toast and auto-dismisses after the per-kind duration', () => {
    const { result } = renderHook(() => useToasts());

    act(() => result.current.pushToast('hello', 'info'));
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({ message: 'hello', kind: 'info' });

    act(() => vi.advanceTimersByTime(4500));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('de-dupes an identical message + kind instead of stacking', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.pushToast('same', 'error');
      result.current.pushToast('same', 'error');
    });
    expect(result.current.toasts).toHaveLength(1);
  });

  it('caps the visible stack at 4, dropping the oldest', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      for (let i = 0; i < 7; i += 1) {
        result.current.pushToast(`m${i}`, 'info');
      }
    });
    expect(result.current.toasts).toHaveLength(4);
    expect(result.current.toasts[0].message).toBe('m3');
  });

  it('dismisses manually by id', () => {
    const { result } = renderHook(() => useToasts());

    act(() => result.current.pushToast('bye', 'warning'));
    const id = result.current.toasts[0].id;
    act(() => result.current.dismissToast(id));
    expect(result.current.toasts).toHaveLength(0);
  });

  it('keeps a sticky toast (duration null) past any timeout', () => {
    const { result } = renderHook(() => useToasts());

    act(() => result.current.pushToast('stay', 'info', { duration: null }));
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.toasts).toHaveLength(1);
  });
});
