import OpenAI from "openai";

// Receipt-bearing calls replace the pinned SDK's two retries so every send can reauthorize.
export function getReceiptProviderRetryDelayMs(error: unknown, attempt: number): number | null {
  if (attempt >= 3 || !(error instanceof OpenAI.APIError) || error instanceof OpenAI.APIUserAbortError) {
    return null;
  }
  if (!(error instanceof OpenAI.APIConnectionError)) {
    const shouldRetry = error.headers?.get("x-should-retry");
    if (shouldRetry === "false") return null;
    if (shouldRetry !== "true"
      && error.status !== 408 && error.status !== 409 && error.status !== 429
      && !(error.status !== undefined && error.status >= 500)) {
      return null;
    }
  }

  let delayMs: number | undefined;
  const retryAfterMs = error.headers?.get("retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsed)) delayMs = parsed;
  }
  const retryAfter = error.headers?.get("retry-after");
  if (retryAfter && delayMs === undefined) {
    const parsed = Number.parseFloat(retryAfter);
    delayMs = Number.isNaN(parsed) ? Date.parse(retryAfter) - Date.now() : parsed * 1_000;
  }
  if (delayMs !== undefined && Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 60_000) {
    return delayMs;
  }
  return Math.min(500 * (2 ** (attempt - 1)), 8_000) * (1 - Math.random() * 0.25);
}

export async function waitForReceiptProviderRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw new OpenAI.APIUserAbortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = (): void => {
      clearTimeout(timer);
      reject(new OpenAI.APIUserAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
