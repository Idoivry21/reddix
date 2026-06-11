import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePort, summarizeAuthPresence, validateEnv } from '../server/env';

describe('parsePort', () => {
  it('accepts a valid port', () => {
    expect(parsePort('8787')).toBe(8787);
  });

  it('rejects non-numeric, out-of-range, or fractional ports', () => {
    expect(parsePort('abc')).toBeNull();
    expect(parsePort('0')).toBeNull();
    expect(parsePort('70000')).toBeNull();
    expect(parsePort('80.5')).toBeNull();
  });
});

describe('validateEnv', () => {
  it('returns defaults when nothing is set', () => {
    const result = validateEnv({});
    expect(result.port).toBe(8787);
    expect(result.dataDir).toBe(path.join(process.cwd(), '.reddix-data'));
  });

  it('honours valid overrides', () => {
    const result = validateEnv({ PORT: '9000', REDDIX_DATA_DIR: '/tmp/data' });
    expect(result.port).toBe(9000);
    expect(result.dataDir).toBe('/tmp/data');
  });

  it('throws on an invalid PORT', () => {
    expect(() => validateEnv({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('throws on an empty REDDIX_DATA_DIR override', () => {
    expect(() => validateEnv({ REDDIX_DATA_DIR: '   ' })).toThrow(/REDDIX_DATA_DIR/);
  });
});

describe('summarizeAuthPresence', () => {
  it('reports presence without leaking values', () => {
    const summary = summarizeAuthPresence({
      TWITTER_AUTH_TOKEN: 'super-secret-token',
      TWITTER_CT0: ''
    });
    expect(summary).not.toContain('super-secret-token');
    expect(summary).toContain('TWITTER_AUTH_TOKEN');
    expect(summary.toLowerCase()).toContain('set');
    expect(summary.toLowerCase()).toContain('missing');
  });
});
