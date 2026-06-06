import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  async function ensureDirs() {
    await mkdir(flowsDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
  }

  return {
    async saveFlow(flow: PersistedFlow): Promise<void> {
      await ensureDirs();
      await writeJson(path.join(flowsDir, `${flow.id}.json`), flow);
    },

    async getFlow(flowId: string): Promise<PersistedFlow | null> {
      await ensureDirs();
      return readJson<PersistedFlow | null>(path.join(flowsDir, `${flowId}.json`), null);
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
      await ensureDirs();
      const filePath = path.join(runsDir, `${run.flowId}.json`);
      const runs = await readJson<RunRecord[]>(filePath, []);
      const capped = [...runs, run].slice(-maxRunsPerFlow);
      await writeJson(filePath, capped);
    },

    async listRuns(flowId: string): Promise<RunRecord[]> {
      await ensureDirs();
      return readJson<RunRecord[]>(path.join(runsDir, `${flowId}.json`), []);
    },

    async getPreferences(): Promise<Preferences> {
      await ensureDirs();
      const raw = await readJson<Partial<Preferences>>(preferencesPath, {});
      const migrated: Preferences = {
        schemaVersion: 1,
        defaultExportDir: raw.defaultExportDir ?? 'outputs',
        selectedFlowId: raw.selectedFlowId ?? null
      };
      if (raw.schemaVersion !== 1) {
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
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
