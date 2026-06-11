import { describe, expect, it } from 'vitest';
import { createMetrics, noopMetrics } from '../server/metrics';

describe('createMetrics', () => {
  it('accumulates counters, including labeled variants separately', () => {
    const metrics = createMetrics();
    metrics.increment('flow_runs_total', { status: 'success' });
    metrics.increment('flow_runs_total', { status: 'success' });
    metrics.increment('flow_runs_total', { status: 'failed' });
    metrics.increment('runs_total');

    const snapshot = metrics.snapshot();
    expect(snapshot.counters['flow_runs_total{status=success}']).toBe(2);
    expect(snapshot.counters['flow_runs_total{status=failed}']).toBe(1);
    expect(snapshot.counters['runs_total']).toBe(1);
  });

  it('records histogram count/sum/min/max', () => {
    const metrics = createMetrics();
    metrics.observe('cli_duration_ms', 100, { provider: 'reddit' });
    metrics.observe('cli_duration_ms', 300, { provider: 'reddit' });

    const histogram = metrics.snapshot().histograms['cli_duration_ms{provider=reddit}'];
    expect(histogram).toEqual({ count: 2, sum: 400, min: 100, max: 300 });
  });

  it('uses a stable key regardless of label insertion order', () => {
    const metrics = createMetrics();
    metrics.increment('e', { a: '1', b: '2' });
    metrics.increment('e', { b: '2', a: '1' });
    expect(metrics.snapshot().counters['e{a=1,b=2}']).toBe(2);
  });

  it('noopMetrics records nothing', () => {
    noopMetrics.increment('x');
    noopMetrics.observe('y', 1);
    expect(noopMetrics.snapshot()).toEqual({ counters: {}, histograms: {} });
  });
});
