/**
 * The high-level "what + how" a block does to the data stream — the single
 * source for the Inspector's behavior panel and the generated block reference
 * doc, so the two surfaces can never disagree (the same heart-of-system pattern
 * as {@link ./fieldSchema}). Every structural fact here is DERIVED from the
 * block spec's ports/provider/executable; the only authored input is the spec's
 * optional `note`.
 */
import { getBlockSpec } from './commandBuilders';
import { inputBoundFieldKeys } from './inputBindings';
import type { BlockSpec, PortSpec } from './types';

/**
 * What a node does to the stream, in five mutually exclusive buckets:
 *  - `source`     — creates items (no input, emits SocialItem[]).
 *  - `enrich`     — CLI fetch of per-item detail (SocialItem[] in and out).
 *  - `transform`  — local reshape of the stream (SocialItem[] in and out).
 *  - `export`     — writes a file artifact, ending the branch.
 *  - `annotation` — carries no data (e.g. a canvas note).
 */
export type StreamEffect = 'source' | 'enrich' | 'transform' | 'export' | 'annotation';

export interface BehaviorSummary {
  effect: StreamEffect;
  /** Uppercase badge text, e.g. `ENRICH`. */
  label: string;
  /** Input port data type, or `—` when the block consumes nothing concrete. */
  inLabel: string;
  /** Output port data type, or `—` when the block emits nothing concrete. */
  outLabel: string;
  /** True when this block can run once per upstream item (CLI node with input). */
  fanOut: boolean;
  /** The block's one-line purpose (pass-through of the spec description). */
  description: string;
  /** Authored caveat, present only on blocks with a real gotcha. */
  note?: string;
}

/** Derive a block's stream effect from its port contract and provider. */
export function streamEffect(blockType: string): StreamEffect {
  return effectForSpec(getBlockSpec(blockType));
}

function effectForSpec(spec: BlockSpec): StreamEffect {
  const { input, output } = spec.ports;
  if (output.some((port) => port.type === 'FileArtifact')) {
    return 'export';
  }
  if (!output.some((port) => port.type === 'SocialItem[]')) {
    return 'annotation';
  }
  if (input.length === 0) {
    return 'source';
  }
  return spec.executable ? 'enrich' : 'transform';
}

/** Uppercase badge label for an effect. */
export function streamEffectLabel(effect: StreamEffect): string {
  return effect.toUpperCase();
}

/**
 * Whether the block fans out by default — one CLI call per distinct upstream
 * item when its bound field is left blank. True only for CLI-backed blocks that
 * take a `SocialItem[]` input **and** have a default input binding (Read Post,
 * Tweet Detail, User Profile). Manual-map-only blocks like `twitter.article`
 * have no default binding, so by default they read a single record — they are
 * deliberately excluded so the badge never advertises a fan-out the engine does
 * not perform (see {@link inputBoundFieldKeys} and the design's derivation rule).
 */
export function fanOutCapable(blockType: string): boolean {
  return fanOutForSpec(getBlockSpec(blockType));
}

function fanOutForSpec(spec: BlockSpec): boolean {
  return (
    Boolean(spec.executable) &&
    spec.ports.input.some((port) => port.type === 'SocialItem[]') &&
    inputBoundFieldKeys(spec.type).length > 0
  );
}

/** The full behavior summary both surfaces render. */
export function behaviorSummary(blockType: string): BehaviorSummary {
  const spec = getBlockSpec(blockType);
  const effect = effectForSpec(spec);
  return {
    effect,
    label: streamEffectLabel(effect),
    inLabel: portLabel(spec.ports.input),
    outLabel: portLabel(spec.ports.output),
    fanOut: fanOutForSpec(spec),
    description: spec.description,
    note: spec.note
  };
}

/**
 * Human label for a set of ports: the unique concrete data types joined, or `—`
 * when there are none. `Any` is treated as no concrete type (a canvas-only port),
 * so an annotation block reads `—` rather than `Any`.
 */
function portLabel(ports: PortSpec[]): string {
  const types = [...new Set(ports.map((port) => port.type))].filter((type) => type !== 'Any');
  return types.length === 0 ? '—' : types.join(' + ');
}
