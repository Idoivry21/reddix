/**
 * Isomorphic value helpers shared by the frontend command preview and the backend
 * execution engine. Coercion and "blank"/"plain object" checks live here in ONE
 * place so the UI, the executor, the transforms, and the report can never disagree
 * on how an untrusted block setting or CLI payload field is interpreted.
 */

/**
 * Coerce a value to a finite number, accepting numbers and numeric strings.
 * Returns null when the value is not a finite number or a parseable numeric string.
 */
export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Like {@link coerceFiniteNumber} but returns `fallback` instead of null. */
export function coerceNumber(value: unknown, fallback: number): number {
  return coerceFiniteNumber(value) ?? fallback;
}

/** True for undefined, null, or a whitespace-only string — i.e. an unfilled field. */
export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** Narrows untrusted JSON to a plain object (excludes arrays and null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
