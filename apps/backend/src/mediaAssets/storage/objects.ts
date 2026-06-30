import {
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { MediaAssetObjectMetadata } from "../types";
import type {
  AssertMediaAssetObjectInput,
  MediaAssetObjectContentHash,
  MediaAssetStorageContext,
  MediaAssetStorageDependencies,
} from "./contracts";
import {
  createMediaAssetStorageError,
  runMediaAssetStorageOperationWithRetries,
} from "./errors";
import {
  assertMediaAssetObjectMetadataMatches,
  toHexSha256Digest,
  uploadProofLastOperationIdSha256Key,
  uploadProofMediaAssetIdKey,
  uploadProofSha256Key,
  uploadProofWorkspaceIdKey,
} from "./proof";

type MediaAssetObjectBodyChunk = Uint8Array | string;

type MediaAssetObjectBody = AsyncIterable<MediaAssetObjectBodyChunk>;

function isMediaAssetObjectBody(value: unknown): value is MediaAssetObjectBody {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function toMediaAssetObjectBodyChunkBytes(chunk: MediaAssetObjectBodyChunk): Uint8Array {
  return typeof chunk === "string" ? Buffer.from(chunk) : chunk;
}

export async function loadMediaAssetObjectMetadataWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<MediaAssetObjectMetadata> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };

  try {
    const response = await runMediaAssetStorageOperationWithRetries(
      context,
      "head_object",
      async () => dependencies.s3Client.send(new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: input.storageKey,
        ChecksumMode: "ENABLED",
      })),
    );

    return {
      sizeBytes: typeof response.ContentLength === "number" ? response.ContentLength : null,
      mimeType: typeof response.ContentType === "string" ? response.ContentType : null,
      checksumSha256: toHexSha256Digest(response.ChecksumSHA256),
      checksumType: response.ChecksumType ?? null,
      uploadProof: {
        workspaceId: response.Metadata?.[uploadProofWorkspaceIdKey] ?? null,
        mediaAssetId: response.Metadata?.[uploadProofMediaAssetIdKey] ?? null,
        lastOperationIdSha256: response.Metadata?.[uploadProofLastOperationIdSha256Key] ?? null,
        sha256: response.Metadata?.[uploadProofSha256Key] ?? null,
      },
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "head_object", error);
  }
}

export async function assertMediaAssetObjectMatchesWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<void> {
  const objectMetadata = await loadMediaAssetObjectMetadataWithDependencies(input, dependencies);
  assertMediaAssetObjectMetadataMatches(input, objectMetadata);
}

export async function hashMediaAssetObjectContentWithDependencies(
  input: AssertMediaAssetObjectInput,
  dependencies: MediaAssetStorageDependencies,
): Promise<MediaAssetObjectContentHash> {
  const config = dependencies.getMediaAssetsStorageConfigFn();
  const context: MediaAssetStorageContext = {
    workspaceId: input.workspaceId,
    mediaAssetId: input.mediaAssetId,
    storageKey: input.storageKey,
    observationScope: input.observationScope,
  };

  try {
    const response = await runMediaAssetStorageOperationWithRetries(
      context,
      "get_object",
      async () => dependencies.s3Client.send(new GetObjectCommand({
        Bucket: config.bucketName,
        Key: input.storageKey,
      })),
    );
    const body = response.Body;
    if (isMediaAssetObjectBody(body) === false) {
      throw new Error(
        `S3 get_object did not return a readable body for workspaceId=${input.workspaceId} mediaAssetId=${input.mediaAssetId}.`,
      );
    }

    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of body) {
      const bytes = toMediaAssetObjectBodyChunkBytes(chunk);
      sizeBytes += bytes.byteLength;
      hash.update(bytes);
    }

    return {
      sizeBytes,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    throw createMediaAssetStorageError(context, "get_object", error);
  }
}
