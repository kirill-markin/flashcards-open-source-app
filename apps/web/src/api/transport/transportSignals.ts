export function readAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim() !== "") {
    return new Error(reason);
  }
  return new DOMException("Request was aborted", "AbortError");
}

export function waitForTransportDelay(
  delayMs: number,
  signal: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timerId: number | null = null;
    const abortHandler = (): void => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      signal?.removeEventListener("abort", abortHandler);
      reject(signal === null ? new DOMException("Request was aborted", "AbortError") : readAbortError(signal));
    };
    if (signal?.aborted === true) {
      abortHandler();
      return;
    }

    timerId = window.setTimeout((): void => {
      signal?.removeEventListener("abort", abortHandler);
      timerId = null;
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
}
