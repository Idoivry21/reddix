import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBlockReference } from '../src/shared/blockReference';

describe('renderBlockReference', () => {
  const doc = renderBlockReference();

  it('has a title and grouped effect sections', () => {
    expect(doc).toContain('# Block Reference');
    expect(doc).toContain('## Sources');
    expect(doc).toContain('## Enrichment');
    expect(doc).toContain('## Transforms');
    expect(doc).toContain('## Exports');
  });

  it('describes an enrichment block with effect, fan-out, and its note', () => {
    expect(doc).toContain('### Read Post · `reddit.readPost`');
    expect(doc).toContain('ENRICH');
    expect(doc).toContain('Fan-out');
    expect(doc).toContain('Comments are not exported');
  });

  it('labels a source and an export by their port types', () => {
    expect(doc).toContain('### Search Reddit · `reddit.searchPosts`');
    expect(doc).toContain('SOURCE');
    expect(doc).toContain('FileArtifact');
  });
});

describe('block reference drift guard', () => {
  it('matches the committed docs/block-reference.md', () => {
    const onDisk = readFileSync(resolve(process.cwd(), 'docs/block-reference.md'), 'utf8');
    expect(onDisk).toBe(renderBlockReference());
  });
});
