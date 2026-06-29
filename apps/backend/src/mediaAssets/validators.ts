import { HttpError } from "../shared/errors";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
} from "../server/requestParsing";
import type {
  CompleteMediaAssetUploadInput,
  CompleteMediaAssetUploadSessionInput,
  MediaAssetUploadIntentInput,
  MediaAssetUploadSessionCreateInput,
  MediaAssetUploadSessionPartUrlsInput,
} from "./types";

const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const maximumSourceUrlLength = 2_048;
const maximumLastOperationIdLength = 1_024;
const maximumETagLength = 256;
export const maximumSinglePutUploadBytes = 5_368_709_120;
export const minimumMultipartPartSizeBytes = 5_242_880;
export const maximumMultipartPartSizeBytes = 5_368_709_120;
export const maximumMultipartUploadPartCount = 10_000;
export const maximumMultipartUploadBytes = maximumSinglePutUploadBytes;
export const maximumMultipartPartUrlBatchCount = 100;

export function parseMediaAssetIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "mediaAssetId is required", "MEDIA_ASSET_ID_REQUIRED");
  }

  try {
    return expectUuidString(value, "mediaAssetId");
  } catch {
    throw new HttpError(400, "mediaAssetId must be a UUID", "MEDIA_ASSET_ID_INVALID");
  }
}

export function parseMediaAssetUploadSessionIdParam(value: string | undefined): string {
  if (value === undefined) {
    throw new HttpError(400, "sessionId is required", "MEDIA_ASSET_UPLOAD_SESSION_ID_REQUIRED");
  }

  try {
    return expectUuidString(value, "sessionId");
  } catch {
    throw new HttpError(400, "sessionId must be a UUID", "MEDIA_ASSET_UPLOAD_SESSION_ID_INVALID");
  }
}

function expectMimeType(value: unknown, fieldName: string): string {
  const mimeType = expectNonEmptyString(value, fieldName).toLowerCase();
  if (mimeTypePattern.test(mimeType) === false) {
    throw new HttpError(400, `${fieldName} must be a valid MIME type`);
  }

  return mimeType;
}

function expectSha256(value: unknown, fieldName: string): string {
  const sha256 = expectNonEmptyString(value, fieldName).toLowerCase();
  if (sha256Pattern.test(sha256) === false) {
    throw new HttpError(400, `${fieldName} must be a lowercase or uppercase hex SHA-256 digest`);
  }

  return sha256;
}

function expectDirectUploadSizeBytes(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number"
    || Number.isSafeInteger(value) === false
    || value < 0
  ) {
    throw new HttpError(400, `${fieldName} must be a non-negative safe integer`);
  }

  if (value > maximumSinglePutUploadBytes) {
    throw new HttpError(
      400,
      `${fieldName} must be at most ${maximumSinglePutUploadBytes} bytes for direct media uploads`,
      "MEDIA_ASSET_SIZE_TOO_LARGE",
    );
  }

  return value;
}

function expectMultipartUploadSizeBytes(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number"
    || Number.isSafeInteger(value) === false
    || value < 1
  ) {
    throw new HttpError(400, `${fieldName} must be a positive safe integer`);
  }

  if (value > maximumMultipartUploadBytes) {
    throw new HttpError(
      400,
      `${fieldName} must be at most ${maximumMultipartUploadBytes} bytes for multipart media uploads`,
      "MEDIA_ASSET_SIZE_TOO_LARGE",
    );
  }

  return value;
}

function expectPartSizeBytes(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number"
    || Number.isSafeInteger(value) === false
    || value < 1
  ) {
    throw new HttpError(400, `${fieldName} must be a positive safe integer`);
  }

  if (value > maximumMultipartPartSizeBytes) {
    throw new HttpError(
      400,
      `${fieldName} must be at most ${maximumMultipartPartSizeBytes} bytes`,
      "MEDIA_ASSET_PART_SIZE_TOO_LARGE",
    );
  }

  return value;
}

function expectPartCount(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number"
    || Number.isSafeInteger(value) === false
    || value < 1
    || value > maximumMultipartUploadPartCount
  ) {
    throw new HttpError(
      400,
      `${fieldName} must be an integer from 1 to ${maximumMultipartUploadPartCount}`,
      "MEDIA_ASSET_PART_COUNT_INVALID",
    );
  }

  return value;
}

