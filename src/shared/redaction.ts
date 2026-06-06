type SecretMap = Record<string, string | undefined | null>;

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

