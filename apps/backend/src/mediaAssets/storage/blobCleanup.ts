import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { setTimeout as wait } from "node:timers/promises";
import { addBackendRuntimeBreadcrumb } from "../../observability/runtime";
import { buildMediaBlobStorageKey } from "../storageKeys";
import type {
  DeletePermanentMediaBlobInput,
  MediaAssetStorageDependencies,
} from "./contracts";
import { getS3ErrorStatusCode } from "./errors";

const maximumAttemptCount = 3;
const retryBaseDelayMs = 50;

export type PermanentMediaBlobDeleteOutcome = "deleted" | "not_found";
type CleanupStorageOperation = "head_object" | "delete_object";

type S3ErrorFields = Readonly<{
  $retryable?: unknown;
  code?: unknown;
  name?: unknown;
}>;

export class MediaBlobCleanupStorageTransientError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_STORAGE_TRANSIENT";

  constructor(
    readonly operation: CleanupStorageOperation,
    readonly statusCode: number | null,
    cause: unknown,
  ) {
    super(
      `Permanent media-blob cleanup exhausted transient S3 retries. operation=${operation}; statusCode=${String(statusCode)}`,
      { cause },
    );
    this.name = "MediaBlobCleanupStorageTransientError";
  }
}

export class MediaBlobCleanupStorageTerminalError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_STORAGE_REJECTED";

  constructor(
    readonly operation: CleanupStorageOperation,
    readonly statusCode: number | null,
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(
      `Permanent media-blob cleanup S3 request was rejected. operation=${operation}; storageKey=${storageKey}; statusCode=${String(statusCode)}`,
      { cause },
    );
    this.name = "MediaBlobCleanupStorageTerminalError";
  }
}

export class MediaBlobCleanupStorageConditionalConflictError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_CONDITIONAL_CONFLICT";
  readonly operation = "delete_object";

  constructor(
    readonly statusCode: number,
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(
      `Permanent media-blob cleanup conditional delete conflicted with the observed object. storageKey=${storageKey}; statusCode=${String(statusCode)}`,
      { cause },
    );
    this.name = "MediaBlobCleanupStorageConditionalConflictError";
  }
}

export class MediaBlobCleanupStorageAmbiguousDeleteError extends Error {
  readonly code = "MEDIA_BLOB_CLEANUP_DELETE_AMBIGUOUS";
  readonly operation = "delete_object";

  constructor(
    readonly statusCode: number | null,
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(
      `Permanent media-blob cleanup conditional delete has an unknown commit outcome and requires reconciliation. storageKey=${storageKey}; statusCode=${String(statusCode)}`,
      { cause },
    );
    this.name = "MediaBlobCleanupStorageAmbiguousDeleteError";
  }
}

function readS3ErrorFields(error: unknown): S3ErrorFields | null {
  return typeof error === "object" && error !== null
    ? error as S3ErrorFields
    : null;
}

function getS3ErrorCode(error: unknown): string | null {
  const fields = readS3ErrorFields(error);
  if (typeof fields?.name === "string") return fields.name;
  return typeof fields?.code === "string" ? fields.code : null;
}

function isS3TransportError(error: unknown): boolean {
  const fields = readS3ErrorFields(error);
  return fields?.name === "TimeoutError"
    || (
      typeof fields?.code === "string"
      && [
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ENOTFOUND",
        "EAI_AGAIN",
      ].includes(fields.code)
    );
}

function isRecognizedS3Error(error: unknown): boolean {
  return error instanceof S3ServiceException || isS3TransportError(error);
}

function isMissingObjectError(error: unknown): boolean {
  return error instanceof S3ServiceException
    && (
      getS3ErrorStatusCode(error) === 404
      || error.name === "NoSuchKey"
    );
}

function isTransientS3Error(error: unknown): boolean {
  if (!isRecognizedS3Error(error)) return false;
  const statusCode = getS3ErrorStatusCode(error);
  const fields = readS3ErrorFields(error);
  return fields?.$retryable !== undefined
    || isS3TransportError(error)
    || (
      statusCode !== null
      && ([408, 409, 425, 429].includes(statusCode) || statusCode >= 500)
    );
}

function isConditionalDeleteConflict(error: unknown): boolean {
  const statusCode = getS3ErrorStatusCode(error);
  const errorCode = getS3ErrorCode(error);
  return statusCode === 409
    || statusCode === 412
    || errorCode === "ConditionalRequestConflict"
    || errorCode === "PreconditionFailed";
}

function isDefinitiveDeleteRejection(error: unknown): boolean {
  const statusCode = getS3ErrorStatusCode(error);
  return error instanceof S3ServiceException
    && statusCode !== null
    && statusCode >= 400
    && statusCode < 500
    && ![408, 409, 412, 425, 429].includes(statusCode);
}

