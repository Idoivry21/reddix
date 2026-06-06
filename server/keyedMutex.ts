/**
 * Serializes async tasks per key. Tasks sharing a key run one-at-a-time in
 * submission order; tasks with different keys run concurrently. Used to make
 * read-modify-write file updates (e.g. appendRun) safe under concurrent calls.
 */
export interface KeyedMutex {
  run: <T>(key: string, task: () => Promise<T>) => Promise<T>;
}

export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      // Chain regardless of the previous task's outcome so one failure does
      // not wedge the queue for that key.
      const result = previous.then(task, task);
      const settled = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, settled);
      void settled.then(() => {
        if (tails.get(key) === settled) {
          tails.delete(key);
        }
      });
      return result;
    }
  };
}
