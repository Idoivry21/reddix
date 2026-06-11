import { getBlockSpec } from './commandBuilders';
import { blankBoundFieldKeys } from './inputBindings';
import type { FlowDefinition } from './types';

/** Single discriminant for "is this block a write action". Safe on unknown types. */
export function isWriteBlockType(blockType: string): boolean {
  try {
    return getBlockSpec(blockType).writeAction === true;
  } catch {
    return false;
  }
}

/** One row in the per-run confirmation dialog. */
export interface WriteSummary {
  blockId: string;
  blockType: string;
  label: string;
  destructive: boolean;
  /** The literal target/content if the user typed one; null when it resolves from upstream. */
  target: string | null;
  /** True when a bound target field is blank and will be filled per upstream item at run time. */
  fromUpstream: boolean;
}

/**
 * The first non-empty literal field value that best identifies what a write touches:
 * prefer free-text content, else the target id/handle/subreddit.
 */
function literalTarget(settings: Record<string, unknown>): string | null {
  const keys = ['text', 'tweetId', 'postId', 'handle', 'subreddit'];
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
}

/** Summaries for every write node in a flow, computed from the definition alone
 *  (no execution) so the route can return them before running. */
export function summarizeFlowWrites(flow: FlowDefinition): WriteSummary[] {
  const summaries: WriteSummary[] = [];
  for (const node of flow.nodes) {
    if (!isWriteBlockType(node.type)) {
      continue;
    }
    const spec = getBlockSpec(node.type);
    const settings = node.settings;
    summaries.push({
      blockId: node.id,
      blockType: node.type,
      label: spec.label,
      destructive: spec.destructive === true,
      target: literalTarget(settings),
      fromUpstream: blankBoundFieldKeys(node.type, settings).length > 0
    });
  }
  return summaries;
}
