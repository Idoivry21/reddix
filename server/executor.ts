import { spawn } from 'node:child_process';
import { AUTH_ENV_KEYS } from '../src/shared/redaction';
import type { BuiltCommand } from '../src/shared/types';
import type { CliExecutor, ExecutorResult } from './types';

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

export const cliExecutor: CliExecutor = (command: BuiltCommand) => {
  return new Promise<ExecutorResult>((resolve) => {
    const child = spawn(command.executable, command.argv, {
      shell: false,
      env: buildCliEnv(process.env)
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ stdout, stderr: error.message, exitCode: 127 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
};

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