function assertExactETag(
  etag: string | undefined,
  storageKey: string,
): string {
  if (etag === undefined || !/^"[^"\r\n]+"$/u.test(etag)) {
    throw new MediaBlobCleanupStorageTerminalError(
      "head_object",
      null,
      storageKey,
      new TypeError(
        "S3 HEAD did not return a valid exact ETag for conditional cleanup deletion.",
      ),
    );
  }
  return etag;
}

function assertCleanupInput(input: DeletePermanentMediaBlobInput): void {
  if (input.storageKey !== buildMediaBlobStorageKey(input.sha256)) {
    throw new TypeError(
      "Permanent media-blob cleanup requires the exact content-addressed storage key.",
    );
  }
  if (
    !Number.isSafeInteger(input.cleanupGeneration)
    || input.cleanupGeneration < 1
  ) {
    throw new RangeError("cleanupGeneration must be a positive safe integer.");
  }
}

function readBucketName(dependencies: MediaAssetStorageDependencies): string {
  const { bucketName } = dependencies.getMediaAssetsStorageConfigFn();
  if (
    typeof bucketName !== "string"
    || bucketName.trim() === ""
    || bucketName.trim() !== bucketName
  ) {
    throw new Error(
      "Media asset storage bucket name must be a non-empty trimmed string.",
    );
  }
  return bucketName;
}

function addRetryBreadcrumb(
  input: DeletePermanentMediaBlobInput,
  operation: CleanupStorageOperation,
  attempt: number,
  error: unknown,
): void {
  addBackendRuntimeBreadcrumb({
    action: "media_blob_cleanup_retry",
    scope: input.observationScope,
    details: {
      phase: operation,
      attempt,
      maxAttempts: maximumAttemptCount,
      sha256: input.sha256,
      cleanupGeneration: input.cleanupGeneration,
      statusCode: getS3ErrorStatusCode(error),
      errorCode: getS3ErrorCode(error),
      errorClass: error instanceof Error ? error.name : "UnknownError",
    },
  });
}

async function waitBeforeRetry(
  input: DeletePermanentMediaBlobInput,
  attempt: number,
): Promise<void> {
  await wait(
    retryBaseDelayMs * (2 ** (attempt - 1)),
    undefined,
    { signal: input.signal },
  );
}

async function loadObjectETag(
  input: DeletePermanentMediaBlobInput,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<string | null> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maximumAttemptCount; attempt += 1) {
    input.signal.throwIfAborted();
    await input.renewLease("head_object");
    input.signal.throwIfAborted();
    try {
      const response = await dependencies.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: input.storageKey,
        }),
        { abortSignal: input.signal },
      );
      return assertExactETag(response.ETag, input.storageKey);
    } catch (error) {
      input.signal.throwIfAborted();
      if (isMissingObjectError(error)) return null;
      if (error instanceof MediaBlobCleanupStorageTerminalError) throw error;
      if (!isRecognizedS3Error(error)) throw error;
      if (!isTransientS3Error(error)) {
        throw new MediaBlobCleanupStorageTerminalError(
          "head_object",
          getS3ErrorStatusCode(error),
          input.storageKey,
          error,
        );
      }
      lastError = error;
      if (attempt === maximumAttemptCount) break;
      addRetryBreadcrumb(input, "head_object", attempt, error);
      await waitBeforeRetry(input, attempt);
    }
  }
  throw new MediaBlobCleanupStorageTransientError(
    "head_object",
    getS3ErrorStatusCode(lastError),
    lastError,
  );
}

async function deleteExistingObject(
  input: DeletePermanentMediaBlobInput,
  bucketName: string,
  etag: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<PermanentMediaBlobDeleteOutcome> {
  input.signal.throwIfAborted();
  await input.renewLease("delete_object");
  input.signal.throwIfAborted();
  try {
    await dependencies.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: input.storageKey,
        IfMatch: etag,
      }),
      { abortSignal: input.signal },
    );
    return "deleted";
  } catch (error) {
    if (isMissingObjectError(error)) return "not_found";
    if (isConditionalDeleteConflict(error)) {
      throw new MediaBlobCleanupStorageConditionalConflictError(
        getS3ErrorStatusCode(error) ?? 412,
        input.storageKey,
        error,
      );
    }
    if (isDefinitiveDeleteRejection(error)) {
      throw new MediaBlobCleanupStorageTerminalError(
        "delete_object",
        getS3ErrorStatusCode(error),
        input.storageKey,
        error,
      );
    }
    throw new MediaBlobCleanupStorageAmbiguousDeleteError(
      getS3ErrorStatusCode(error),
      input.storageKey,
      error,
    );
  }
}

export async function deletePermanentMediaBlobWithDependencies(
  input: DeletePermanentMediaBlobInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<PermanentMediaBlobDeleteOutcome> {
  assertCleanupInput(input);
  const bucketName = readBucketName(dependencies);
  const etag = await loadObjectETag(input, bucketName, dependencies);
  if (etag === null) {
    return "not_found";
  }
  return deleteExistingObject(input, bucketName, etag, dependencies);
}
