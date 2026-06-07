import { spawn } from 'node:child_process';
import { AUTH_ENV_KEYS } from '../src/shared/redaction';
import type { BuiltCommand } from '../src/shared/types';
import { createCappedBuffer } from './cappedBuffer';
import type { EventLogger } from './logger';
import { noopMetrics, type Metrics } from './metrics';
import type { CliExecutor, ExecutorResult } from './types';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB per stream
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const OUTPUT_LIMIT_EXIT_CODE = 1;
const TIMEOUT_EXIT_CODE = 124;
const SPAWN_ERROR_EXIT_CODE = 127; // conventional "command not found" / spawn failure
// A `--help` health probe should be small and fast — bound it tighter than a real run.
const HEALTH_CHECK_MAX_OUTPUT_BYTES = 64 * 1024;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Builds a least-privilege environment for a spawned CLI: only the variables
 * needed to locate the binary plus the allowlisted auth vars the CLI consumes.
 * Empty/undefined values are dropped so we never override a real value with ''.
 */
function buildCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passthroughKeys = ['PATH', 'HOME', 'TMPDIR', ...AUTH_ENV_KEYS];
  return passthroughKeys.reduce<NodeJS.ProcessEnv>((next, key) => {
    const value = env[key];
    return value ? { ...next, [key]: value } : next;
  }, {});
}

export function resolveMaxOutputBytes(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.REDDIX_MAX_OUTPUT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OUTPUT_BYTES;
}

export function resolveCliTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.REDDIX_CLI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

interface SpawnCappedOptions {
  env: NodeJS.ProcessEnv;
  maxOutputBytes: number;
  timeoutMs?: number;
}

/**
 * Spawn a process (shell: false) capturing stdout/stderr with a hard byte cap.
 * If either stream exceeds the cap the child is killed, the output is truncated,
 * and the result is marked failed with a clear reason so the step fails.
 */
export function spawnCapped(
  executable: string,
  argv: string[],
  options: SpawnCappedOptions
): Promise<ExecutorResult> {
  return new Promise<ExecutorResult>((resolve) => {
    const child = spawn(executable, argv, { shell: false, env: options.env });
    const stdout = createCappedBuffer(options.maxOutputBytes);
    const stderr = createCappedBuffer(options.maxOutputBytes);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let settled = false;
    let timedOut = false;

    const finalize = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (stdout.truncated || stderr.truncated) {
        const reason = `[reddix] output exceeded ${options.maxOutputBytes} bytes; process terminated`;
        const combinedStderr = stderr.value ? `${stderr.value}\n${reason}` : reason;
        resolve({ stdout: stdout.value, stderr: combinedStderr, exitCode: OUTPUT_LIMIT_EXIT_CODE });
        return;
      }
      if (timedOut) {
        const reason = `[reddix] process timed out after ${timeoutMs} ms; process terminated`;
        const combinedStderr = stderr.value ? `${stderr.value}\n${reason}` : reason;
        resolve({ stdout: stdout.value, stderr: combinedStderr, exitCode: TIMEOUT_EXIT_CODE });
        return;
      }
      resolve({ stdout: stdout.value, stderr: stderr.value, exitCode });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      finalize(TIMEOUT_EXIT_CODE);
    }, timeoutMs);
    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    const killIfOver = (): void => {
      if (stdout.truncated || stderr.truncated) {
        child.kill('SIGKILL');
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout.append(chunk.toString());
      killIfOver();
    });
    child.stderr.on('data', (chunk) => {
      stderr.append(chunk.toString());
      killIfOver();
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout: stdout.value, stderr: error.message, exitCode: SPAWN_ERROR_EXIT_CODE });
    });
    child.on('close', (code) => {
      finalize(code ?? 1);
    });
  });
}

interface CliExecutorDeps {
  logger?: EventLogger;
  metrics?: Metrics;
}

/**
 * Build the production CLI executor. Wraps {@link spawnCapped} with structured
 * logging and metrics so each external CLI invocation leaves a trace: which
 * executable ran, its exit code, how long it took, and whether it timed out or
 * was truncated. Only the executable name and exit metadata are logged — never
 * argv (which may carry secrets) or output.
 */
export function createCliExecutor(deps: CliExecutorDeps = {}): CliExecutor {
  const { logger, metrics = noopMetrics } = deps;
  return async (command: BuiltCommand): Promise<ExecutorResult> => {
    const startedAt = process.hrtime.bigint();
    const result = await spawnCapped(command.executable, command.argv, {
      env: buildCliEnv(process.env),
      maxOutputBytes: resolveMaxOutputBytes(process.env),
      timeoutMs: resolveCliTimeoutMs(process.env)
    });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const timedOut = result.exitCode === TIMEOUT_EXIT_CODE;
    const truncated =
      result.exitCode === OUTPUT_LIMIT_EXIT_CODE && result.stderr.includes('output exceeded');

    metrics.increment('cli_exec_total', { provider: command.provider, exitCode: result.exitCode });
    metrics.observe('cli_duration_ms', durationMs, { provider: command.provider });
    if (timedOut) {
      metrics.increment('cli_timeout_total', { provider: command.provider });
    }
    if (truncated) {
      metrics.increment('cli_truncated_total', { provider: command.provider });
    }

    logger?.info('cli.exec', {
      provider: command.provider,
      executable: command.executable,
      exitCode: result.exitCode,
      durationMs: Math.round(durationMs),
      timedOut,
      truncated
    });
    return result;
  };
}

export async function checkExecutable(executable: string): Promise<boolean> {
  const result = await spawnCapped(executable, ['--help'], {
    env: buildCliEnv(process.env),
    maxOutputBytes: HEALTH_CHECK_MAX_OUTPUT_BYTES,
    timeoutMs: Math.min(resolveCliTimeoutMs(process.env), HEALTH_CHECK_TIMEOUT_MS)
  });
  return result.exitCode === 0;
}
