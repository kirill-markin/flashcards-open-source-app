import type {
  MediaAssetUploadPartUrl,
  MediaAssetUploadSession,
  MediaAssetUploadSessionAbortResult,
  MediaAssetUploadSessionCompleteResult,
  MediaAssetUploadSessionCreateResult,
  MediaAssetUploadSessionPartUrlsResult,
  MediaAsset,
  MediaAssetDownloadUrlResult,
  PresignedMediaAssetDownload,
} from "../types";
import {
  ApiContractError,
  describePath,
  parseArray,
  parseBoolean,
  parseEnum,
  joinPath,
  parseLiteral,
  parseNullableString,
  parseNumber,
  parseObject,
  parseRequiredField,
  parseString,
} from "./core";

export function parseMediaAsset(value: unknown, endpoint: string, path: string): MediaAsset {
  const objectValue = parseObject(value, endpoint, path);
  return {
    mediaAssetId: parseRequiredField(objectValue, "mediaAssetId", endpoint, path, parseString),
    workspaceId: parseRequiredField(objectValue, "workspaceId", endpoint, path, parseString),
    mimeType: parseRequiredField(objectValue, "mimeType", endpoint, path, parseString),
    sizeBytes: parseRequiredField(objectValue, "sizeBytes", endpoint, path, parseNumber),
    sha256: parseRequiredField(objectValue, "sha256", endpoint, path, parseString),
    sourceUrl: parseRequiredField(objectValue, "sourceUrl", endpoint, path, parseNullableString),
    createdAt: parseRequiredField(objectValue, "createdAt", endpoint, path, parseString),
    clientUpdatedAt: parseRequiredField(objectValue, "clientUpdatedAt", endpoint, path, parseString),
    lastModifiedByReplicaId: parseRequiredField(objectValue, "lastModifiedByReplicaId", endpoint, path, parseString),
    lastOperationId: parseRequiredField(objectValue, "lastOperationId", endpoint, path, parseString),
    updatedAt: parseRequiredField(objectValue, "updatedAt", endpoint, path, parseString),
    deletedAt: parseRequiredField(objectValue, "deletedAt", endpoint, path, parseNullableString),
  };
}

function parsePresignedMediaAssetDownload(
  value: unknown,
  endpoint: string,
  path: string,
): PresignedMediaAssetDownload {
  const objectValue = parseObject(value, endpoint, path);
  return {
    method: parseLiteral(
      parseRequiredField(objectValue, "method", endpoint, path, parseString),
      endpoint,
      joinPath(path, "method"),
      "GET",
    ),
    url: parseRequiredField(objectValue, "url", endpoint, path, parseString),
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, path, parseString),
    rangeRequests: parseLiteral(
      parseRequiredField(objectValue, "rangeRequests", endpoint, path, parseBoolean),
      endpoint,
      joinPath(path, "rangeRequests"),
      true,
    ),
  };
}

function parseNullableMediaAsset(value: unknown, endpoint: string, path: string): MediaAsset | null {
  if (value === null) {
    return null;
  }

  return parseMediaAsset(value, endpoint, path);
}

function parseMediaAssetUploadSession(
  value: unknown,
  endpoint: string,
  path: string,
): MediaAssetUploadSession {
  const objectValue = parseObject(value, endpoint, path);
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, path, parseString),
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, path, parseString),
    partSizeBytes: parseRequiredField(objectValue, "partSizeBytes", endpoint, path, parseNumber),
    partCount: parseRequiredField(objectValue, "partCount", endpoint, path, parseNumber),
  };
}

function parseNullableMediaAssetUploadSession(
  value: unknown,
  endpoint: string,
  path: string,
): MediaAssetUploadSession | null {
  if (value === null) {
    return null;
  }

  return parseMediaAssetUploadSession(value, endpoint, path);
}

function parseUploadSessionCreateStatus(
  value: unknown,
  endpoint: string,
  path: string,
): MediaAssetUploadSessionCreateResult["status"] {
  return parseEnum(value, endpoint, path, ["already_available", "upload_required"] as const);
}

function assertFieldNull(value: unknown, endpoint: string, path: string): void {
  if (value !== null) {
    throw new ApiContractError(endpoint, describePath(path), "null");
  }
}

function assertFieldPresent<ParsedValue>(
  value: ParsedValue | null,
  endpoint: string,
  path: string,
  expected: string,
): ParsedValue {
  if (value === null) {
    throw new ApiContractError(endpoint, describePath(path), expected);
  }

  return value;
}

