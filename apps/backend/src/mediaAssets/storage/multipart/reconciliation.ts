import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3ServiceException,
  type CompletedPart,
  type ListPartsCommandOutput,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { addBackendRuntimeBreadcrumb } from "../../../observability/runtime";
import { HttpError } from "../../../shared/errors";
import type { MediaAssetObjectMetadata } from "../../types";
import type {
  AssertMediaAssetObjectInput,
  MediaAssetStorageDependencies,
  MediaAssetStorageOperation,
  ReconcileMultipartMediaAssetUploadInput,
} from "../contracts";
import {
  createMultipartCompletionReconciliationS3Diagnostics,
  getS3ErrorStatusCode,
  isCopyObjectIfNoneMatchFailure,
  isNoSuchMultipartUploadError,
  mediaAssetStorageMaximumAttemptCount,
  MultipartCompletionReconciliationStorageTerminalError,
  MultipartCompletionReconciliationStorageTransientError,
} from "../errors";
import {
  assertMediaAssetObjectContentMatches,
  assertMediaAssetObjectMetadataMatches,
  assertMediaAssetObjectShapeAndProofMatches,
  createUploadProofMetadata,
  toBase64Sha256Digest,
  toHexSha256Digest,
  uploadProofSha256Key,
  uploadProofLastOperationIdSha256Key,
  uploadProofMediaAssetIdKey,
  uploadProofWorkspaceIdKey,
} from "../proof";

const maximumMultipartPartCount = 10_000;
const listPartsPageSize = 1_000;
const sha256Pattern = /^[0-9a-f]{64}$/u;

type ListedMultipartPart = Readonly<{
  partNumber: number;
  eTag: string;
  sha256: string;
}>;

type MultipartReconciliationObjectMetadata =
  MediaAssetObjectMetadata
  & Readonly<{ customMetadata: Readonly<Record<string, string>> }>;

class S3OperationRejectedError extends Error {
  constructor(readonly s3Error: unknown) {
    super("Multipart reconciliation S3 operation was rejected.", {
      cause: s3Error,
    });
    this.name = "S3OperationRejectedError";
  }
}

type S3ErrorFields = Readonly<{
  $retryable?: unknown;
  code?: unknown;
  name?: unknown;
}>;

function readS3ErrorFields(error: unknown): S3ErrorFields | null {
  return typeof error === "object" && error !== null
    ? error as S3ErrorFields
    : null;
}

function isS3TransportError(error: unknown): boolean {
  const fields = readS3ErrorFields(error);
  return fields?.name === "TimeoutError"
    || (typeof fields?.code === "string"
      && [
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ENOTFOUND",
        "EAI_AGAIN",
      ].includes(fields.code));
}

function isRecognizedS3Error(error: unknown): boolean {
  return error instanceof S3ServiceException
    || isS3TransportError(error);
}

function isMissingS3ObjectError(error: unknown): boolean {
  return error instanceof S3ServiceException
    && (
      getS3ErrorStatusCode(error) === 404
      || error.name === "NoSuchKey"
    );
}

