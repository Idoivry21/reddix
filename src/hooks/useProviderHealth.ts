import { useEffect, useState } from 'react';
import { fetchHealth, type ProviderHealth } from '../api';

export interface ProviderHealthState {
  providers: ProviderHealth[];
  loading: boolean;
  error: boolean;
  /** Human-readable reason when the health check failed, for diagnostics. */
  errorReason?: string;
}

/**
 * Fetches per-provider CLI health from /health once on mount. A missing or
 * unhealthy binary is a core spec requirement to surface, so failures resolve
 * to an explicit error state rather than silently showing "Healthy".
 */
export function useProviderHealth(): ProviderHealthState {
  const [state, setState] = useState<ProviderHealthState>({
    providers: [],
    loading: true,
    error: false
  });

  useEffect(() => {
    if (typeof fetch === 'undefined') {
      setState({ providers: [], loading: false, error: true, errorReason: 'fetch unavailable' });
      return;
    }
    let cancelled = false;
    fetchHealth()
      .then((health) => {
        if (!cancelled) {
          setState({ providers: health.providers ?? [], loading: false, error: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const reason = error instanceof Error ? error.message : 'Unknown error';
          // Diagnostic trail: distinguishes backend-down from network failure.
          console.warn('Provider health check failed:', reason);
          setState({ providers: [], loading: false, error: true, errorReason: reason });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