function assertMultipartShape(input: Readonly<{
  sizeBytes: number;
  partSizeBytes: number;
  partCount: number;
}>): void {
  if (input.partCount > 1 && input.partSizeBytes < minimumMultipartPartSizeBytes) {
    throw new HttpError(
      400,
      `partSizeBytes must be at least ${minimumMultipartPartSizeBytes} bytes when partCount is greater than 1`,
      "MEDIA_ASSET_PART_SIZE_TOO_SMALL",
    );
  }

  const expectedPartCount = Math.ceil(input.sizeBytes / input.partSizeBytes);
  if (input.partCount !== expectedPartCount) {
    throw new HttpError(
      400,
      `partCount must equal ceil(sizeBytes / partSizeBytes); expected ${expectedPartCount}`,
      "MEDIA_ASSET_PART_COUNT_MISMATCH",
    );
  }
}

function expectIsoTimestamp(value: unknown, fieldName: string): string {
  const rawTimestamp = expectNonEmptyString(value, fieldName);
  const parsedTimestamp = new Date(rawTimestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO timestamp`);
  }

  return parsedTimestamp.toISOString();
}

export function expectMediaAssetSourceUrl(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const sourceUrl = expectNonEmptyString(value, fieldName);
  if (sourceUrl.length > maximumSourceUrlLength) {
    throw new HttpError(400, `${fieldName} must be at most ${maximumSourceUrlLength} characters`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new HttpError(400, `${fieldName} must be an absolute HTTP or HTTPS URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new HttpError(400, `${fieldName} must be an absolute HTTP or HTTPS URL`);
  }

  return parsedUrl.toString();
}

function expectLastOperationId(value: unknown, fieldName: string): string {
  const lastOperationId = expectNonEmptyString(value, fieldName);
  if (lastOperationId.length > maximumLastOperationIdLength) {
    throw new HttpError(400, `${fieldName} must be at most ${maximumLastOperationIdLength} characters`);
  }

  return lastOperationId;
}

function expectPartNumber(value: unknown, fieldName: string): number {
  if (
    typeof value !== "number"
    || Number.isSafeInteger(value) === false
    || value < 1
    || value > maximumMultipartUploadPartCount
  ) {
    throw new HttpError(
      400,
      `${fieldName} must be an integer from 1 to ${maximumMultipartUploadPartCount}`,
      "MEDIA_ASSET_PART_NUMBER_INVALID",
    );
  }

  return value;
}

function expectETag(value: unknown, fieldName: string): string {
  const eTag = expectNonEmptyString(value, fieldName);
  if (eTag.length > maximumETagLength) {
    throw new HttpError(400, `${fieldName} must be at most ${maximumETagLength} characters`);
  }

  return eTag;
}

function expectRecordArray(value: unknown, fieldName: string): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (Array.isArray(value) === false) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }

  return value.map((entry, index) => {
    try {
      return expectRecord(entry);
    } catch {
      throw new HttpError(400, `${fieldName}[${index}] must be an object`);
    }
  });
}

function assertUniquePartNumbers(parts: ReadonlyArray<Readonly<{ partNumber: number }>>, fieldName: string): void {
  const partNumbers = new Set<number>();
  for (const part of parts) {
    if (partNumbers.has(part.partNumber)) {
      throw new HttpError(
        400,
        `${fieldName} must not contain duplicate partNumber values`,
        "MEDIA_ASSET_DUPLICATE_PART_NUMBER",
      );
    }

    partNumbers.add(part.partNumber);
  }
}

