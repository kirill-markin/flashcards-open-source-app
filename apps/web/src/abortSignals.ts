export type CombinedAbortSignal = Readonly<{
  signal: AbortSignal;
  dispose: () => void;
}>;

export function combineAbortSignals(signals: ReadonlyArray<AbortSignal>): CombinedAbortSignal {
  const controller = new AbortController();
  const listeners: Array<readonly [AbortSignal, () => void]> = [];
  const dispose = (): void => {
    for (const [signal, handleAbort] of listeners) {
      signal.removeEventListener("abort", handleAbort);
    }
    listeners.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return { signal: controller.signal, dispose };
    }
  }

  for (const signal of signals) {
    const handleAbort = (): void => {
      if (controller.signal.aborted) {
        return;
      }

      controller.abort(signal.reason);
      dispose();
    };
    listeners.push([signal, handleAbort]);
    signal.addEventListener("abort", handleAbort, { once: true });
  }

  return { signal: controller.signal, dispose };
}
