import type { CorsOptions } from 'cors';

/**
 * Env-like object: only the keys we read are required, values may be undefined.
 */
type EnvLike = Record<string, string | undefined>;

/**
 * Comma-separated env var listing the origins allowed to call the backend.
 * Defaults to the local Vite dev origins below.
 */
export const ALLOWED_ORIGINS_ENV_KEY = 'REDDIX_ALLOWED_ORIGINS';

/**
 * The local Vite dev server is served on both loopback hostnames; allow both so
 * the workbench works regardless of which the user navigates to.
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173'
] as const;

/**
 * Parses the allowlist from the environment. Falls back to the default local
 * Vite origins when the env var is unset or blank. Entries are trimmed and
 * empty entries are dropped so a stray comma cannot widen the allowlist.
 */
export function parseAllowedOrigins(env: EnvLike): string[] {
  const raw = env[ALLOWED_ORIGINS_ENV_KEY];
  const parsed = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * Decides whether a request's `Origin` is permitted. A missing origin (same
 * origin requests, curl, health checks) is always allowed; everything else must
 * match an allowlisted origin exactly. Arbitrary origins are never reflected.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

/**
 * Builds the `cors` middleware options from the environment, restricting cross
 * origin access to the allowlist. The callback never errors on a rejected
 * origin; it simply withholds CORS headers so the browser blocks the response.
 */
export function buildCorsOptions(env: EnvLike): CorsOptions {
  const allowedOrigins = parseAllowedOrigins(env);

  return {
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, allowedOrigins));
    }
  };
}
