export interface ObjectHeaders {
  size: number;
  contentType: string;
  cacheControl: string;
  sha256: string;
}

export interface ObjectStore {
  prefixExists(prefix: string): Promise<boolean>;
  putIfAbsent(key: string, body: Uint8Array, headers: ObjectHeaders): Promise<void>;
  head(key: string): Promise<ObjectHeaders>;
  get(key: string, maxBytes?: number): Promise<Uint8Array>;
}

/** Bounded workers drain in-flight work before reporting failure; no writes escape the caller. */
export async function parallelMap<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error("Invalid parallelism");
  const results = new Array<R>(values.length);
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failed && cursor < values.length) {
        const index = cursor++;
        try {
          results[index] = await operation(values[index], index);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    }),
  );
  if (failed) throw failure;
  return results;
}
