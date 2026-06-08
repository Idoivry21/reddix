/**
 * The single source of truth for a block's *data fields* — what a node emits
 * downstream (its output schema) and what fields are therefore available to the
 * nodes wired after it. Every data-passing block emits the one fixed
 * {@link SocialItem} shape, so the schema is known at design time (before any
 * run) and is just a provider-filtered projection of that shape. The Inspector,
 * the canvas node card, the binding picker, and `validateFlow` all read from
 * here so they can never disagree about which fields exist.
 */
import { getBlockSpec } from './commandBuilders';
import type { SocialItem } from './types';
import { isBlank } from './values';

export type FieldPlatform = 'reddit' | 'twitter' | 'both';

export interface FieldDescriptor {
  /** Resolution key: a top-level SocialItem key or a dotted `engagement.*` key. */
  key: string;
  label: string;
  type: 'string' | 'number' | 'datetime' | 'string[]' | 'object[]' | 'artifact';
  /** Which provider's items carry this field. 'both' = shared by reddit + twitter. */
  platform: FieldPlatform;
}

/**
 * The canonical projection of {@link SocialItem} into descriptors. Every other
 * field list (the binding source picker, the node-card chips, the Inspector
 * panels) derives from this so they cannot drift from the actual shape.
 */
export const SOCIAL_ITEM_FIELDS: readonly FieldDescriptor[] = [
  { key: 'id', label: 'ID', type: 'string', platform: 'both' },
  { key: 'url', label: 'URL', type: 'string', platform: 'both' },
  { key: 'author', label: 'Author', type: 'string', platform: 'both' },
  { key: 'community', label: 'Community', type: 'string', platform: 'reddit' },
  { key: 'title', label: 'Title', type: 'string', platform: 'reddit' },
  { key: 'body', label: 'Body', type: 'string', platform: 'reddit' },
  { key: 'text', label: 'Text', type: 'string', platform: 'both' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', platform: 'both' },
  { key: 'engagement.score', label: 'Score', type: 'number', platform: 'reddit' },
  { key: 'engagement.comments', label: 'Comments', type: 'number', platform: 'reddit' },
  { key: 'engagement.replies', label: 'Replies', type: 'number', platform: 'twitter' },
  { key: 'engagement.likes', label: 'Likes', type: 'number', platform: 'twitter' },
  { key: 'engagement.retweets', label: 'Retweets', type: 'number', platform: 'twitter' },
  { key: 'engagement.bookmarks', label: 'Bookmarks', type: 'number', platform: 'twitter' },
  { key: 'engagement.views', label: 'Views', type: 'number', platform: 'twitter' },
  { key: 'media', label: 'Media', type: 'object[]', platform: 'both' },
  { key: 'links', label: 'Links', type: 'string[]', platform: 'both' }
];

const ARTIFACT_FIELDS: readonly FieldDescriptor[] = [
  { key: 'path', label: 'File Path', type: 'artifact', platform: 'both' },
  { key: 'bytes', label: 'Bytes', type: 'number', platform: 'both' }
];

function socialFieldsFor(provider: 'reddit' | 'twitter'): FieldDescriptor[] {
  return SOCIAL_ITEM_FIELDS.filter((field) => field.platform === 'both' || field.platform === provider);
}

/**
 * The static, design-time OUTPUT fields a block advertises to downstream nodes.
 * Driven by the block's port contract and provider:
 *  - a `FileArtifact` output (Output blocks) → the artifact descriptor;
 *  - no `SocialItem[]` output (e.g. `utility.note`'s `Any` port) → none;
 *  - a provider-typed source/enrichment → SocialItem filtered to that provider;
 *  - a `local` transform (pass-through) → the full union, since it forwards
 *    whatever it receives and cannot narrow by provider.
 */
export function outputFieldsForBlock(blockType: string): FieldDescriptor[] {
  const spec = getBlockSpec(blockType);
  const outputs = spec.ports.output;
  if (outputs.some((port) => port.type === 'FileArtifact')) {
    return [...ARTIFACT_FIELDS];
  }
  if (!outputs.some((port) => port.type === 'SocialItem[]')) {
    return [];
  }
  if (spec.provider === 'reddit') {
    return socialFieldsFor('reddit');
  }
  if (spec.provider === 'twitter') {
    return socialFieldsFor('twitter');
  }
  return [...SOCIAL_ITEM_FIELDS];
}

/**
 * Map a descriptor key to the bare name used in a run's `normalizedFields`
 * (engagement sub-keys are recorded without their `engagement.` prefix). Lets the
 * UI mark which static-schema fields actually carried a value in the last run.
 */
export function normalizedFieldName(key: string): string {
  return key.startsWith('engagement.') ? key.slice('engagement.'.length) : key;
}

/** Minimal node/edge shapes so both the frontend graph and `validateFlow` can call in. */
export interface FieldGraphNode {
  id: string;
  type: string;
}
export interface FieldGraphEdge {
  source: string;
  target: string;
}

/**
 * The union of all transitive upstream nodes' output fields — the fields
 * available as inputs to `nodeId`. Walks incoming edges (a transform is
 * pass-through, so its own output schema already carries the union), deduping by
 * key with first-seen order preserved. Cheap enough to call per render; cycles
 * are rejected upstream by `validateFlow`, but a visited-set guards anyway.
 */
export function availableInputFields(
  nodeId: string,
  nodes: FieldGraphNode[],
  edges: FieldGraphEdge[]
): FieldDescriptor[] {
  const typeById = new Map(nodes.map((node) => [node.id, node.type]));
  const sourcesByTarget = new Map<string, string[]>();
  for (const edge of edges) {
    const list = sourcesByTarget.get(edge.target);
    if (list) {
      list.push(edge.source);
    } else {
      sourcesByTarget.set(edge.target, [edge.source]);
    }
  }

  const byKey = new Map<string, FieldDescriptor>();
  const visited = new Set<string>();
  const stack = [...(sourcesByTarget.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const upstreamId = stack.pop() as string;
    if (visited.has(upstreamId)) {
      continue;
    }
    visited.add(upstreamId);
    const type = typeById.get(upstreamId);
    if (type) {
      for (const field of outputFieldsForBlock(type)) {
        if (!byKey.has(field.key)) {
          byKey.set(field.key, field);
        }
      }
    }
    stack.push(...(sourcesByTarget.get(upstreamId) ?? []));
  }
  return [...byKey.values()];
}

/**
 * Read any SocialItem field by its descriptor {@link FieldDescriptor.key},
 * including dotted `engagement.*` keys. Numbers are stringified; arrays/objects
 * (media/links) and unknown keys are not scalar-bindable and return null;
 * blank/null values return null. This is the generic accessor that replaces the
 * per-binding `select` closures used by the input-binding resolver.
 */
export function getSocialItemField(item: SocialItem, key: string): string | null {
  if (key.startsWith('engagement.')) {
    const sub = key.slice('engagement.'.length) as keyof SocialItem['engagement'];
    const value = item.engagement[sub];
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  }
  switch (key) {
    case 'id':
      return blankToNull(item.id);
    case 'url':
      return blankToNull(item.url);
    case 'author':
      return blankToNull(item.author);
    case 'community':
      return blankToNull(item.community);
    case 'title':
      return blankToNull(item.title);
    case 'body':
      return blankToNull(item.body);
    case 'text':
      return blankToNull(item.text);
    case 'createdAt':
      return blankToNull(item.createdAt);
    default:
      return null;
  }
}

function blankToNull(value: string | null): string | null {
  return value !== null && !isBlank(value) ? value.trim() : null;
}