function parseStringRecord(
  value: unknown,
  endpoint: string,
  path: string,
): Readonly<Record<string, string>> {
  const objectValue = parseObject(value, endpoint, path);
  return Object.fromEntries(Object.entries(objectValue).map(([key, fieldValue]) => [
    key,
    parseString(fieldValue, endpoint, joinPath(path, key)),
  ]));
}

function parseMediaAssetUploadPartUrl(
  value: unknown,
  endpoint: string,
  path: string,
): MediaAssetUploadPartUrl {
  const objectValue = parseObject(value, endpoint, path);
  return {
    partNumber: parseRequiredField(objectValue, "partNumber", endpoint, path, parseNumber),
    method: parseLiteral(
      parseRequiredField(objectValue, "method", endpoint, path, parseString),
      endpoint,
      joinPath(path, "method"),
      "PUT",
    ),
    url: parseRequiredField(objectValue, "url", endpoint, path, parseString),
    expiresAt: parseRequiredField(objectValue, "expiresAt", endpoint, path, parseString),
    headers: parseRequiredField(objectValue, "headers", endpoint, path, parseStringRecord),
  };
}

function parseMediaAssetUploadPartUrls(
  value: unknown,
  endpoint: string,
  path: string,
): ReadonlyArray<MediaAssetUploadPartUrl> {
  return parseArray(value, endpoint, path, parseMediaAssetUploadPartUrl);
}

export function parseMediaAssetDownloadUrlResponse(
  value: unknown,
  endpoint: string,
): MediaAssetDownloadUrlResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mediaAsset: parseRequiredField(objectValue, "mediaAsset", endpoint, "", parseMediaAsset),
    download: parseRequiredField(objectValue, "download", endpoint, "", parsePresignedMediaAssetDownload),
  };
}

export function parseMediaAssetUploadSessionCreateResponse(
  value: unknown,
  endpoint: string,
): MediaAssetUploadSessionCreateResult {
  const objectValue = parseObject(value, endpoint, "");
  const workspaceId = parseRequiredField(objectValue, "workspaceId", endpoint, "", parseString);
  const mediaAssetId = parseRequiredField(objectValue, "mediaAssetId", endpoint, "", parseString);
  const status = parseRequiredField(objectValue, "status", endpoint, "", parseUploadSessionCreateStatus);
  const mediaAsset = parseRequiredField(objectValue, "mediaAsset", endpoint, "", parseNullableMediaAsset);
  const uploadSession = parseRequiredField(
    objectValue,
    "uploadSession",
    endpoint,
    "",
    parseNullableMediaAssetUploadSession,
  );

  if (status === "already_available") {
    assertFieldNull(uploadSession, endpoint, "uploadSession");
    return {
      workspaceId,
      mediaAssetId,
      status,
      mediaAsset: assertFieldPresent(mediaAsset, endpoint, "mediaAsset", "object"),
      uploadSession: null,
    };
  }

  assertFieldNull(mediaAsset, endpoint, "mediaAsset");
  return {
    workspaceId,
    mediaAssetId,
    status,
    mediaAsset: null,
    uploadSession: assertFieldPresent(uploadSession, endpoint, "uploadSession", "object"),
  };
}

export function parseMediaAssetUploadSessionPartUrlsResponse(
  value: unknown,
  endpoint: string,
): MediaAssetUploadSessionPartUrlsResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    partUrls: parseRequiredField(objectValue, "partUrls", endpoint, "", parseMediaAssetUploadPartUrls),
  };
}

export function parseMediaAssetUploadSessionCompleteResponse(
  value: unknown,
  endpoint: string,
): MediaAssetUploadSessionCompleteResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    mediaAsset: parseRequiredField(objectValue, "mediaAsset", endpoint, "", parseMediaAsset),
    applied: parseRequiredField(objectValue, "applied", endpoint, "", parseBoolean),
  };
}

export function parseMediaAssetUploadSessionAbortResponse(
  value: unknown,
  endpoint: string,
): MediaAssetUploadSessionAbortResult {
  const objectValue = parseObject(value, endpoint, "");
  return {
    sessionId: parseRequiredField(objectValue, "sessionId", endpoint, "", parseString),
    abortedAt: parseRequiredField(objectValue, "abortedAt", endpoint, "", parseString),
  };
}
