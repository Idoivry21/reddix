import { afterEach, describe, expect, it, vi } from 'vitest';
import { postRun, WriteConfirmationRequiredError } from '../src/api';

afterEach(() => vi.restoreAllMocks());

const mockFetch = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    status,
    json: async () => body
  } as Response);

describe('postRun', () => {
  it('sends confirmWrites in the body', async () => {
    const fetchSpy = mockFetch(200, { run: { id: 'r1' } });
    await postRun('f1', true);
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      flowId: 'f1',
      confirmWrites: true
    });
  });

  it('throws WriteConfirmationRequiredError on a 409 with the write list', async () => {
    mockFetch(409, { code: 'WRITE_CONFIRMATION_REQUIRED', writes: [{ blockId: 'p', label: 'Post Tweet' }] });
    await expect(postRun('f1')).rejects.toBeInstanceOf(WriteConfirmationRequiredError);
  });
});
