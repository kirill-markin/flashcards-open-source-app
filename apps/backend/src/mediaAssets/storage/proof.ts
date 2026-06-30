import { createHash } from "node:crypto";
import { HttpError } from "../../shared/errors";
import type { MediaAssetObjectMetadata } from "../types";
import type {
  AssertMediaAssetObjectInput,
  MediaAssetObjectContentHash,
} from "./contracts";

export const uploadProofWorkspaceIdKey = "flashcards-workspace-id";
export const uploadProofMediaAssetIdKey = "flashcards-media-asset-id";
export const uploadProofLastOperationIdSha256Key = "flashcards-last-operation-id-sha256";
export const uploadProofSha256Key = "flashcards-sha256";

export function toBase64Sha256Digest(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

export function toHexSha256Digest(checksumSha256: string | undefined): string | null {
  if (checksumSha256 === undefined || checksumSha256.trim() === "") {
    return null;
  }

  return Buffer.from(checksumSha256, "base64").toString("hex");
}

function hashUploadProofValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createUploadProofMetadata(input: Readonly<{
  workspaceId: string;
  mediaAssetId: string;
  lastOperationId: string;
  sha256: string;
}>): Readonly<Record<string, string>> {
  return {
    [uploadProofWorkspaceIdKey]: input.workspaceId,
    [uploadProofMediaAssetIdKey]: input.mediaAssetId,
    [uploadProofLastOperationIdSha256Key]: hashUploadProofValue(input.lastOperationId),
    [uploadProofSha256Key]: input.sha256,
  };
}

export function createUploadProofHeaders(metadata: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]),
  );
}

function createMediaAssetUploadMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  const mismatchedFields = [
    ...(objectMetadata.sizeBytes === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(objectMetadata.mimeType === input.mimeType ? [] : ["mimeType"]),
    ...(objectMetadata.checksumSha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset does not match declared metadata",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedFields=${mismatchedFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_MISMATCH",
  );
}

function createMediaAssetUploadContentHashMismatchError(
  input: AssertMediaAssetObjectInput,
  objectContent: MediaAssetObjectContentHash,
): HttpError {
  const mismatchedFields = [
    ...(objectContent.sizeBytes === input.sizeBytes ? [] : ["sizeBytes"]),
    ...(objectContent.sha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset bytes do not match declared metadata",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedFields=${mismatchedFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_MISMATCH",
  );
}

function createMediaAssetUploadProofMismatchError(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): HttpError {
  const expectedLastOperationIdSha256 = hashUploadProofValue(input.lastOperationId);
  const mismatchedProofFields = [
    ...(objectMetadata.uploadProof.workspaceId === input.workspaceId ? [] : ["workspaceId"]),
    ...(objectMetadata.uploadProof.mediaAssetId === input.mediaAssetId ? [] : ["mediaAssetId"]),
    ...(objectMetadata.uploadProof.lastOperationIdSha256 === expectedLastOperationIdSha256 ? [] : ["lastOperationId"]),
    ...(objectMetadata.uploadProof.sha256 === input.sha256 ? [] : ["sha256"]),
  ];

  return new HttpError(
    409,
    [
      "Uploaded media asset proof does not match the authenticated upload session",
      `workspaceId=${input.workspaceId}`,
      `mediaAssetId=${input.mediaAssetId}`,
      `mismatchedProofFields=${mismatchedProofFields.join(",")}`,
    ].join(" "),
    "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
  );
}

export function assertMediaAssetObjectContentMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectShapeMatches(input, objectMetadata);
  if (objectMetadata.checksumSha256 !== input.sha256) {
    throw createMediaAssetUploadMismatchError(input, objectMetadata);
  }
}

function assertMediaAssetObjectShapeMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  if (
    objectMetadata.sizeBytes !== input.sizeBytes
    || objectMetadata.mimeType !== input.mimeType
  ) {
    throw createMediaAssetUploadMismatchError(input, objectMetadata);
  }
}

export function assertMediaAssetObjectContentHashMatches(
  input: AssertMediaAssetObjectInput,
  objectContent: MediaAssetObjectContentHash,
): void {
  if (
    objectContent.sizeBytes !== input.sizeBytes
    || objectContent.sha256 !== input.sha256
  ) {
    throw createMediaAssetUploadContentHashMismatchError(input, objectContent);
  }
}

function assertMediaAssetObjectUploadProofMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  const expectedLastOperationIdSha256 = hashUploadProofValue(input.lastOperationId);
  if (
    objectMetadata.uploadProof.workspaceId !== input.workspaceId
    || objectMetadata.uploadProof.mediaAssetId !== input.mediaAssetId
    || objectMetadata.uploadProof.lastOperationIdSha256 !== expectedLastOperationIdSha256
    || objectMetadata.uploadProof.sha256 !== input.sha256
  ) {
    throw createMediaAssetUploadProofMismatchError(input, objectMetadata);
  }
}

export function assertMediaAssetObjectMetadataMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectContentMatches(input, objectMetadata);
  assertMediaAssetObjectUploadProofMatches(input, objectMetadata);
}

export function assertMediaAssetObjectShapeAndProofMatches(
  input: AssertMediaAssetObjectInput,
  objectMetadata: MediaAssetObjectMetadata,
): void {
  assertMediaAssetObjectShapeMatches(input, objectMetadata);
  assertMediaAssetObjectUploadProofMatches(input, objectMetadata);
}
