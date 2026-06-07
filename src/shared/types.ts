import type { FlowEdgeModel, FlowNodeModel } from './graph';

export type ProviderId = 'reddit' | 'twitter' | 'local';

export type BlockCategory = 'Sources' | 'Enrichment' | 'Transform' | 'Output' | 'Utility';

export type BlockPriority = 'P0' | 'P1';

export type PortType = 'SocialItem[]' | 'DetailObject' | 'FileArtifact' | 'Any';

export interface PortSpec {
  id: string;
  label: string;
  type: PortType;
}

export interface BlockPorts {
  input: PortSpec[];
  output: PortSpec[];
}

export interface FieldOption {
  label: string;
  value: string | number | boolean;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'path';
  required?: boolean;
  min?: number;
  max?: number;
  options?: FieldOption[];
  help?: string;
}

export interface BlockSpec {
  type: string;
  label: string;
  provider: ProviderId;
  category: BlockCategory;
  priority: BlockPriority;
  description: string;
  ports: BlockPorts;
  fields: FieldSpec[];
  defaultSettings: Record<string, unknown>;
  command?: {
    executable: 'rdt' | 'twitter';
  };
}

export interface CommandBuildInput {
  blockId: string;
  blockType: string;
  settings: Record<string, unknown>;
}

export interface BuiltCommand {
  provider: Exclude<ProviderId, 'local'>;
  executable: 'rdt' | 'twitter';
  argv: string[];
  displayArgv: string[];
}

export interface SocialItem {
  platform: 'reddit' | 'twitter';
  sourceBlockId: string;
  id: string;
  url: string | null;
  author: string | null;
  community: string | null;
  title: string | null;
  body: string | null;
  text: string;
  createdAt: string;
  engagement: {
    score?: number | null;
    comments?: number | null;
    replies?: number | null;
    likes?: number | null;
    retweets?: number | null;
    bookmarks?: number | null;
    views?: number | null;
  };
  media: Array<{ type: string; url: string }>;
  links: string[];
  raw: Record<string, unknown>;
}

export interface FlowDefinition {
  id: string;
  name: string;
  failFast?: boolean;
  nodes: FlowNodeModel[];
  edges: FlowEdgeModel[];
}

export interface FlowSchedule {
  enabled: boolean;
  intervalMs?: number;
  paused?: boolean;
  nextRunAt?: string | null;
}

export interface PersistedFlow extends FlowDefinition {
  schemaVersion: 1;
  nodePositions: Record<string, { x: number; y: number }>;
  blockSettings: Record<string, Record<string, unknown>>;
  schedule: FlowSchedule;
  createdAt: string;
  updatedAt: string;
}

export type StepStatus = 'success' | 'failed' | 'skipped';

export interface RunStep {
  blockId: string;
  status: StepStatus;
  argv?: string[];
  exitCode?: number | null;
  stdoutSummary?: string;
  stderr?: string;
  startedAt: string;
  endedAt: string;
  error?: string | null;
}

export interface OutputFile {
  path: string;
  bytes: number;
}

/**
 * A flattened, redacted projection of a normalized SocialItem, carried on a run
 * so the console Output Preview can show real rows. Deliberately omits raw/media/
 * links so untrusted payloads never enter persisted run records. Absent fields are
 * null, mirroring the SocialItem contract.
 */
export interface RunSampleRow {
  kind: 'reddit' | 'twitter';
  id: string;
  title: string | null;
  author: string | null;
  score: number | null;
  created: string | null;
  url: string | null;
}

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  flowId: string;
  status: 'success' | 'failed' | 'skipped' | 'running';
  startedAt: string;
  endedAt: string | null;
  steps: RunStep[];
  outputFiles: OutputFile[];
  error: string | null;
  /** Capped, redacted sample of the items the flow produced (optional for back-compat). */
  sample?: RunSampleRow[];
}

