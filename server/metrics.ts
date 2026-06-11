type Labels = Record<string, string | number>;

interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, HistogramSnapshot>;
}

export interface Metrics {
  /** Increment a named counter (optionally labeled) by `by` (default 1). */
  increment(name: string, labels?: Labels, by?: number): void;
  /** Record a value into a named histogram (e.g. a duration in ms). */
  observe(name: string, value: number, labels?: Labels): void;
  /** Point-in-time view of every counter and histogram. */
  snapshot(): MetricsSnapshot;
}

/** Flatten a metric name + sorted labels into a single stable key. */
function metricKey(name: string, labels?: Labels): string {
  if (!labels) {
    return name;
  }
  const parts = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

/**
 * Minimal in-memory metrics registry. No external dependency, no background
 * timer — counters and histograms accumulate for the process lifetime and are
 * read via `snapshot()` (exposed at GET /api/metrics). Sufficient for a local
 * single-user workbench; swap for a Prometheus client if this ever runs as a
 * shared service.
 */
export function createMetrics(): Metrics {
  const counters = new Map<string, number>();
  const histograms = new Map<string, HistogramSnapshot>();

  return {
    increment(name, labels, by = 1) {
      const key = metricKey(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + by);
    },
    observe(name, value, labels) {
      const key = metricKey(name, labels);
      const current = histograms.get(key);
      if (!current) {
        histograms.set(key, { count: 1, sum: value, min: value, max: value });
        return;
      }
      histograms.set(key, {
        count: current.count + 1,
        sum: current.sum + value,
        min: Math.min(current.min, value),
        max: Math.max(current.max, value)
      });
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries(histograms)
      };
    }
  };
}

/** No-op metrics used as a default so callers never have to null-check. */
export const noopMetrics: Metrics = {
  increment() {},
  observe() {},
  snapshot() {
    return { counters: {}, histograms: {} };
  }
};
