/**
 * A string buffer with a hard byte cap. Once the cap is reached it stops
 * accumulating and flags `truncated`, so an unbounded CLI cannot grow process
 * memory without limit. Bytes are counted as UTF-8.
 */
export interface CappedBuffer {
  append: (chunk: string) => void;
  readonly value: string;
  readonly truncated: boolean;
  readonly byteLength: number;
}

export function createCappedBuffer(maxBytes: number): CappedBuffer {
  const parts: string[] = [];
  let bytes = 0;
  let truncated = false;

  return {
    append(chunk: string): void {
      if (truncated) {
        return;
      }
      const chunkBytes = Buffer.byteLength(chunk, 'utf8');
      const remaining = maxBytes - bytes;
      if (chunkBytes <= remaining) {
        parts.push(chunk);
        bytes += chunkBytes;
        return;
      }
      if (remaining > 0) {
        const slice = Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
        parts.push(slice);
        bytes += Buffer.byteLength(slice, 'utf8');
      }
      truncated = true;
    },
    get value() {
      return parts.join('');
    },
    get truncated() {
      return truncated;
    },
    get byteLength() {
      return bytes;
    }
  };
}
