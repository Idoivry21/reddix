import { useEffect, useState } from 'react';
import { fetchHealth, type ProviderHealth } from '../api';

export interface ProviderHealthState {
  providers: ProviderHealth[];
  isLoading: boolean;
  hasError: boolean;
}

/**
 * Fetches per-provider CLI health from /health once on mount. A missing or
 * unhealthy binary is a core spec requirement to surface, so failures resolve
 * to an explicit error state rather than silently showing "Healthy".
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
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
