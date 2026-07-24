import {
  SessionAdvisoryLockAbortedError, SessionAdvisoryLockTimeoutError, withSessionAdvisoryLock,
} from "../../database";

const generatedCardImageOperationLockTimeoutMs = 120_000;
const generatedCardImageOperationLockPollIntervalMs = 50;
const generatedCardImageOperationLockName = "generated-card-image-operation";

export type GeneratedCardImageOperationLockInput = Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  signal: AbortSignal;
}>;

export class GeneratedCardImageOperationLockAbortedError extends Error {
  constructor(cause: unknown) {
    super("Generated card image operation lock acquisition was aborted.", { cause });
    this.name = "GeneratedCardImageOperationLockAbortedError";
  }
}

export class GeneratedCardImageOperationLockTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, cause: unknown) {
    super(`Generated card image operation lock timed out after ${timeoutMs}ms.`, { cause });
    this.name = "GeneratedCardImageOperationLockTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export async function withGeneratedCardImageOperationLock<Result>(
  input: GeneratedCardImageOperationLockInput,
  callback: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  try {
    return await withSessionAdvisoryLock(
      {
        lockName: generatedCardImageOperationLockName,
        lockKey: `chat.generated_card_image:${input.workspaceId.toLowerCase()}:${input.mediaAssetId.toLowerCase()}`,
        timeoutMs: generatedCardImageOperationLockTimeoutMs,
        pollIntervalMs: generatedCardImageOperationLockPollIntervalMs,
        signal: input.signal,
      },
      callback,
    );
  } catch (error) {
    if (error instanceof SessionAdvisoryLockAbortedError) {
      throw new GeneratedCardImageOperationLockAbortedError(error);
    }
    if (error instanceof SessionAdvisoryLockTimeoutError) {
      throw new GeneratedCardImageOperationLockTimeoutError(error.timeoutMs, error);
    }
    throw error;
  }
}
