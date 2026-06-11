import { ENV_VAR_NAME_PATTERN } from './blockSpecs';

export type SecretMap = Record<string, string | undefined | null>;

/**
 * Environment variables that may hold auth secrets the CLIs consume. These must
 * never reach flow JSON, run records, the command trace, the SSE stream, or logs.
 */
export const AUTH_ENV_KEYS = ['TWITTER_AUTH_TOKEN', 'TWITTER_CT0'] as const;

/** Block type that names an env var holding a bearer token (the webhook sink). */
const WEBHOOK_BLOCK_TYPE = 'output.webhook';

/** Minimal flow shape `collectWebhookSecrets` reads — kept structural so this
 *  module stays isomorphic and dependency-light (no FlowDefinition import). */
export interface WebhookSecretSource {
  nodes: Array<{ type: string; settings: Record<string, unknown> }>;
}

/**
 * Resolve every `output.webhook` node's named auth env var to its value and
 * return them as a SecretMap, so `redactSecrets` can scrub the token from run
 * records, the SSE stream, and logs — the same env-sourcing pattern as the
 * Twitter CLI tokens. `env` is passed in (never read from `process.env` here) so
 * the function stays pure and unit-testable. Only non-empty values are returned,
 * so an unset env var can never collapse output to `[REDACTED]`.
 */
export function collectWebhookSecrets(flow: WebhookSecretSource, env: SecretMap): SecretMap {
  return flow.nodes.reduce<SecretMap>((map, node) => {
    if (node.type !== WEBHOOK_BLOCK_TYPE) {
      return map;
    }
    const name = node.settings.authTokenEnvVar;
    if (typeof name !== 'string' || !ENV_VAR_NAME_PATTERN.test(name)) {
      return map;
    }
    const value = env[name];
    return value ? { ...map, [name]: value } : map;
  }, {});
}

/**
 * Builds a redaction map from an environment-like object, keeping only the
 * allowlisted auth keys. Empty/undefined values are dropped so that an unset
 * secret can never collapse output to `[REDACTED]`.
 */
export function buildSecretMap(env: SecretMap): SecretMap {
  return AUTH_ENV_KEYS.reduce<SecretMap>((map, key) => {
    const value = env[key];
    return value ? { ...map, [key]: value } : map;
  }, {});
}

function nonEmptySecretValues(secrets: SecretMap): string[] {
  return Object.values(secrets).filter((value): value is string => Boolean(value));
}

export function redactSecrets(value: string, secrets: SecretMap): string;
export function redactSecrets(value: string[], secrets: SecretMap): string[];
export function redactSecrets(value: string | string[], secrets: SecretMap): string | string[] {
  const secretValues = nonEmptySecretValues(secrets);

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, secrets));
  }

  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
    value
  );
}

/**
 * Recursively apply a string redactor to every string within a JSON-serializable
 * value, returning a structurally-identical copy (the input is never mutated —
 * security invariant 2 / immutability). `redactSecrets` only handles
 * `string | string[]`; structured sink payloads that leave the process — webhook
 * bodies and export items — need every nested string scrubbed before delivery,
 * because a token a CLI echoes into a normalized field would otherwise reach a
 * served artifact or a third-party host. Non-string scalars pass through untouched.
 */
export function redactDeep<T>(value: T, redact: (input: string) => string): T {
  if (typeof value === 'string') {
    return redact(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, redact)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactDeep(entry, redact)])
    ) as T;
  }
  return value;
}

