import path from 'node:path';
import { AUTH_ENV_KEYS } from '../src/shared/redaction';

const DEFAULT_PORT = 8787;
const MIN_PORT = 1;
const MAX_PORT = 65535;

export interface ResolvedEnv {
  port: number;
  dataDir: string;
}

export function parsePort(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return null;
  }
  return parsed;
}

/**
 * Validate the process environment at startup. Throws a clear error on an
 * invalid PORT or empty REDDIX_DATA_DIR override; otherwise returns the
 * resolved port and data directory.
 */
export function validateEnv(env: NodeJS.ProcessEnv): ResolvedEnv {
  let port = DEFAULT_PORT;
  if (env.PORT !== undefined) {
    const parsed = parsePort(env.PORT);
    if (parsed === null) {
      throw new Error(`Invalid PORT: ${JSON.stringify(env.PORT)} (expected ${MIN_PORT}-${MAX_PORT})`);
    }
    port = parsed;
  }

  let dataDir = path.join(process.cwd(), '.reddix-data');
  if (env.REDDIX_DATA_DIR !== undefined) {
    if (env.REDDIX_DATA_DIR.trim() === '') {
      throw new Error('Invalid REDDIX_DATA_DIR: must not be empty');
    }
    dataDir = env.REDDIX_DATA_DIR;
  }

  return { port, dataDir };
}

/**
 * Describe which auth env vars are present WITHOUT revealing their values, for
 * a safe startup log line.
 */
export function summarizeAuthPresence(env: NodeJS.ProcessEnv): string {
  return AUTH_ENV_KEYS.map((key) => `${key}=${env[key] ? 'set' : 'missing'}`).join(', ');
}
