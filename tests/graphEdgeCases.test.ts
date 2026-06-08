import { describe, expect, it } from 'vitest';
import { canConnect, validateFlow } from '../src/shared/graph';
import { validateBlockSettings } from '../src/shared/commandBuilders';

/**
 * Edge-case coverage for graph.ts beyond the happy-path matrix in graph.test.ts:
 * the 'Any' port, port-not-found, dangling edges, empty/duplicate-edge flows,
 * self-edge cycles, mixed multi-output reachability, and the path-traversal guard
 * reached through validateBlockSettings (validatePathField is not exported).
 */

const ENFORCE = { enforceRequired: true, rejectFlagLikeStrings: true } as const;
const NULL_BYTE = String.fromCharCode(0);

describe('canConnect edge cases', () => {
  it('treats an "Any" output port (utility.note) as compatible with any input', () => {
    expect(
      canConnect({
        sourceBlockType: 'utility.note',
        sourcePortId: 'any',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: true });
  });

  it('returns "Port not found" when a port id does not exist on the block', () => {
    expect(
      canConnect({
        sourceBlockType: 'reddit.searchPosts',
        sourcePortId: 'does-not-exist',
        targetBlockType: 'transform.filterText',
        targetPortId: 'items'
      })
    ).toEqual({ valid: false, reason: 'Port not found' });
  });
});

describe('validateFlow structural edge cases', () => {
  it('passes an empty flow (no nodes, no edges) vacuously', () => {
    expect(validateFlow({ nodes: [], edges: [] })).toEqual({ valid: true, errors: [] });
  });

  it('reports an edge that references a missing node', () => {
    const result = validateFlow({
      nodes: [{ id: 'filter', type: 'transform.filterText', settings: {} }],
      edges: [
        { id: 'e1', source: 'ghost', target: 'filter', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([{ nodeId: 'e1', message: 'Edge references a missing node' }])
    );
  });

  it('detects a single-node self-edge as a cycle', () => {
    const result = validateFlow({
      nodes: [{ id: 'n1', type: 'transform.filterText', settings: {} }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1', sourcePortId: 'items', targetPortId: 'items' }]
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([{ nodeId: 'flow', message: 'Graph contains a cycle' }])
    );
  });

  it('flags only the unreachable output when multiple outputs have mixed reachability', () => {
    const result = validateFlow({
      nodes: [
        { id: 'src', type: 'reddit.searchPosts', settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 } },
        { id: 'reachable', type: 'output.exportJson', settings: { path: 'outputs/a.json', pretty: true } },
        { id: 'orphan', type: 'output.exportJson', settings: { path: 'outputs/b.json', pretty: true } }
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'reachable', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({ nodeId: 'orphan', message: 'Output block is not reachable from a source' });
    expect(result.errors).not.toContainEqual({ nodeId: 'reachable', message: 'Output block is not reachable from a source' });
  });

  it('currently accepts duplicate identical edges (documents lack of dedup)', () => {
    const result = validateFlow({
      nodes: [
        { id: 'src', type: 'reddit.searchPosts', settings: { query: 'cli', subreddit: 'localdev', sort: 'relevance', timeRange: 'month', limit: 10 } },
        { id: 'filter', type: 'transform.filterText', settings: {} }
      ],
      edges: [
        { id: 'e1', source: 'src', target: 'filter', sourcePortId: 'items', targetPortId: 'items' },
        { id: 'e2', source: 'src', target: 'filter', sourcePortId: 'items', targetPortId: 'items' }
      ]
    });
    // No explicit duplicate-edge rejection exists today; both edges validate.
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe('validatePathField (via validateBlockSettings on output.exportJson)', () => {
  it('rejects parent-directory traversal', () => {
    expect(validateBlockSettings('output.exportJson', { path: '../../etc/passwd.json' }, ENFORCE)).toEqual([
      'Path cannot contain ".."'
    ]);
  });

  it('rejects an absolute POSIX path', () => {
    expect(validateBlockSettings('output.exportJson', { path: '/etc/passwd.json' }, ENFORCE)).toEqual([
      'Path must be a relative POSIX path'
    ]);
  });

  it('rejects a Windows-style backslash path', () => {
    expect(validateBlockSettings('output.exportJson', { path: 'outputs\\evil.json' }, ENFORCE)).toEqual([
      'Path must be a relative POSIX path'
    ]);
  });

  it('rejects an embedded null byte', () => {
    expect(
      validateBlockSettings('output.exportJson', { path: `outputs/bad${NULL_BYTE}.json` }, ENFORCE)
    ).toEqual(['Path is invalid']);
  });

  it('accepts a safe relative path with the correct extension', () => {
    expect(validateBlockSettings('output.exportJson', { path: 'outputs/ok.json' }, ENFORCE)).toEqual([]);
  });
});
