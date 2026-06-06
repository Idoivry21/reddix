import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/shared/redaction';

describe('secret redaction', () => {
  it('redacts Twitter auth values from strings and argv arrays', () => {
    const secrets = {
      TWITTER_AUTH_TOKEN: 'auth-token-value',
      TWITTER_CT0: 'ct0-value'
    };

    expect(redactSecrets('token=auth-token-value ct0=ct0-value', secrets)).toBe(
      'token=[REDACTED] ct0=[REDACTED]'
    );
    expect(redactSecrets(['--token', 'auth-token-value', '--ct0', 'ct0-value'], secrets)).toEqual([
      '--token',
      '[REDACTED]',
      '--ct0',
      '[REDACTED]'
    ]);
  });

  it('ignores empty secret values', () => {
    expect(redactSecrets('empty values stay readable', { TWITTER_AUTH_TOKEN: '' })).toBe(
      'empty values stay readable'
    );
  });
});