function createCopySource(bucketName: string, storageKey: string): string {
  return `${bucketName}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function isTransientS3Error(error: unknown): boolean {
  if (isRecognizedS3Error(error) === false) return false;
  const statusCode = getS3ErrorStatusCode(error);
  const fields = readS3ErrorFields(error);
  return fields?.$retryable !== undefined
    || isS3TransportError(error)
    || (statusCode !== null
      && ([408, 409, 425, 429].includes(statusCode) || statusCode >= 500));
}

function readBucketName(
  dependencies: MediaAssetStorageDependencies,
): string {
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

function createTerminalStorageError(
  code:
    | "MULTIPART_UPLOAD_NOT_FOUND"
    | "MULTIPART_PARTS_INVALID"
    | "MULTIPART_PARTS_FINGERPRINT_MISMATCH"
    | "MULTIPART_STAGING_OBJECT_MISMATCH"
    | "MULTIPART_BLOB_OBJECT_MISMATCH"
    | "S3_REQUEST_REJECTED",
  safeMessage: string,
): MultipartCompletionReconciliationStorageTerminalError {
  return new MultipartCompletionReconciliationStorageTerminalError(
    code,
    safeMessage,
    null,
    null,
  );
}

function createTerminalS3StorageError(
  input: ReconcileMultipartMediaAssetUploadInput,
  operation: MediaAssetStorageOperation,
  safeMessage: string,
  error: unknown,
): MultipartCompletionReconciliationStorageTerminalError {
  const diagnostics =
    createMultipartCompletionReconciliationS3Diagnostics(operation, error);
  addBackendRuntimeBreadcrumb({
    action: "media_asset_storage_terminal",
    scope: input.observationScope,
    details: {
      workspaceId: input.workspaceId,
      mediaAssetId: input.mediaAssetId,
      ...diagnostics,
    },
  });
  return new MultipartCompletionReconciliationStorageTerminalError(
    "S3_REQUEST_REJECTED",
    safeMessage,
    diagnostics,
    error,
  );
}

async function runS3Operation<Result>(
  input: ReconcileMultipartMediaAssetUploadInput,
  operation: MediaAssetStorageOperation,
  run: () => Promise<Result>,
): Promise<Result> {
  let lastError: unknown = null;
  for (
    let attempt = 1;
    attempt <= mediaAssetStorageMaximumAttemptCount;
    attempt += 1
  ) {
    input.signal.throwIfAborted();
    await input.renewLease();
    input.signal.throwIfAborted();
    try {
      return await run();
    } catch (error) {
      input.signal.throwIfAborted();
      if (isRecognizedS3Error(error) === false) throw error;
      lastError = error;
      if (isTransientS3Error(error) === false) {
        throw new S3OperationRejectedError(error);
      }
      if (attempt === mediaAssetStorageMaximumAttemptCount) break;
      addStorageRetryBreadcrumb(input, operation, attempt, error);
    }
  }

  throw new MultipartCompletionReconciliationStorageTransientError(
    operation,
    getS3ErrorStatusCode(lastError),
    lastError,
  );
}

function addStorageRetryBreadcrumb(
  input: ReconcileMultipartMediaAssetUploadInput,
  operation: MediaAssetStorageOperation,
  attempt: number,
  error: unknown,
): void {
  addBackendRuntimeBreadcrumb({
    action: "media_asset_storage_retry",
    scope: input.observationScope,
    details: {
      operation,
      attempt,
      maxAttempts: mediaAssetStorageMaximumAttemptCount,
      workspaceId: input.workspaceId,
      mediaAssetId: input.mediaAssetId,
      statusCode: getS3ErrorStatusCode(error),
      errorClass: error instanceof Error ? error.name : "UnknownError",
    },
  });
}

function toObjectMetadata(response: Readonly<{
  ContentLength?: number;
  ContentType?: string;
  ETag?: string;
  ChecksumSHA256?: string;
  ChecksumType?: "COMPOSITE" | "FULL_OBJECT";
  Metadata?: Readonly<Record<string, string>>;
}>): MultipartReconciliationObjectMetadata {
  return {
    sizeBytes: response.ContentLength ?? null,
    mimeType: response.ContentType ?? null,
    eTag: response.ETag ?? null,
    checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
    checksumType: response.ChecksumType ?? null,
    uploadProof: {
      workspaceId: response.Metadata?.[uploadProofWorkspaceIdKey] ?? null,
      mediaAssetId: response.Metadata?.[uploadProofMediaAssetIdKey] ?? null,
      lastOperationIdSha256:
        response.Metadata?.[uploadProofLastOperationIdSha256Key] ?? null,
      sha256: response.Metadata?.[uploadProofSha256Key] ?? null,
    },
    customMetadata: response.Metadata ?? {},
  };
}

async function headObject(
  input: ReconcileMultipartMediaAssetUploadInput,
  storageKey: string,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<MultipartReconciliationObjectMetadata | null> {
  const command = new HeadObjectCommand({
    Bucket: bucketName,
    Key: storageKey,
    ChecksumMode: "ENABLED",
  });
  try {
    const response = await runS3Operation(
      input,
      "head_object",
      async () => dependencies.s3Client.send(
        command,
        { abortSignal: input.signal },
      ),
    );
    return toObjectMetadata(response);
  } catch (error) {
    input.signal.throwIfAborted();
    if (
      error instanceof MultipartCompletionReconciliationStorageTransientError
    ) {
      throw error;
    }
    if (!(error instanceof S3OperationRejectedError)) throw error;
    if (isMissingS3ObjectError(error.s3Error)) return null;
    const statusCode = getS3ErrorStatusCode(error.s3Error);
    throw createTerminalS3StorageError(
      input,
      "head_object",
      `Object storage rejected multipart reconciliation HEAD. statusCode=${String(statusCode)}`,
      error.s3Error,
    );
  }
}

function createObjectInput(
  input: ReconcileMultipartMediaAssetUploadInput,
  storageKey: string,
): AssertMediaAssetObjectInput {
  return {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    lastOperationId: input.lastOperationId,
    observationScope: input.observationScope,
  };
}

function assertStagingShapeAndProof(
  input: ReconcileMultipartMediaAssetUploadInput,
  metadata: MediaAssetObjectMetadata,
): void {
  try {
    assertMediaAssetObjectShapeAndProofMatches(
      createObjectInput(input, input.stagingStorageKey),
      metadata,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw createTerminalStorageError(
        "MULTIPART_STAGING_OBJECT_MISMATCH",
        "Multipart staging object does not match its durable completion proof.",
      );
    }
    throw error;
  }
}

function assertStagingFullObject(
  input: ReconcileMultipartMediaAssetUploadInput,
  metadata: MediaAssetObjectMetadata,
): void {
  try {
    assertMediaAssetObjectMetadataMatches(
      createObjectInput(input, input.stagingStorageKey),
      metadata,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      throw createTerminalStorageError(
        "MULTIPART_STAGING_OBJECT_MISMATCH",
        "Multipart staging object does not match its durable full-object checksum.",
      );
    }
    throw error;
  }
}

function assertBlobFullObject(
  input: ReconcileMultipartMediaAssetUploadInput,
  metadata: MultipartReconciliationObjectMetadata,
): void {
  try {
    assertMediaAssetObjectContentMatches(
      createObjectInput(input, input.blobStorageKey),
      metadata,
    );
    if (
      Object.keys(metadata.customMetadata).length !== 1
      || metadata.customMetadata[uploadProofSha256Key] !== input.sha256
    ) {
      throw new HttpError(
        409,
        "Existing media blob contains invalid permanent-object metadata.",
        "MEDIA_ASSET_UPLOAD_MISMATCH",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw createTerminalStorageError(
        "MULTIPART_BLOB_OBJECT_MISMATCH",
        "Existing media blob does not match the durable multipart completion.",
      );
    }
    throw error;
  }
}

export function createMultipartCompletedPartsFingerprint(
  parts: ReadonlyArray<ListedMultipartPart>,
): string {
  const canonicalParts = [...parts]
    .sort((left, right) => left.partNumber - right.partNumber)
    .map((part) => [part.partNumber, part.eTag, part.sha256] as const);
  return createHash("sha256")
    .update(JSON.stringify(canonicalParts))
    .digest("hex");
}

function readListedPart(
  part: Readonly<{
    PartNumber?: number;
    ETag?: string;
    ChecksumSHA256?: string;
  }>,
): ListedMultipartPart {
  const partNumber = part.PartNumber;
  const eTag = part.ETag;
  const sha256 = toHexSha256Digest(part.ChecksumSHA256);
  if (
    typeof partNumber !== "number"
    || Number.isSafeInteger(partNumber) === false
    || partNumber < 1
    || partNumber > maximumMultipartPartCount
    || typeof eTag !== "string"
    || eTag.trim() === ""
    || eTag.length > 256
    || sha256 === null
    || sha256Pattern.test(sha256) === false
  ) {
    throw createTerminalStorageError(
      "MULTIPART_PARTS_INVALID",
      "S3 returned an invalid multipart part number, ETag, or SHA-256 checksum.",
    );
  }
  return { partNumber, eTag, sha256 };
}

async function listMultipartParts(
  input: ReconcileMultipartMediaAssetUploadInput,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<ReadonlyArray<ListedMultipartPart>> {
  const parts: Array<ListedMultipartPart> = [];
  let partNumberMarker: string | undefined;
  while (true) {
    let response: ListPartsCommandOutput;
    const command = new ListPartsCommand({
      Bucket: bucketName,
      Key: input.stagingStorageKey,
      UploadId: input.s3UploadId,
      MaxParts: listPartsPageSize,
      PartNumberMarker: partNumberMarker,
    });
    try {
      response = await runS3Operation(
        input,
        "list_multipart_upload_parts",
        async () => dependencies.s3Client.send(
          command,
          { abortSignal: input.signal },
        ),
      );
    } catch (error) {
      input.signal.throwIfAborted();
      if (
        error instanceof MultipartCompletionReconciliationStorageTransientError
      ) {
        throw error;
      }
      if (!(error instanceof S3OperationRejectedError)) throw error;
      if (isNoSuchMultipartUploadError(error.s3Error)) throw error.s3Error;
      throw createTerminalS3StorageError(
        input,
        "list_multipart_upload_parts",
        `Object storage rejected ListParts. statusCode=${String(getS3ErrorStatusCode(error.s3Error))}`,
        error.s3Error,
      );
    }

    for (const rawPart of response.Parts ?? []) {
      parts.push(readListedPart(rawPart));
      if (parts.length > maximumMultipartPartCount) {
        throw createTerminalStorageError(
          "MULTIPART_PARTS_INVALID",
          "Multipart upload exceeded the supported 10,000-part limit.",
        );
      }
    }

    if (response.IsTruncated !== true) break;
    const nextMarker = response.NextPartNumberMarker;
    if (
      typeof nextMarker !== "string"
      || nextMarker.trim() === ""
      || nextMarker === partNumberMarker
    ) {
      throw createTerminalStorageError(
        "MULTIPART_PARTS_INVALID",
        "S3 returned an invalid ListParts pagination marker.",
      );
    }
    partNumberMarker = nextMarker;
  }

  const orderedParts = [...parts].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
  if (
    orderedParts.length !== input.partCount
    || orderedParts.some((part, index) => part.partNumber !== index + 1)
  ) {
    throw createTerminalStorageError(
      "MULTIPART_PARTS_INVALID",
      "S3 multipart parts are incomplete, duplicated, or non-contiguous.",
    );
  }
  if (
    createMultipartCompletedPartsFingerprint(orderedParts)
    !== input.completedPartsFingerprint
  ) {
    throw createTerminalStorageError(
      "MULTIPART_PARTS_FINGERPRINT_MISMATCH",
      "S3 multipart parts do not match the immutable completion fingerprint.",
    );
  }
  return orderedParts;
}

function toCompletedParts(
  parts: ReadonlyArray<ListedMultipartPart>,
): Array<CompletedPart> {
  return parts.map((part) => ({
    PartNumber: part.partNumber,
    ETag: part.eTag,
    ChecksumSHA256: toBase64Sha256Digest(part.sha256),
  }));
}

async function completeMultipartUpload(
  input: ReconcileMultipartMediaAssetUploadInput,
  parts: ReadonlyArray<ListedMultipartPart>,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<MultipartReconciliationObjectMetadata> {
  let lastError: unknown = null;
  const completedParts = toCompletedParts(parts);
  for (
    let attempt = 1;
    attempt <= mediaAssetStorageMaximumAttemptCount;
    attempt += 1
  ) {
    input.signal.throwIfAborted();
    await input.renewLease();
    input.signal.throwIfAborted();
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucketName,
      Key: input.stagingStorageKey,
      UploadId: input.s3UploadId,
      MultipartUpload: { Parts: completedParts },
    });
    try {
      await dependencies.s3Client.send(
        command,
        { abortSignal: input.signal },
      );
    } catch (error) {
      input.signal.throwIfAborted();
      if (isRecognizedS3Error(error) === false) throw error;
      lastError = error;
      const observed = await headObject(
        input,
        input.stagingStorageKey,
        bucketName,
        dependencies,
      );
      if (observed !== null) return observed;
      if (isNoSuchMultipartUploadError(error)) {
        throw error;
      }
      if (isTransientS3Error(error) === false) {
        throw createTerminalS3StorageError(
          input,
          "complete_multipart_upload",
          `Object storage rejected CompleteMultipartUpload. statusCode=${String(getS3ErrorStatusCode(error))}`,
          error,
        );
      }
      if (attempt < mediaAssetStorageMaximumAttemptCount) {
        addStorageRetryBreadcrumb(
          input,
          "complete_multipart_upload",
          attempt,
          error,
        );
        continue;
      }
      throw new MultipartCompletionReconciliationStorageTransientError(
        "complete_multipart_upload",
        getS3ErrorStatusCode(error),
        error,
      );
    }

    const observed = await headObject(
      input,
      input.stagingStorageKey,
      bucketName,
      dependencies,
    );
    if (observed !== null) return observed;
    lastError = new Error(
      "CompleteMultipartUpload succeeded but the staging object is not visible.",
    );
  }

  throw new MultipartCompletionReconciliationStorageTransientError(
    "complete_multipart_upload",
    getS3ErrorStatusCode(lastError),
    lastError,
  );
}

async function normalizeStagingObject(
  input: ReconcileMultipartMediaAssetUploadInput,
  initialMetadata: MediaAssetObjectMetadata,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  let metadata = initialMetadata;
  for (
    let attempt = 1;
    attempt <= mediaAssetStorageMaximumAttemptCount;
    attempt += 1
  ) {
    if (metadata.checksumType === "FULL_OBJECT") {
      assertStagingFullObject(input, metadata);
      return;
    }
    assertStagingShapeAndProof(input, metadata);
    if (metadata.eTag === null) {
      throw createTerminalStorageError(
        "MULTIPART_STAGING_OBJECT_MISMATCH",
        "Multipart staging object is missing the ETag required for fenced normalization.",
      );
    }

    input.signal.throwIfAborted();
    await input.renewLease();
    input.signal.throwIfAborted();
    const command = new CopyObjectCommand({
      Bucket: bucketName,
      Key: input.stagingStorageKey,
      CopySource: createCopySource(
        bucketName,
        input.stagingStorageKey,
      ),
      CopySourceIfMatch: metadata.eTag,
      ContentType: input.mimeType,
      ChecksumAlgorithm: "SHA256",
      MetadataDirective: "REPLACE",
      Metadata: createUploadProofMetadata(input),
    });
    try {
      await dependencies.s3Client.send(
        command,
        { abortSignal: input.signal },
      );
    } catch (error) {
      input.signal.throwIfAborted();
      if (isRecognizedS3Error(error) === false) throw error;
      if (
        isCopyObjectIfNoneMatchFailure(error) === false
        && isTransientS3Error(error) === false
      ) {
        throw createTerminalS3StorageError(
          input,
          "copy_object",
          `Object storage rejected staging normalization. statusCode=${String(getS3ErrorStatusCode(error))}`,
          error,
        );
      }
      if (
        isTransientS3Error(error)
        && attempt < mediaAssetStorageMaximumAttemptCount
      ) {
        addStorageRetryBreadcrumb(input, "copy_object", attempt, error);
      }
    }

    const observed = await headObject(
      input,
      input.stagingStorageKey,
      bucketName,
      dependencies,
    );
    if (observed === null) {
      throw createTerminalStorageError(
        "MULTIPART_STAGING_OBJECT_MISMATCH",
        "Multipart staging object disappeared during normalization.",
      );
    }
    metadata = observed;
  }

  throw new MultipartCompletionReconciliationStorageTransientError(
    "copy_object",
    null,
    new Error("Multipart staging normalization did not converge."),
  );
}

async function promoteStagingObject(
  input: ReconcileMultipartMediaAssetUploadInput,
  bucketName: string,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  let existing = await headObject(
    input,
    input.blobStorageKey,
    bucketName,
    dependencies,
  );
  if (existing !== null) {
    assertBlobFullObject(input, existing);
    return;
  }

  for (
    let attempt = 1;
    attempt <= mediaAssetStorageMaximumAttemptCount;
    attempt += 1
  ) {
    input.signal.throwIfAborted();
    await input.renewLease();
    input.signal.throwIfAborted();
    const command = new CopyObjectCommand({
      Bucket: bucketName,
      Key: input.blobStorageKey,
      CopySource: createCopySource(
        bucketName,
        input.stagingStorageKey,
      ),
      ContentType: input.mimeType,
      ChecksumAlgorithm: "SHA256",
      IfNoneMatch: "*",
      MetadataDirective: "REPLACE",
      Metadata: {
        [uploadProofSha256Key]: input.sha256,
      },
    });
    try {
      await dependencies.s3Client.send(
        command,
        { abortSignal: input.signal },
      );
    } catch (error) {
      input.signal.throwIfAborted();
      if (isRecognizedS3Error(error) === false) throw error;
      if (
        isCopyObjectIfNoneMatchFailure(error) === false
        && isTransientS3Error(error) === false
      ) {
        throw createTerminalS3StorageError(
          input,
          "copy_object",
          `Object storage rejected blob promotion. statusCode=${String(getS3ErrorStatusCode(error))}`,
          error,
        );
      }
      if (
        isTransientS3Error(error)
        && attempt < mediaAssetStorageMaximumAttemptCount
      ) {
        addStorageRetryBreadcrumb(input, "copy_object", attempt, error);
      }
    }

    existing = await headObject(
      input,
      input.blobStorageKey,
      bucketName,
      dependencies,
    );
    if (existing !== null) {
      assertBlobFullObject(input, existing);
      return;
    }
  }

  throw new MultipartCompletionReconciliationStorageTransientError(
    "copy_object",
    null,
    new Error("Multipart blob promotion did not converge."),
  );
}

export async function reconcileMultipartMediaAssetUploadWithDependencies(
  input: ReconcileMultipartMediaAssetUploadInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  input.signal.throwIfAborted();
  if (
    input.partCount < 1
    || input.partCount > maximumMultipartPartCount
    || Number.isSafeInteger(input.partCount) === false
    || sha256Pattern.test(input.completedPartsFingerprint) === false
  ) {
    throw createTerminalStorageError(
      "MULTIPART_PARTS_INVALID",
      `Durable multipart completion payload is invalid for workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
    );
  }

  const bucketName = readBucketName(dependencies);
  const existingBlob = await headObject(
    input,
    input.blobStorageKey,
    bucketName,
    dependencies,
  );
  if (existingBlob !== null) {
    assertBlobFullObject(input, existingBlob);
    return;
  }

  let staging = await headObject(
    input,
    input.stagingStorageKey,
    bucketName,
    dependencies,
  );
  if (staging === null) {
    try {
      const parts = await listMultipartParts(
        input,
        bucketName,
        dependencies,
      );
      staging = await completeMultipartUpload(
        input,
        parts,
        bucketName,
        dependencies,
      );
    } catch (error) {
      input.signal.throwIfAborted();
      if (isNoSuchMultipartUploadError(error) === false) throw error;

      const completedBlob = await headObject(
        input,
        input.blobStorageKey,
        bucketName,
        dependencies,
      );
      if (completedBlob !== null) {
        assertBlobFullObject(input, completedBlob);
        return;
      }

      staging = await headObject(
        input,
        input.stagingStorageKey,
        bucketName,
        dependencies,
      );
      if (staging === null) {
        throw createTerminalStorageError(
          "MULTIPART_UPLOAD_NOT_FOUND",
          "Multipart upload no longer exists and no completed object was found.",
        );
      }
    }
  }

  await normalizeStagingObject(
    input,
    staging,
    bucketName,
    dependencies,
  );
  await promoteStagingObject(input, bucketName, dependencies);
}
