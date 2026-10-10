import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { setTimeout as wait } from "node:timers/promises";
import { withTransientDatabaseRetry } from "../database/transient";
import { unsafeQueryWithDeadline } from "../database/unsafe";
import { getMediaAssetsStorageConfig, getMediaBlobCleanupS3Client } from "../mediaAssets/storage/config";
import { writeCloudWatchRecord } from "../observability/cloudWatch";
import type { BackendObservationScope } from "../observability/sentry";

/** DeleteObjects takes at most 1,000 keys, so one batch is one request. */
const maximumTombstonesPerBatch = 500;
const maximumDeleteAttemptCount = 3;
const deleteRetryBaseDelayMs = 200;

const LIST_OLDEST_CHAT_FILE_DELETIONS_SQL = `
  SELECT s3_key
  FROM ai.chat_file_deletions
  ORDER BY deleted_at ASC, s3_key ASC
  LIMIT $1
`;

const DELETE_CHAT_FILE_DELETIONS_SQL = `
  DELETE FROM ai.chat_file_deletions
  WHERE s3_key = ANY($1::text[])
`;

type ChatFileDeletionRow = Readonly<{ s3_key: string }>;

export type ChatFileObjectDeleteFailure = Readonly<{
  s3Key: string;
  errorCode: string;
}>;

export type ChatFileCleanupBatchInput = Readonly<{
  deadlineAtMs: number;
  observationScope: BackendObservationScope;
  signal: AbortSignal;
}>;

export type ChatFileCleanupBatchResult = Readonly<{
  tombstones: number;
  deleted: number;
  failures: ReadonlyArray<ChatFileObjectDeleteFailure>;
}>;

type ChatFileObjectsDeleteOutcome = Readonly<{
  deletedS3Keys: ReadonlyArray<string>;
  failures: ReadonlyArray<ChatFileObjectDeleteFailure>;
  lastRequestError: unknown;
}>;

/** Carries the batch counts and failed keys; the failed keys keep their tombstones for the next batch. */
export class ChatFileCleanupBatchError extends Error {
  public readonly result: ChatFileCleanupBatchResult;

  public constructor(result: ChatFileCleanupBatchResult, cause: unknown) {
    const errorCodes = [...new Set(result.failures.map((failure) => failure.errorCode))].join(",");
    super(
      `Chat file cleanup could not delete ${result.failures.length} of ${result.tombstones} objects after `
        + `${maximumDeleteAttemptCount} attempts. errorCodes=${errorCodes}`,
      { cause },
    );
    this.name = "ChatFileCleanupBatchError";
    this.result = result;
  }
}

async function listOldestChatFileDeletions(input: ChatFileCleanupBatchInput): Promise<ReadonlyArray<string>> {
  const result = await withTransientDatabaseRetry(
    () => unsafeQueryWithDeadline<ChatFileDeletionRow>(
      input.deadlineAtMs,
      LIST_OLDEST_CHAT_FILE_DELETIONS_SQL,
      [maximumTombstonesPerBatch],
    ),
    () => input.observationScope,
  );
  return result.rows.map((row) => row.s3_key);
}

async function deleteChatFileDeletions(
  input: ChatFileCleanupBatchInput,
  s3Keys: ReadonlyArray<string>,
): Promise<void> {
  await withTransientDatabaseRetry(
    () => unsafeQueryWithDeadline(input.deadlineAtMs, DELETE_CHAT_FILE_DELETIONS_SQL, [s3Keys]),
    () => input.observationScope,
  );
}

/** A key S3 reports as already missing counts as deleted: the object is gone, which is all a tombstone asks. */
async function sendDeleteObjects(
  bucketName: string,
  s3Keys: ReadonlyArray<string>,
  signal: AbortSignal,
): Promise<ReadonlyArray<ChatFileObjectDeleteFailure>> {
  const response = await getMediaBlobCleanupS3Client().send(
    new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: s3Keys.map((s3Key) => ({ Key: s3Key })), Quiet: true },
    }),
    { abortSignal: signal },
  );
  return (response.Errors ?? [])
    .filter((error) => error.Code !== "NoSuchKey")
    .map((error) => {
      if (error.Key === undefined) {
        throw new Error(`S3 DeleteObjects reported an error without a key. code=${error.Code} message=${error.Message}`);
      }

      return { s3Key: error.Key, errorCode: error.Code ?? "MissingErrorCode" };
    });
}

/** Each retry resends only the keys that failed; the client itself makes one attempt per request. */
async function deleteChatFileObjects(
  input: ChatFileCleanupBatchInput,
  s3Keys: ReadonlyArray<string>,
): Promise<ChatFileObjectsDeleteOutcome> {
  const bucketName = getMediaAssetsStorageConfig().bucketName;
  let pendingS3Keys = s3Keys;
  let failures: ReadonlyArray<ChatFileObjectDeleteFailure> = [];
  let lastRequestError: unknown = null;
  for (let attempt = 1; attempt <= maximumDeleteAttemptCount; attempt += 1) {
    input.signal.throwIfAborted();
    try {
      failures = await sendDeleteObjects(bucketName, pendingS3Keys, input.signal);
      lastRequestError = null;
    } catch (error) {
      input.signal.throwIfAborted();
      const errorCode = error instanceof Error ? error.name : "UnknownError";
      failures = pendingS3Keys.map((s3Key) => ({ s3Key, errorCode }));
      lastRequestError = error;
    }

    if (failures.length === 0 || attempt === maximumDeleteAttemptCount) {
      break;
    }

    writeCloudWatchRecord({
      action: "chat_file_cleanup_retry",
      message: "Deleting chat file objects failed for some keys; retrying them.",
      scope: input.observationScope,
      details: { attempt, maxAttempts: maximumDeleteAttemptCount, failures },
    }, "warning");
    pendingS3Keys = failures.map((failure) => failure.s3Key);
    await wait(deleteRetryBaseDelayMs * (2 ** (attempt - 1)), undefined, { signal: input.signal });
  }

  const failedS3Keys = new Set(failures.map((failure) => failure.s3Key));
  return {
    deletedS3Keys: s3Keys.filter((s3Key) => !failedS3Keys.has(s3Key)),
    failures,
    lastRequestError,
  };
}

/**
 * Deletes the objects of the oldest released chat files (`ai.chat_file_deletions`, recorded by triggers
 * on `ai.chat_files`) and then their tombstones. Every step is idempotent, so a batch cut short or run
 * twice at once only repeats deletes. Throws `ChatFileCleanupBatchError` when any object stays undeleted.
 */
export async function runChatFileCleanupBatch(input: ChatFileCleanupBatchInput): Promise<ChatFileCleanupBatchResult> {
  const s3Keys = await listOldestChatFileDeletions(input);
  if (s3Keys.length === 0) {
    return { tombstones: 0, deleted: 0, failures: [] };
  }

  const outcome = await deleteChatFileObjects(input, s3Keys);
  if (outcome.deletedS3Keys.length > 0) {
    await deleteChatFileDeletions(input, outcome.deletedS3Keys);
  }

  const result: ChatFileCleanupBatchResult = {
    tombstones: s3Keys.length,
    deleted: outcome.deletedS3Keys.length,
    failures: outcome.failures,
  };
  if (result.failures.length > 0) {
    throw new ChatFileCleanupBatchError(result, outcome.lastRequestError);
  }

  return result;
}
