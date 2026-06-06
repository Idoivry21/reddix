import { describe, expect, it } from 'vitest';
import { createCappedBuffer } from '../server/cappedBuffer';

describe('createCappedBuffer', () => {
  it('accumulates chunks while under the cap', () => {
    const buffer = createCappedBuffer(100);
    buffer.append('hello ');
    buffer.append('world');
    expect(buffer.value).toBe('hello world');
    expect(buffer.truncated).toBe(false);
    expect(buffer.byteLength).toBe(11);
  });

  it('stops appending and flags truncation once the cap is exceeded', () => {
    const buffer = createCappedBuffer(8);
    buffer.append('abcd');
    buffer.append('efghIJKL'); // only "efgh" fits
    expect(buffer.truncated).toBe(true);
    expect(buffer.byteLength).toBeLessThanOrEqual(8);
    expect(buffer.value.startsWith('abcdefgh')).toBe(true);
  });

  it('ignores further chunks after truncation', () => {
    const buffer = createCappedBuffer(4);
    buffer.append('abcdef');
    const afterFirst = buffer.value;
    buffer.append('ghi');
    expect(buffer.value).toBe(afterFirst);
    expect(buffer.truncated).toBe(true);
  });

  it('counts multi-byte characters by byte length', () => {
    const buffer = createCappedBuffer(3);
    buffer.append('€'); // 3 bytes
    expect(buffer.truncated).toBe(false);
    buffer.append('a');
    expect(buffer.truncated).toBe(true);
  });
});
