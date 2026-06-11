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
        // Slicing on a byte boundary inside a multi-byte codepoint yields a
        // U+FFFD replacement char (3 bytes) that can exceed `remaining`, so only
        // keep the partial slice when it still fits the cap.
        const slice = Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
        const sliceBytes = Buffer.byteLength(slice, 'utf8');
        if (bytes + sliceBytes <= maxBytes) {
          parts.push(slice);
          bytes += sliceBytes;
        }
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
