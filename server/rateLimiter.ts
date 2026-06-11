interface RateLimiterOptions {
  /** Minimum gap between two acquisitions for the same key. */
  minIntervalMs: number;
  /** How long an idle key is retained before pruning. Defaults to 2 windows. */
  ttlMs?: number;
  /** Hard ceiling on tracked keys. Backstops the TTL prune against a flood of
   *  unique keys (e.g. attacker-varied nodeId) arriving faster than they expire. */
  maxKeys?: number;
  now?: () => number;
}

/** Default key ceiling — generous for a single-user app, but bounds memory if the
 *  key space is ever driven by partially attacker-controlled input. */
const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimiter {
  tryAcquire: (key: string) => boolean;
  readonly size: number;
}

/**
 * Minimum-gap rate limiter keyed by an arbitrary string (e.g. flow id). Guards
 * the subprocess-spawning /runs route from rapid repeated triggers.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? Math.max(options.minIntervalMs * 2, 60_000);
  const maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  const lastAcquireAt = new Map<string, number>();

  return {
    tryAcquire(key: string): boolean {
      const at = now();
      pruneExpired(at);
      const previous = lastAcquireAt.get(key);
      if (previous !== undefined && at - previous < options.minIntervalMs) {
        return false;
      }
      // Hard cap: if a new key would breach the ceiling (keys arriving faster than
      // the TTL prune evicts them), drop the oldest-inserted key to bound memory.
      // The dropped key simply loses its throttle window — never a security issue.
      if (previous === undefined && lastAcquireAt.size >= maxKeys) {
        const oldest = lastAcquireAt.keys().next().value;
        if (oldest !== undefined) {
          lastAcquireAt.delete(oldest);
        }
      }
      lastAcquireAt.set(key, at);
      return true;
    },
    get size() {
      return lastAcquireAt.size;
    }
  };

  function pruneExpired(at: number): void {
    for (const [key, previous] of lastAcquireAt) {
      if (at - previous >= ttlMs) {
        lastAcquireAt.delete(key);
      }
    }
  }
}
