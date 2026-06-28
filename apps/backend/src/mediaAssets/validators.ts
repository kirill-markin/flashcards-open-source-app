import { HttpError } from "../shared/errors";
import {
  expectNonEmptyString,
  expectRecord,
  expectUuidString,
} from "../server/requestParsing";
import type {
  CompleteMediaAssetUploadInput,
  MediaAssetUploadIntentInput,
} from "./types";

const mimeTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const maximumSourceUrlLength = 2_048;
const maximumLastOperationIdLength = 1_024;
export const maximumSinglePutUploadBytes = 5_368_709_120;

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

function expectSizeBytes(value: unknown, fieldName: string): number {
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

export function parseMediaAssetUploadIntentInput(value: unknown): MediaAssetUploadIntentInput {
  const record = expectRecord(value);
  return {
    mediaAssetId: expectUuidString(record.mediaAssetId, "mediaAssetId"),
    mimeType: expectMimeType(record.mimeType, "mimeType"),
    sizeBytes: expectSizeBytes(record.sizeBytes, "sizeBytes"),
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
    sizeBytes: expectSizeBytes(record.sizeBytes, "sizeBytes"),
    sha256: expectSha256(record.sha256, "sha256"),
    sourceUrl: expectMediaAssetSourceUrl(record.sourceUrl, "sourceUrl"),
    createdAt: expectIsoTimestamp(record.createdAt, "createdAt"),
    clientUpdatedAt: expectIsoTimestamp(record.clientUpdatedAt, "clientUpdatedAt"),
    lastModifiedByReplicaId: expectUuidString(record.lastModifiedByReplicaId, "lastModifiedByReplicaId"),
    lastOperationId: expectLastOperationId(record.lastOperationId, "lastOperationId"),
  };
}
