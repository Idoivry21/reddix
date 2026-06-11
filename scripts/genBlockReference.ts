/**
 * Writes the generated block reference doc. Thin wrapper around the pure
 * {@link ../src/shared/blockReference} renderer; the drift-guard test
 * (`tests/blockReference.test.ts`) keeps the committed file in sync. Run with
 * `npm run docs:blocks`.
 */
import { writeFileSync } from 'node:fs';
import { renderBlockReference } from '../src/shared/blockReference';

const target = new URL('../docs/block-reference.md', import.meta.url);
writeFileSync(target, renderBlockReference());
process.stdout.write(`Wrote ${target.pathname}\n`);
