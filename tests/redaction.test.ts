import { describe, expect, it } from 'vitest';
import { collectWebhookSecrets, redactSecrets } from '../src/shared/redaction';

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

describe('collectWebhookSecrets', () => {
  const webhookNode = (authTokenEnvVar: string) => ({
    type: 'output.webhook',
    settings: { url: 'https://hooks.example.com/x', authTokenEnvVar }
  });

  it('resolves each webhook node env var name to its value', () => {
    const flow = { nodes: [webhookNode('SLACK_HOOK_TOKEN')] };
    expect(collectWebhookSecrets(flow, { SLACK_HOOK_TOKEN: 'tok-123' })).toEqual({ SLACK_HOOK_TOKEN: 'tok-123' });
  });

  it('yields no entry for an unset env var, so output can never collapse to [REDACTED]', () => {
    const flow = { nodes: [webhookNode('MISSING_TOKEN')] };
    expect(collectWebhookSecrets(flow, {})).toEqual({});
  });

  it('ignores non-webhook nodes and blank / missing env var names', () => {
    const flow = {
      nodes: [
        { type: 'reddit.searchPosts', settings: { authTokenEnvVar: 'NOT_A_HOOK' } },
        webhookNode(''),
        { type: 'output.webhook', settings: { url: 'https://x' } }
      ]
    };
    expect(collectWebhookSecrets(flow, { NOT_A_HOOK: 'x' })).toEqual({});
  });

  it('rejects an invalid env var name rather than resolving it', () => {
    const flow = { nodes: [webhookNode('bad name!')] };
    expect(collectWebhookSecrets(flow, { 'bad name!': 'value' })).toEqual({});
  });

  it('collects tokens from multiple webhook nodes', () => {
    const flow = { nodes: [webhookNode('HOOK_A'), webhookNode('HOOK_B')] };
    expect(collectWebhookSecrets(flow, { HOOK_A: 'a', HOOK_B: 'b' })).toEqual({ HOOK_A: 'a', HOOK_B: 'b' });
  });
});

