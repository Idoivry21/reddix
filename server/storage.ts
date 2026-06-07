import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createKeyedMutex } from './keyedMutex';
import { safeSegmentPath } from './safeId';
import type { PersistedFlow, Preferences, RunRecord } from './types';

interface StorageOptions {
  baseDir: string;
  maxRunsPerFlow?: number;
}

export function createStorage(options: StorageOptions) {
  const maxRunsPerFlow = options.maxRunsPerFlow ?? 50;
  const flowsDir = path.join(options.baseDir, 'flows');
  const runsDir = path.join(options.baseDir, 'runs');
  const preferencesPath = path.join(options.baseDir, 'preferences.json');
  // Serialize run-record read-modify-write per flow so concurrent appends
  // (manual POST /runs + scheduler) never drop records.
  const runWriteMutex = createKeyedMutex();
  const flowWriteMutex = createKeyedMutex();

  async function ensureDirs() {
    await mkdir(flowsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
  }

  return {
    async saveFlow(flow: PersistedFlow): Promise<void> {
      const filePath = safeSegmentPath(flowsDir, flow.id, '.json');
      await flowWriteMutex.run(flow.id, async () => {
        await ensureDirs();
        await writeJson(filePath, flow);
      });
    },

    async getFlow(flowId: string): Promise<PersistedFlow | null> {
      const filePath = safeSegmentPath(flowsDir, flowId, '.json');
      await ensureDirs();
      return readJson<PersistedFlow | null>(filePath, null);
    },

    async listFlows(): Promise<PersistedFlow[]> {
      await ensureDirs();
      const files = await readdir(flowsDir);
      const flows = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map((file) => readJson<PersistedFlow | null>(path.join(flowsDir, file), null))
      );
      return flows.filter((flow): flow is PersistedFlow => flow !== null);
    },

    async appendRun(run: RunRecord): Promise<void> {
      const filePath = safeSegmentPath(runsDir, run.flowId, '.json');
      await runWriteMutex.run(run.flowId, async () => {
        await ensureDirs();
        const runs = await readJson<RunRecord[]>(filePath, []);
        const capped = [...runs, run].slice(-maxRunsPerFlow);
        await writeJson(filePath, capped);
      });
    },

    async listRuns(flowId: string): Promise<RunRecord[]> {
      const filePath = safeSegmentPath(runsDir, flowId, '.json');
      await ensureDirs();
      return readJson<RunRecord[]>(filePath, []);
    },

    async getPreferences(): Promise<Preferences> {
      await ensureDirs();
      const raw = await readJson<unknown>(preferencesPath, {});
      const migrated: Preferences = {
        schemaVersion: 1,
        defaultExportDir:
          isRecord(raw) && typeof raw.defaultExportDir === 'string' ? raw.defaultExportDir : 'outputs',
        selectedFlowId:
          isRecord(raw) && (typeof raw.selectedFlowId === 'string' || raw.selectedFlowId === null)
            ? raw.selectedFlowId
            : null
      };
      if (!isRecord(raw) || raw.schemaVersion !== 1) {
        await writeJson(preferencesPath, migrated);
      }
      return migrated;
    },

    async savePreferences(preferences: Preferences): Promise<void> {
      await ensureDirs();
      await writeJson(preferencesPath, preferences);
    }
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const contents = await readFile(filePath, 'utf8');
    try {
      return JSON.parse(contents) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
