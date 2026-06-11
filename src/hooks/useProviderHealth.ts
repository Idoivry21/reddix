import { useEffect, useState } from 'react';
import { fetchHealth, type ProviderHealth } from '../api';

export interface ProviderHealthState {
  providers: ProviderHealth[];
  isLoading: boolean;
  hasError: boolean;
}

/**
 * How often to re-poll provider health while the app stays open. Kept above the
 * backend's 15s health cache TTL so a binary installed/removed mid-session is
 * picked up without hammering the probe.
 */
const PROVIDER_HEALTH_REFRESH_MS = 30_000;

/**
 * Fetches per-provider CLI health from /health on mount, then keeps it fresh by
 * re-polling on an interval and when the tab regains focus/visibility — a CLI can
 * be installed or fixed while the app stays open, so a once-per-mount read goes
 * stale. A missing or unhealthy binary is a core spec requirement to surface, so
 * failures resolve to an explicit error state rather than silently showing "Healthy".
 */
export function useProviderHealth(): ProviderHealthState {
  const [state, setState] = useState<ProviderHealthState>({
    providers: [],
    isLoading: true,
    hasError: false
  });

  useEffect(() => {
    if (typeof fetch === 'undefined') {
      setState({ providers: [], isLoading: false, hasError: true });
      return;
    }
    let cancelled = false;

    const load = (): void => {
      fetchHealth()
        .then((health) => {
          if (!cancelled) {
            setState({ providers: health.providers ?? [], isLoading: false, hasError: false });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            const reason = error instanceof Error ? error.message : 'Unknown error';
            // Diagnostic trail: distinguishes backend-down from network failure.
            console.warn('Provider health check failed:', reason);
            setState({ providers: [], isLoading: false, hasError: true });
          }
        });
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };

    load();
    const interval = window.setInterval(load, PROVIDER_HEALTH_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, []);

  return state;
}
