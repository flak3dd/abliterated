/**
 * Stop awaiting `promise` the moment `signal` aborts.
 *
 * Bridge RPCs (tool execution, workspace prefetch) carry no AbortSignal, so a
 * slow call would otherwise pin the agent loop until it returns. The abandoned
 * promise keeps running to completion; its settlement is swallowed so a late
 * rejection cannot surface as an unhandled rejection.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, fallback: () => T): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.resolve(fallback());
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      void promise.catch(() => {});
      resolve(fallback());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        reject(err);
      },
    );
  });
}
