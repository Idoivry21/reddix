import { spawn } from 'node:child_process';
import { AUTH_ENV_KEYS } from '../src/shared/redaction';
import type { BuiltCommand } from '../src/shared/types';
import { createCappedBuffer } from './cappedBuffer';
import type { CliExecutor, ExecutorResult } from './types';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB per stream
const OUTPUT_LIMIT_EXIT_CODE = 1;

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

interface SpawnCappedOptions {
  env: NodeJS.ProcessEnv;
  maxOutputBytes: number;
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
    let settled = false;

    const finalize = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (stdout.truncated || stderr.truncated) {
        const reason = `[reddix] output exceeded ${options.maxOutputBytes} bytes; process terminated`;
        const combinedStderr = stderr.value ? `${stderr.value}\n${reason}` : reason;
        resolve({ stdout: stdout.value, stderr: combinedStderr, exitCode: OUTPUT_LIMIT_EXIT_CODE });
        return;
      }
      resolve({ stdout: stdout.value, stderr: stderr.value, exitCode });
    };

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
      resolve({ stdout: stdout.value, stderr: error.message, exitCode: 127 });
    });
    child.on('close', (code) => {
      finalize(code ?? 1);
    });
  });
}

export const cliExecutor: CliExecutor = (command: BuiltCommand) =>
  spawnCapped(command.executable, command.argv, {
    env: buildCliEnv(process.env),
    maxOutputBytes: resolveMaxOutputBytes(process.env)
  });

export async function checkExecutable(executable: string): Promise<boolean> {
  const result = await new Promise<ExecutorResult>((resolve) => {
    const child = spawn(executable, ['--help'], { shell: false, env: buildCliEnv(process.env) });
    child.on('error', (error) => {
      resolve({ stdout: '', stderr: error.message, exitCode: 127 });
    });
    child.on('close', (code) => {
      resolve({ stdout: '', stderr: '', exitCode: code ?? 1 });
    });
  });
  return result.exitCode === 0;
}
