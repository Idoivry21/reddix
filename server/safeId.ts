import path from 'node:path';

/**
 * Allowlist for persistence identifiers (flow ids, run flow ids).
 * Only word characters, dash, and dot are permitted, and the value must be a
 * single path segment that cannot escape the data directory.
 *
 * Real ids in this app are slugs such as `primary-flow` (see src/flowTypes.ts)
 * or generated ids (UUID / nanoid) — all of which match this pattern.
 */
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_ID_LENGTH = 200;

export function isSafeId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    return false;
  }
  if (id === '.' || id === '..') {
    return false;
  }
  // Reject leading dot (`.hidden`, `..foo`) and `\0`/path separators outright.
  if (id.startsWith('.') || id.includes('\0') || id.includes('/') || id.includes('\\')) {
    return false;
  }
  if (!SAFE_ID_PATTERN.test(id)) {
    return false;
  }
  // Defense in depth: the id must remain a single basename segment.
  return path.basename(id) === id;
}

export function assertSafeId(id: unknown): string {
  if (!isSafeId(id)) {
    throw new Error(`Invalid id: ${typeof id === 'string' ? JSON.stringify(id) : typeof id}`);
  }
  return id;
}

/**
 * Resolve `relativePath` against `baseDir` and assert the result stays inside
 * `baseDir`. Throws on any path that escapes (e.g. `../`, absolute paths).
 * Used for export artifacts whose names come from user-controlled settings.
 */
/** True if `resolvedTarget` is `resolvedBase` itself or sits under it. The single
 * containment rule both path guards share — fix a traversal edge case here once. */
function isWithinBase(resolvedTarget: string, resolvedBase: string): boolean {
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

export function resolveContainedPath(baseDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    throw new Error('Invalid path');
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);
  if (!isWithinBase(resolvedTarget, resolvedBase)) {
    throw new Error(`Invalid path: ${JSON.stringify(relativePath)} escapes the base directory`);
  }
  return resolvedTarget;
}

/**
 * Build `<dir>/<id><suffix>` after validating the id, then assert the resolved
 * path stays inside the resolved base dir. Belt-and-suspenders: even a gap in
 * the id validator cannot let a path escape the data directory.
 */
export function safeSegmentPath(dir: string, id: unknown, suffix = ''): string {
  const safeId = assertSafeId(id);
  const filePath = path.join(dir, `${safeId}${suffix}`);
  const resolvedBase = path.resolve(dir);
  const resolvedFile = path.resolve(filePath);
  if (!isWithinBase(resolvedFile, resolvedBase)) {
    throw new Error(`Invalid id: ${JSON.stringify(safeId)} escapes the base directory`);
  }
  return filePath;
}
