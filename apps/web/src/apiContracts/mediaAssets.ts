import type {
  MediaAsset,
  MediaAssetDownloadUrlResult,
  PresignedMediaAssetDownload,
} from "../types";
import {
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
    storageKey: parseRequiredField(objectValue, "storageKey", endpoint, path, parseString),
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
  };
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
