import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createKeyedMutex } from './keyedMutex';
import type { EventLogger } from './logger';
import { safeSegmentPath } from './safeId';
import type { PersistedFlow, Preferences, RunRecord } from './types';
import { isRecord } from '../src/shared/values';

/** The schema version this build reads and writes. Records on disk with a HIGHER
 *  version were written by a newer Reddix and must never be silently overwritten. */
const CURRENT_SCHEMA_VERSION = 1;
/** Fixed key for the single shared preferences file in its serialization mutex. */
const PREFERENCES_LOCK = 'preferences';
/** Matches a temp file left by {@link writeJson}: `.<name>.<pid>.<uuid>.tmp`. */
const TEMP_FILE_PATTERN = /\.(\d+)\.[0-9a-f-]{36}\.tmp$/;

/** True when a persisted record was written by a newer schema than this build. */
function isFutureVersion(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion > CURRENT_SCHEMA_VERSION
  );
}

/** Throw rather than overwrite a single-record file from a newer Reddix version. */
function assertNotFutureVersion(value: unknown, filePath: string): void {
  if (isFutureVersion(value)) {
    throw new Error(`${filePath} was written by a newer Reddix version; refusing to overwrite`);
  }
}

/**
 * Remove temp files orphaned by a write interrupted between open() and rename().
 * Only deletes temp files stamped with a DIFFERENT pid than this process, so a
 * concurrent in-flight write by THIS process is never touched. Best-effort:
 * unreadable dirs and unlink races are swallowed.
 */
export async function sweepStaleTempFiles(dirs: string[], logger?: EventLogger): Promise<void> {
  const ownPid = String(process.pid);
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = TEMP_FILE_PATTERN.exec(entry);
      if (!match || match[1] === ownPid) {
        continue;
      }
      await unlink(path.join(dir, entry)).catch(() => {});
    }
  }
  logger?.info('storage.tempSweep', { dirs: dirs.length });
}

interface StorageOptions {
  baseDir: string;
  maxRunsPerFlow?: number;
  logger?: EventLogger;
}

export function createStorage(options: StorageOptions) {
  const maxRunsPerFlow = options.maxRunsPerFlow ?? 50;
  const logger = options.logger;
  const flowsDir = path.join(options.baseDir, 'flows');
  const runsDir = path.join(options.baseDir, 'runs');
  const preferencesPath = path.join(options.baseDir, 'preferences.json');
  // Serialize run-record read-modify-write per flow so concurrent appends
  // (manual POST /runs + scheduler) never drop records.
  const runWriteMutex = createKeyedMutex(logger);
  const flowWriteMutex = createKeyedMutex(logger);
  const deletedFlowIds = new Set<string>();
  // Preferences are a single shared file; serialize its read-modify-write
  // (getPreferences migrates-on-read) so a migrate-write can't clobber a save.
  const prefWriteMutex = createKeyedMutex(logger);

  // Best-effort startup sweep of orphaned temp files left by a write that was
  // interrupted between open() and rename(). Fire-and-forget; never blocks boot.
  void sweepStaleTempFiles([flowsDir, runsDir, options.baseDir], logger);

  async function ensureDirs() {
    await mkdir(flowsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
  }

  return {
    async saveFlow(flow: PersistedFlow): Promise<void> {
      const filePath = safeSegmentPath(flowsDir, flow.id, '.json');
      await flowWriteMutex.run(flow.id, async () => {
        await ensureDirs();
        // Refuse to overwrite a flow written by a NEWER Reddix version: dropping
        // to our schema would silently destroy fields we don't understand.
        const existing = await readJson<unknown>(filePath, null, logger, { throwOnCorrupt: true });
        assertNotFutureVersion(existing, filePath);
        await writeJson(filePath, flow, logger);
        deletedFlowIds.delete(flow.id);
      });
    },

    async getFlow(flowId: string): Promise<PersistedFlow | null> {
      const filePath = safeSegmentPath(flowsDir, flowId, '.json');
      await ensureDirs();
      const raw = await readJson<unknown>(filePath, null, logger);
      return normalizePersistedFlow(raw, filePath, logger);
    },

    /**
     * Remove a flow and its run history. Idempotent: a missing flow file is not
     * an error — resolves `false` so the route can answer 404. Takes both per-flow
     * locks (flow first, then runs) so a concurrent saveFlow/appendRun can't
     * leave a half-deleted flow; the tombstone below rejects late appends that
     * arrive after the delete has fully completed.
     */
    async deleteFlow(flowId: string): Promise<boolean> {
      const flowPath = safeSegmentPath(flowsDir, flowId, '.json');
      const runsPath = safeSegmentPath(runsDir, flowId, '.json');
      return flowWriteMutex.run(flowId, async () => {
        await ensureDirs();
        const existed = await unlinkIfExists(flowPath, logger);
        await runWriteMutex.run(flowId, () => unlinkIfExists(runsPath, logger));
        if (existed) {
          deletedFlowIds.add(flowId);
        }
        return existed;
      });
    },

    async listFlows(): Promise<PersistedFlow[]> {
      await ensureDirs();
      const files = await readdir(flowsDir);
      const flows = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) => {
            const filePath = path.join(flowsDir, file);
            const raw = await readJson<unknown>(filePath, null, logger);
            return normalizePersistedFlow(raw, filePath, logger);
          })
      );
      return flows.filter((flow): flow is PersistedFlow => flow !== null);
    },

    async appendRun(run: RunRecord): Promise<void> {
      const filePath = safeSegmentPath(runsDir, run.flowId, '.json');
      const flowPath = safeSegmentPath(flowsDir, run.flowId, '.json');
      await runWriteMutex.run(run.flowId, async () => {
        await ensureDirs();
        if (deletedFlowIds.has(run.flowId) && !(await fileExists(flowPath))) {
          return;
        }
        if (deletedFlowIds.has(run.flowId)) {
          deletedFlowIds.delete(run.flowId);
        }
        const raw = await readJson<unknown>(filePath, [], logger, { throwOnCorrupt: true });
        // Refuse to overwrite history written by a NEWER Reddix version. The capped
        // write below re-persists the list; if any record is from a future schema
        // we cannot parse, blindly rewriting would PERMANENTLY drop it. Fail the
        // append instead so the run surfaces as an error and the data is preserved.
        if (Array.isArray(raw) && raw.some(isFutureVersion)) {
          throw new Error(
            `Run history for ${run.flowId} was written by a newer Reddix version; refusing to overwrite`
          );
        }
        const runs = normalizeRunList(raw, filePath, logger);
        const capped = [...runs, run].slice(-maxRunsPerFlow);
        await writeJson(filePath, capped, logger);
      });
    },

    async listRuns(flowId: string): Promise<RunRecord[]> {
      const filePath = safeSegmentPath(runsDir, flowId, '.json');
      await ensureDirs();
      return normalizeRunList(await readJson<unknown>(filePath, [], logger), filePath, logger);
    },

    async getPreferences(): Promise<Preferences> {
      await ensureDirs();
      return prefWriteMutex.run(PREFERENCES_LOCK, async () => {
        const raw = await readJson<unknown>(preferencesPath, {}, logger);
        const migrated: Preferences = {
          schemaVersion: 1,
          defaultExportDir:
            isRecord(raw) && typeof raw.defaultExportDir === 'string' ? raw.defaultExportDir : 'outputs',
          selectedFlowId:
            isRecord(raw) && (typeof raw.selectedFlowId === 'string' || raw.selectedFlowId === null)
              ? raw.selectedFlowId
              : null
        };
        // Migrate-write back only for OLD/unshaped files. Never rewrite a file from
        // a NEWER version: that would drop fields we don't model. We still return a
        // usable view (coerced known fields) without touching the on-disk record.
        if ((!isRecord(raw) || raw.schemaVersion !== 1) && !isFutureVersion(raw)) {
          await writeJson(preferencesPath, migrated, logger);
        }
        return migrated;
      });
    },

    async savePreferences(preferences: Preferences): Promise<void> {
      await ensureDirs();
      await prefWriteMutex.run(PREFERENCES_LOCK, async () => {
        const existing = await readJson<unknown>(preferencesPath, null, logger);
        assertNotFutureVersion(existing, preferencesPath);
        await writeJson(preferencesPath, preferences, logger);
      });
    }
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function normalizePersistedFlow(value: unknown, filePath: string, logger?: EventLogger): PersistedFlow | null {
  if (value === null) {
    return null;
  }
  if (isPersistedFlow(value)) {
    return value;
  }
  logger?.warn('storage.invalidShape', { path: filePath, expected: 'PersistedFlow' });
  return null;
}

