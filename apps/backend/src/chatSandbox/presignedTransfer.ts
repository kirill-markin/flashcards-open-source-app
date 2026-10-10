import { setTimeout as sleep } from "node:timers/promises";

type TransferOperation = "download" | "upload";

const maximumTransferAttempts = 3;
const transferRetryDelaysMs: ReadonlyArray<number> = [250, 1_000];
const transferAttemptTimeoutMs = 60_000;

/**
 * Names the virtual path and never the URL: the message reaches the model, and a pre-signed URL is a
 * credential.
 */
export class PresignedTransferError extends Error {
  public constructor(operation: TransferOperation, path: string, detail: string) {
    super(`Could not ${operation} ${path}: ${detail}`);
    this.name = "PresignedTransferError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The system or undici code of a failed `fetch`, such as `ECONNREFUSED`, which it carries as its cause. */
export function readNetworkErrorCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;
}

/** Network errors carry the host in their message, so only the error name and its cause code are kept. */
export function describeNetworkError(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = readNetworkErrorCode(error);
  return code === null ? `errorName=${name}` : `errorName=${name} errorCode=${code}`;
}

async function sendWithRetries(
  operation: TransferOperation,
  path: string,
  send: (signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    let failure: string;
    try {
      const response = await send(AbortSignal.timeout(transferAttemptTimeoutMs));
      if (response.ok) {
        return response;
      }

      await response.body?.cancel();
      failure = `status=${response.status}`;
      if (!isRetryableStatus(response.status)) {
        throw new PresignedTransferError(operation, path, failure);
      }
    } catch (error) {
      if (error instanceof PresignedTransferError) {
        throw error;
      }

      failure = describeNetworkError(error);
    }

    const retryDelayMs = transferRetryDelaysMs[attempt - 1];
    if (attempt >= maximumTransferAttempts || retryDelayMs === undefined) {
      throw new PresignedTransferError(operation, path, `${failure} attempts=${attempt}`);
    }

    console.warn({ action: "chat_sandbox_transfer_retried", operation, path, attempt, failure, retryDelayMs });
    await sleep(retryDelayMs);
  }
}

export async function downloadPresignedObject(url: string, path: string, sizeBytes: number): Promise<Uint8Array> {
  const response = await sendWithRetries("download", path, (signal) => fetch(url, { signal }));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== sizeBytes) {
    throw new PresignedTransferError("download", path, `expected ${sizeBytes} bytes, received ${bytes.byteLength}`);
  }

  return bytes;
}

export async function uploadPresignedObject(url: string, path: string, bytes: Uint8Array): Promise<void> {
  const response = await sendWithRetries("upload", path, (signal) => fetch(url, { method: "PUT", body: bytes, signal }));
  await response.body?.cancel();
}
