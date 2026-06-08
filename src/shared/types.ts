import type { FlowEdgeModel, FlowNodeModel } from './graph';

export type ProviderId = 'reddit' | 'twitter' | 'local';

export type BlockCategory = 'Sources' | 'Enrichment' | 'Transform' | 'Output' | 'Utility';

export type BlockPriority = 'P0' | 'P1';

export type PortType = 'SocialItem[]' | 'FileArtifact' | 'Any';

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
  maxLength?: number;
  pattern?: RegExp;
  format?: 'twitter-id-or-url';
  extensions?: string[];
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
  /** Present on CLI-backed blocks only; names the binary and doubles as the
   * "is this a CLI block" discriminant. Distinct from the built {@link BuiltCommand}. */
  executable?: 'rdt' | 'twitter';
  /** Optional one-line caveat surfaced by the behavior panel and block reference
   * doc. Authored only where a block has a real gotcha (fan-out, compact data,
   * auth requirement, dropped fields); structural facts are derived, never here. */
  note?: string;
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

/** Which input a single-node run feeds the node: its own static settings, or the
 *  cached output sample of its upstream nodes from the last full run. */
export type SingleNodeMode = 'static' | 'cached-upstream';

/**
 * A redacted, capped projection of a normalized SocialItem carried on a RunStep so
 * (a) the per-node I/O preview can render real rows and (b) a cached-upstream
 * single-node run can reconstruct items to feed a downstream enrichment block.
 * Strict superset of the fields the binding selectors and transforms read
 * (id/url/author/platform/community/createdAt/engagement); like {@link RunSampleRow}
 * it omits raw/media/links and caps long text so untrusted CLI payloads never bloat
 * or poison persisted records. Absent fields are null, mirroring the SocialItem contract.
 */
export interface RunStepSampleItem {
  platform: 'reddit' | 'twitter';
  sourceBlockId: string;
  id: string;
  url: string | null;
  author: string | null;
  community: string | null;
  title: string | null;
  text: string;
  createdAt: string;
  engagement: SocialItem['engagement'];
}

/**
 * Per-node I/O summary attached to a RunStep so the UI can show input/output/
 * skipped counts and a field list without re-deriving them from the stdout summary.
 * Absent on steps the engine did not instrument (back-compat).
 */
export interface RunStepIo {
  /** Items the step received from upstream (after merge across incoming edges). */
  inputCount: number;
  /** Items the step produced. */
  outputCount: number;
  /** Items intentionally dropped: fan-out incompatibility skips + fan-out cap truncation. */
  skippedCount: number;
  /** Normalized field NAMES present across produced items (derived, never invented). */
  normalizedFields: string[];
  /** Capped, redacted sample of items this step produced. */
  sampleItems: RunStepSampleItem[];
}

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
  /** Optional per-node I/O summary (added with the I/O-preview feature). */
  io?: RunStepIo;
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
  platform: 'reddit' | 'twitter';
  id: string;
  title: string | null;
  author: string | null;
  score: number | null;
  created: string | null;
  url: string | null;
}

/**
 * Provenance for the run `sample` so the Output Preview can caption it honestly:
 * which block produced the previewed rows, whether they were written to a file,
 * and the true item count before the {@link RunSampleRow} cap. Absent when the
 * flow produced no data.
 */
export interface RunSampleMeta {
  /** Label of the block that produced the previewed rows (e.g. "Tweet Detail"). */
  sourceLabel: string;
  /** True only when an Export block wrote the rows to a file. */
  saved: boolean;
  /** Item count before the sample-row cap, so the caption can say "15 items". */
  totalItems: number;
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
  /** Provenance for {@link sample} (optional for back-compat). */
  sampleMeta?: RunSampleMeta;
  /** Present on isolated single-node runs so the console can label them; such runs
   *  are NOT persisted to run history (ephemeral). Absent on full-flow runs. */
  trigger?: { kind: 'single-node'; nodeId: string; mode: SingleNodeMode };
}