function normalizeRunList(value: unknown, filePath: string, logger?: EventLogger): RunRecord[] {
  if (!Array.isArray(value)) {
    logger?.warn('storage.invalidShape', { path: filePath, expected: 'RunRecord[]' });
    return [];
  }
  const runs = value.filter(isRunRecord);
  if (runs.length !== value.length) {
    logger?.warn('storage.invalidShape', { path: filePath, expected: 'RunRecord[]' });
  }
  return runs;
}

function isPersistedFlow(value: unknown): value is PersistedFlow {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isRecord(value.nodePositions) &&
    isRecord(value.blockSettings) &&
    isRecord(value.schedule) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isRunRecord(value: unknown): value is RunRecord {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === 'string' &&
    typeof value.flowId === 'string' &&
    (value.status === 'success' || value.status === 'failed' || value.status === 'skipped' || value.status === 'running') &&
    typeof value.startedAt === 'string' &&
    (typeof value.endedAt === 'string' || value.endedAt === null) &&
    Array.isArray(value.steps) &&
    Array.isArray(value.outputFiles) &&
    (typeof value.error === 'string' || value.error === null)
  );
}

/** Unlink a file, treating "already gone" as success. Returns whether a file was
 *  actually removed so callers can distinguish a real delete from a no-op. */
async function unlinkIfExists(filePath: string, logger?: EventLogger): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    logger?.error('storage.deleteFailed', {
      path: filePath,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function readJson<T>(
  filePath: string,
  fallback: T,
  logger?: EventLogger,
  options: { throwOnCorrupt?: boolean } = {}
): Promise<T> {
  try {
    const contents = await readFile(filePath, 'utf8');
    try {
      return JSON.parse(contents) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        // A corrupt JSON file is data loss waiting to be misdiagnosed: the
        // caller silently gets a default (empty flow list / null flow / []),
        // so without this warning a user's vanished flow looks like a 404.
        logger?.warn('storage.corruptJson', {
          path: filePath,
          bytes: contents.length,
          detail: error.message
        });
        if (options.throwOnCorrupt) {
          throw new Error(`Corrupt JSON in ${filePath}; refusing to overwrite`);
        }
        return fallback;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown, logger?: EventLogger): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    await syncDirectory(dir);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlink(tempPath).catch(() => {});
    // Surface the storage failure before re-throwing; the route/scheduler layer
    // turns the rejection into a failed run, but the durable signal lives here.
    logger?.error('storage.writeFailed', {
      path: filePath,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every filesystem. The temp+rename is
    // still atomic; skip only the durability flush when the platform refuses it.
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}