export function parseMediaAssetUploadSessionCreateInput(value: unknown): MediaAssetUploadSessionCreateInput {
  const record = expectRecord(value);
  const input = {
    mediaAssetId: expectUuidString(record.mediaAssetId, "mediaAssetId"),
    mimeType: expectMimeType(record.mimeType, "mimeType"),
    sizeBytes: expectMultipartUploadSizeBytes(record.sizeBytes, "sizeBytes"),
    sha256: expectSha256(record.sha256, "sha256"),
    partSizeBytes: expectPartSizeBytes(record.partSizeBytes, "partSizeBytes"),
    partCount: expectPartCount(record.partCount, "partCount"),
    sourceUrl: expectMediaAssetSourceUrl(record.sourceUrl, "sourceUrl"),
    createdAt: expectIsoTimestamp(record.createdAt, "createdAt"),
    clientUpdatedAt: expectIsoTimestamp(record.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: expectUuidString(record.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    lastOperationId: expectLastOperationId(record.lastOperationId, "lastOperationId"),
  };

  assertMultipartShape(input);
  return input;
}

export function parseMediaAssetUploadIntentInput(value: unknown): MediaAssetUploadIntentInput {
  const record = expectRecord(value);
  return {
    mediaAssetId: expectUuidString(record.mediaAssetId, "mediaAssetId"),
    mimeType: expectMimeType(record.mimeType, "mimeType"),
    sizeBytes: expectDirectUploadSizeBytes(record.sizeBytes, "sizeBytes"),
    sha256: expectSha256(record.sha256, "sha256"),
    lastOperationId: expectLastOperationId(record.lastOperationId, "lastOperationId"),
  };
}

export function parseCompleteMediaAssetUploadInput(
  mediaAssetId: string,
  value: unknown,
): CompleteMediaAssetUploadInput {
  const record = expectRecord(value);
  return {
    mediaAssetId,
    mimeType: expectMimeType(record.mimeType, "mimeType"),
    sizeBytes: expectDirectUploadSizeBytes(record.sizeBytes, "sizeBytes"),
    sha256: expectSha256(record.sha256, "sha256"),
    sourceUrl: expectMediaAssetSourceUrl(record.sourceUrl, "sourceUrl"),
    createdAt: expectIsoTimestamp(record.createdAt, "createdAt"),
    clientUpdatedAt: expectIsoTimestamp(record.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: expectUuidString(record.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    lastOperationId: expectLastOperationId(record.lastOperationId, "lastOperationId"),
  };
}

export function parseMediaAssetUploadSessionPartUrlsInput(
  value: unknown,
): MediaAssetUploadSessionPartUrlsInput {
  const record = expectRecord(value);
  const partRecords = expectRecordArray(record.parts, "parts");
  if (partRecords.length === 0) {
    throw new HttpError(400, "parts must contain at least one part", "MEDIA_ASSET_PARTS_REQUIRED");
  }
  if (partRecords.length > maximumMultipartPartUrlBatchCount) {
    throw new HttpError(
      400,
      `parts must contain at most ${maximumMultipartPartUrlBatchCount} parts per request`,
      "MEDIA_ASSET_PART_URL_BATCH_TOO_LARGE",
    );
  }

  const parts = partRecords.map((partRecord, index) => ({
    partNumber: expectPartNumber(partRecord.partNumber, `parts[${index}].partNumber`),
    sha256: expectSha256(partRecord.sha256, `parts[${index}].sha256`),
  }));
  assertUniquePartNumbers(parts, "parts");

  return {
    parts,
  };
}

export function parseCompleteMediaAssetUploadSessionInput(value: unknown): CompleteMediaAssetUploadSessionInput {
  const record = expectRecord(value);
  const partRecords = expectRecordArray(record.parts, "parts");
  if (partRecords.length === 0) {
    throw new HttpError(400, "parts must contain at least one part", "MEDIA_ASSET_PARTS_REQUIRED");
  }
  if (partRecords.length > maximumMultipartUploadPartCount) {
    throw new HttpError(
      400,
      `parts must contain at most ${maximumMultipartUploadPartCount} parts`,
      "MEDIA_ASSET_PART_COUNT_INVALID",
    );
  }

  const parts = partRecords.map((partRecord, index) => ({
    partNumber: expectPartNumber(partRecord.partNumber, `parts[${index}].partNumber`),
    eTag: expectETag(partRecord.eTag, `parts[${index}].eTag`),
    sha256: expectSha256(partRecord.sha256, `parts[${index}].sha256`),
  }));
  assertUniquePartNumbers(parts, "parts");

  return {
    parts,
  };
}
