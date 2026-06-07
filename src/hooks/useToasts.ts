import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastKind = 'error' | 'warning' | 'success' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** ms before auto-dismiss; null keeps it until dismissed. */
  duration: number | null;
}

export interface PushOptions {
  duration?: number | null;
}

const MAX_TOASTS = 4;
const DEFAULT_DURATION: Record<ToastKind, number> = {
  error: 7000,
  warning: 6000,
  success: 4500,
  info: 4500
};

export interface UseToasts {
  toasts: Toast[];
  pushToast: (message: string, kind?: ToastKind, options?: PushOptions) => void;
  dismissToast: (id: string) => void;
}

/**
 * Transient notification queue. De-dupes identical messages, auto-dismisses on a
 * per-kind timer, and caps the visible stack so a burst can't flood the screen.
 */
export function useToasts(): UseToasts {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string): void => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, kind: ToastKind = 'info', options: PushOptions = {}): void => {
      const duration = options.duration === undefined ? DEFAULT_DURATION[kind] : options.duration;
      setToasts((current) => {
        // De-dupe: identical message+kind already shown → don't stack a copy.
        if (current.some((toast) => toast.message === message && toast.kind === kind)) {
          return current;
        }
        const next = [...current, { id: makeId(), kind, message, duration }];
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
      });
    },
    []
  );

  // Schedule a dismissal timer for any toast that doesn't have one yet.
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.duration !== null && !timers.current.has(toast.id)) {
        const timer = window.setTimeout(() => dismissToast(toast.id), toast.duration);
        timers.current.set(toast.id, timer);
      }
    }
  }, [toasts, dismissToast]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) {
        window.clearTimeout(timer);
      }
      map.clear();
    };
  }, []);

  return { toasts, pushToast, dismissToast };
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
