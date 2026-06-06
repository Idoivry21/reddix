import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_ORIGINS,
  buildCorsOptions,
  isAllowedOrigin,
  parseAllowedOrigins
} from '../server/cors';

describe('parseAllowedOrigins', () => {
  it('defaults to the local Vite dev origins when the env var is unset', () => {
    expect(parseAllowedOrigins({})).toEqual(DEFAULT_ALLOWED_ORIGINS);
  });

  it('defaults when the env var is an empty/whitespace string', () => {
    expect(parseAllowedOrigins({ REDDIX_ALLOWED_ORIGINS: '   ' })).toEqual(
      DEFAULT_ALLOWED_ORIGINS
    );
  });

  it('parses a comma-separated override, trimming whitespace and dropping blanks', () => {
    expect(
      parseAllowedOrigins({
        REDDIX_ALLOWED_ORIGINS: 'https://app.example , , http://localhost:4321'
      })
    ).toEqual(['https://app.example', 'http://localhost:4321']);
  });
});

describe('isAllowedOrigin', () => {
  it('allows requests with no Origin header (same-origin / curl / health checks)', () => {
    expect(isAllowedOrigin(undefined, DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it('allows each default local Vite origin', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(true);
  });

  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });

  it('does not reflect arbitrary origins via substring matches', () => {
    expect(
      isAllowedOrigin('http://127.0.0.1:5173.evil.example', DEFAULT_ALLOWED_ORIGINS)
    ).toBe(false);
  });

  it('rejects known origin-spoofing shapes (exact match only)', () => {
    // userinfo trick, wrong scheme, and port-extension must all be rejected.
    expect(isAllowedOrigin('http://localhost:5173@evil.com', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('https://localhost:5173', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
    expect(isAllowedOrigin('http://localhost:51730', DEFAULT_ALLOWED_ORIGINS)).toBe(false);
  });

  it('respects an env-provided allowlist', () => {
    const allowed = parseAllowedOrigins({ REDDIX_ALLOWED_ORIGINS: 'https://app.example' });
    expect(isAllowedOrigin('https://app.example', allowed)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(false);
  });
});

describe('buildCorsOptions', () => {
  function resolve(origin: string | undefined, env: Record<string, string | undefined> = {}) {
    const { origin: originOption } = buildCorsOptions(env);
    return new Promise<boolean>((resolvePromise, rejectPromise) => {
      if (typeof originOption !== 'function') {
        rejectPromise(new Error('origin option must be a function'));
        return;
      }
      originOption(origin, (error, allow) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(Boolean(allow));
      });
    });
  }

  it('accepts the allowed Vite origin', async () => {
    await expect(resolve('http://127.0.0.1:5173')).resolves.toBe(true);
  });

  it('allows requests with no Origin header', async () => {
    await expect(resolve(undefined)).resolves.toBe(true);
  });

  it('rejects a foreign origin without throwing', async () => {
    await expect(resolve('https://evil.example')).resolves.toBe(false);
  });

  it('honors an env override', async () => {
    await expect(
      resolve('https://app.example', { REDDIX_ALLOWED_ORIGINS: 'https://app.example' })
    ).resolves.toBe(true);
    await expect(
      resolve('http://127.0.0.1:5173', { REDDIX_ALLOWED_ORIGINS: 'https://app.example' })
    ).resolves.toBe(false);
  });
});
