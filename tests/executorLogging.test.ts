// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createCliExecutor } from '../server/executor';
import { createMetrics } from '../server/metrics';
import type { BuiltCommand } from '../src/shared/types';

function captureLogger() {
  const lines: Array<{ level: string; message: string; fields: Record<string, unknown> }> = [];
  const push = (level: string) => (message: string, fields: Record<string, unknown> = {}) =>
    lines.push({ level, message, fields });
  return { lines, logger: { info: push('info'), warn: push('warn'), error: push('error') } };
}

function command(argv: string[]): BuiltCommand {
  return {
    executable: process.execPath,
    argv,
    displayArgv: argv,
    provider: 'reddit'
  } as BuiltCommand;
}

describe('createCliExecutor observability (finding 8)', () => {
  it('logs cli.exec with exit code and duration, and counts the invocation', async () => {
    const { lines, logger } = captureLogger();
    const metrics = createMetrics();
    const executor = createCliExecutor({ logger, metrics });

    const result = await executor(command(['-e', "process.stdout.write('hi')"]));

    expect(result.exitCode).toBe(0);
    const log = lines.find((line) => line.message === 'cli.exec');
    expect(log?.fields.provider).toBe('reddit');
    expect(log?.fields.exitCode).toBe(0);
    expect(typeof log?.fields.durationMs).toBe('number');
    expect(metrics.snapshot().counters['cli_exec_total{exitCode=0,provider=reddit}']).toBe(1);
  });

  it('counts a timeout', async () => {
    const { logger } = captureLogger();
    const metrics = createMetrics();
    const executor = createCliExecutor({ logger, metrics });

    // No timeout knob on the executor itself; use a fast env override.
    const previous = process.env.REDDIX_CLI_TIMEOUT_MS;
    process.env.REDDIX_CLI_TIMEOUT_MS = '50';
    try {
      const result = await executor(command(['-e', 'setInterval(() => {}, 1000)']));
      expect(result.exitCode).not.toBe(0);
    } finally {
      if (previous === undefined) delete process.env.REDDIX_CLI_TIMEOUT_MS;
      else process.env.REDDIX_CLI_TIMEOUT_MS = previous;
    }

    expect(metrics.snapshot().counters['cli_timeout_total{provider=reddit}']).toBe(1);
  });
});
