export type SecretMap = Record<string, string | undefined | null>;

/**
 * Environment variables that may hold auth secrets the CLIs consume. These must
 * never reach flow JSON, run records, the command trace, the SSE stream, or logs.
 */
export const AUTH_ENV_KEYS = ['TWITTER_AUTH_TOKEN', 'TWITTER_CT0'] as const;

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

